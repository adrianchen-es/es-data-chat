# auth-service/src/main.py
from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt, JWTError
from keycloak import KeycloakOpenID
from pydantic import BaseModel
import httpx
import os
import time
from typing import Dict, Optional
import structlog
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

# Structured logging setup
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer()
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()
app = FastAPI(title="Authentication Service", version="1.0.0")
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer(__name__)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Keycloak configuration
KEYCLOAK_SERVER_URL = os.getenv("KEYCLOAK_SERVER_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "ai-chat")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "ai-chat-client")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")

# Initialize Keycloak client
keycloak_openid = KeycloakOpenID(
    server_url=KEYCLOAK_SERVER_URL,
    client_id=KEYCLOAK_CLIENT_ID,
    realm_name=KEYCLOAK_REALM,
    client_secret_key=KEYCLOAK_CLIENT_SECRET
)

security = HTTPBearer()

class LoginRequest(BaseModel):
    username: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class AuthUser:
    def __init__(self, user_id: str, username: str, email: str, roles: list):
        self.user_id = user_id
        self.username = username
        self.email = email
        self.roles = roles

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> AuthUser:
    """Validate JWT token and extract user info"""
    with tracer.start_as_current_span("auth_validation") as span:
        try:
            token = credentials.credentials
            
            # Try to decode as demo token first
            try:
                payload = jwt.decode(token, "demo-secret-key", algorithms=["HS256"])
                if payload.get("iss") == "demo-auth":
                    # This is a demo token
                    user_id = payload.get("sub")
                    username = payload.get("preferred_username")
                    email = payload.get("email")
                    roles = payload.get("realm_access", {}).get("roles", [])
                    
                    span.set_attributes({
                        "auth.user_id": user_id,
                        "auth.username": username,
                        "auth.roles_count": len(roles),
                        "auth.method": "demo"
                    })
                    
                    logger.info("User authenticated via demo token", user_id=user_id, username=username)
                    return AuthUser(user_id, username, email, roles)
            except:
                pass  # Not a demo token, try Keycloak
            
            # Try Keycloak token validation
            try:
                # Get Keycloak public key
                public_key = "-----BEGIN PUBLIC KEY-----\n" + keycloak_openid.public_key() + "\n-----END PUBLIC KEY-----"
                
                # Decode and validate token
                payload = jwt.decode(
                    token,
                    public_key,
                    algorithms=["RS256"],
                    audience=KEYCLOAK_CLIENT_ID
                )
                
                # Extract user information
                user_id = payload.get("sub")
                username = payload.get("preferred_username")
                email = payload.get("email")
                roles = payload.get("realm_access", {}).get("roles", [])
                
                span.set_attributes({
                    "auth.user_id": user_id,
                    "auth.username": username,
                    "auth.roles_count": len(roles),
                    "auth.method": "keycloak"
                })
                
                logger.info("User authenticated via Keycloak", user_id=user_id, username=username)
                return AuthUser(user_id, username, email, roles)
            except Exception as keycloak_error:
                logger.warning("Keycloak token validation failed", error=str(keycloak_error))
                raise JWTError("Invalid token")
            
        except JWTError as e:
            span.record_exception(e)
            logger.warning("Authentication failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

@app.post("/login")
async def login(request: LoginRequest):
    """Authenticate user with Keycloak or fallback demo auth"""
    with tracer.start_as_current_span("user_login") as span:
        try:
            # Try Keycloak authentication first
            token_response = keycloak_openid.token(request.username, request.password)
            
            span.set_attributes({
                "auth.username": request.username,
                "auth.success": True,
                "auth.method": "keycloak"
            })
            
            logger.info("User login successful via Keycloak", username=request.username)
            
            return {
                "access_token": token_response["access_token"],
                "refresh_token": token_response["refresh_token"],
                "expires_in": token_response["expires_in"],
                "token_type": "Bearer"
            }
            
        except Exception as keycloak_error:
            # Fallback to demo authentication for development
            if request.username == "admin" and request.password == "admin123":
                # Generate a simple JWT token for demo
                demo_payload = {
                    "sub": "demo-user-123",
                    "preferred_username": "admin",
                    "email": "admin@demo.com",
                    "realm_access": {"roles": ["admin", "user"]},
                    "exp": int(time.time()) + 3600  # 1 hour from now
                }
                demo_token = jwt.encode(demo_payload, "demo-secret", algorithm="HS256")
                
                span.set_attributes({
                    "auth.username": request.username,
                    "auth.success": True,
                    "auth.method": "demo"
                })
                
                logger.info("User login successful via demo auth", username=request.username)
                
                return {
                    "access_token": demo_token,
                    "refresh_token": "demo-refresh-token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                }
            
            span.record_exception(keycloak_error)
            logger.warning("Login failed", username=request.username, error=str(keycloak_error))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )

@app.post("/refresh")
async def refresh_token(request: RefreshRequest):
    """Refresh access token"""
    try:
        token_response = keycloak_openid.refresh_token(request.refresh_token)
        
        logger.info("Token refreshed successfully")
        
        return {
            "access_token": token_response["access_token"],
            "refresh_token": token_response["refresh_token"],
            "expires_in": token_response["expires_in"],
            "token_type": "Bearer"
        }
        
    except Exception as e:
        logger.warning("Token refresh failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

@app.post("/logout")
async def logout(user: AuthUser = Depends(get_current_user)):
    """Logout user"""
    try:
        # For proper logout, we need the refresh token
        # Since we only have access token, we'll just return success
        # In a real implementation, you'd want to track refresh tokens
        logger.info("User logout successful", user_id=user.user_id)
        return {"message": "Logged out successfully"}
        
    except Exception as e:
        logger.warning("Logout failed", error=str(e))
        raise HTTPException(status_code=400, detail="Logout failed")

@app.get("/verify")
async def verify_token(user: AuthUser = Depends(get_current_user)):
    """Verify token and return user info"""
    return {
        "user_id": user.user_id,
        "username": user.username,
        "email": user.email,
        "roles": user.roles
    }

@app.get("/health")
async def health_check():
    """Health check"""
    try:
        # Test Keycloak connection
        keycloak_openid.well_known()
        return {"status": "healthy", "service": "auth"}
    except Exception:
        return {"status": "unhealthy", "service": "auth"}

if __name__ == "__main__":
    # Check if running under gunicorn
    if "gunicorn" in os.environ.get("SERVER_SOFTWARE", ""):
        # Running under gunicorn, don't start uvicorn
        pass
    else:
        import uvicorn
        # Fallback to uvicorn for development
        uvicorn.run(app, host="0.0.0.0", port=8003)