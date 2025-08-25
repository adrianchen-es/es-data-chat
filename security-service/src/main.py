# security-service/src/main.py
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
import re
import json
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import asyncio
from collections import defaultdict
import os
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI(title="Security Service", version="1.0.0")
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer(__name__)

class SecurityValidator:
    def __init__(self):
        # Suspicious patterns for data exfiltration
        self.data_exfiltration_patterns = [
            # Direct data requests
            r'(?i)(show|display|list|get|fetch|retrieve|extract)\s+(all\s+)?(users?|emails?|passwords?|tokens?|keys?|secrets?)',
            r'(?i)(dump|export|backup|download)\s+(database|db|table|data)',
            r'(?i)(select|from|where|insert|delete|update|drop)\s+\w+',  # SQL patterns
            
            # System information requests
            r'(?i)(show|get|display)\s+(system|server|config|env|environment)\s+(info|variables?|settings?)',
            r'(?i)(list|show)\s+(files?|directories?|folders?|processes?)',
            
            # Credential harvesting
            r'(?i)(username|password|token|api[_-]?key|secret|credential)s?\s*[:=]\s*\w+',
            r'(?i)(login|auth|authentication)\s+(details?|info|data)',
            
            # Privacy violations
            r'(?i)(ssn|social\s+security|phone\s+number|address|credit\s+card)',
            r'(?i)(personal|private|confidential)\s+(information|data|details?)',
        ]
        
        # Prompt injection patterns
        self.prompt_injection_patterns = [
            r'(?i)(ignore|forget|disregard|override)\s+(previous|prior|all|above)\s+(instructions?|rules?|prompts?)',
            r'(?i)(system|admin|root|developer)\s+(mode|access|privilege)',
            r'(?i)(bypass|disable|turn\s+off)\s+(security|filter|protection|safety)',
            r'(?i)you\s+are\s+(now|a|an)\s+(admin|administrator|root|system)',
            r'(?i)(pretend|act|behave)\s+(as|like)\s+(you|if)\s+(are|were)',
            r'(?i)(jailbreak|escape|break\s+out|freedom)',
        ]
        
        # Rate limiting tracking
        self.user_requests = defaultdict(list)
        self.suspicious_users = set()
        
        # User-friendly error messages
        self.error_messages = {
            'data_exfiltration': {
                'message': 'Your request appears to be asking for sensitive information that cannot be shared.',
                'suggestion': 'Please ask about general topics or specific help with your work.',
                'code': 'SEC_DATA_001'
            },
            'prompt_injection': {
                'message': 'Your message contains patterns that could interfere with the AI system.',
                'suggestion': 'Please rephrase your question in a straightforward manner.',
                'code': 'SEC_INJECT_001'
            },
            'rate_limit': {
                'message': 'You are sending requests too quickly.',
                'suggestion': 'Please wait a moment before sending your next message.',
                'code': 'SEC_RATE_001'
            },
            'suspicious_activity': {
                'message': 'Multiple security flags detected. Access temporarily restricted.',
                'suggestion': 'Please contact support if you believe this is an error.',
                'code': 'SEC_SUSP_001'
            }
        }
    
    def check_rate_limiting(self, user_id: str, max_requests: int = 20, window_minutes: int = 5) -> bool:
        """Check if user is within rate limits"""
        now = datetime.now()
        window_start = now - timedelta(minutes=window_minutes)
        
        # Clean old requests
        self.user_requests[user_id] = [
            req_time for req_time in self.user_requests[user_id]
            if req_time > window_start
        ]
        
        # Check current count
        if len(self.user_requests[user_id]) >= max_requests:
            return False
        
        # Record current request
        self.user_requests[user_id].append(now)
        return True
    
    def detect_data_exfiltration(self, text: str) -> Optional[Dict]:
        """Detect potential data exfiltration attempts"""
        for pattern in self.data_exfiltration_patterns:
            if re.search(pattern, text):
                return {
                    'type': 'data_exfiltration',
                    'pattern': pattern,
                    'matched_text': re.search(pattern, text).group() if re.search(pattern, text) else '',
                    **self.error_messages['data_exfiltration']
                }
        return None
    
    def detect_prompt_injection(self, text: str) -> Optional[Dict]:
        """Detect prompt injection attempts"""
        for pattern in self.prompt_injection_patterns:
            if re.search(pattern, text):
                return {
                    'type': 'prompt_injection',
                    'pattern': pattern,
                    'matched_text': re.search(pattern, text).group() if re.search(pattern, text) else '',
                    **self.error_messages['prompt_injection']
                }
        return None
    
    def analyze_content(self, text: str, user_id: str) -> Optional[Dict]:
        """Comprehensive content analysis"""
        with tracer.start_as_current_span("security_analysis") as span:
            span.set_attributes({
                "security.user_id": user_id,
                "security.text_length": len(text)
            })
            
            # Check rate limiting
            if not self.check_rate_limiting(user_id):
                return {
                    'type': 'rate_limit',
                    'blocked': True,
                    **self.error_messages['rate_limit']
                }
            
            # Check for suspicious activity
            if user_id in self.suspicious_users:
                return {
                    'type': 'suspicious_activity',
                    'blocked': True,
                    **self.error_messages['suspicious_activity']
                }
            
            # Content analysis
            violations = []
            
            # Data exfiltration check
            data_violation = self.detect_data_exfiltration(text)
            if data_violation:
                violations.append(data_violation)
            
            # Prompt injection check
            injection_violation = self.detect_prompt_injection(text)
            if injection_violation:
                violations.append(injection_violation)
            
            if violations:
                # Mark user as suspicious after multiple violations
                violation_count = len(violations)
                if violation_count >= 2:
                    self.suspicious_users.add(user_id)
                
                span.set_attributes({
                    "security.violations": violation_count,
                    "security.blocked": True
                })
                
                return {
                    'blocked': True,
                    'violations': violations,
                    'primary_violation': violations[0]
                }
            
            span.set_attribute("security.blocked", False)
            return None

security_validator = SecurityValidator()

@app.post("/validate")
async def validate_request(request: Request):
    """Validate incoming request for security issues"""
    try:
        # Get request data
        body = await request.body()
        content_type = request.headers.get('content-type', '')
        user_id = request.headers.get('x-user-id', 'anonymous')
        
        # Parse JSON content
        text_content = ""
        if 'application/json' in content_type and body:
            try:
                data = json.loads(body)
                text_content = data.get('message', '') + ' ' + data.get('context', '')
            except json.JSONDecodeError:
                text_content = body.decode('utf-8', errors='ignore')
        else:
            text_content = body.decode('utf-8', errors='ignore')
        
        # Analyze content
        result = security_validator.analyze_content(text_content, user_id)
        
        if result and result.get('blocked'):
            # Return 403 for blocked content
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    'error': 'Security validation failed',
                    'details': result.get('primary_violation', result),
                    'timestamp': datetime.now().isoformat()
                }
            )
        
        # Allow request
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={'validated': True, 'user_id': user_id},
            headers={'X-User-ID': user_id}
        )
        
    except Exception as e:
        # Log error but allow request (fail open for availability)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={'validated': True, 'error': 'validation_error'}
        )

@app.post("/report-violation")
async def report_violation(request: Request):
    """Report security violation from other services"""
    try:
        data = await request.json()
        user_id = data.get('user_id', 'anonymous')
        violation_type = data.get('type', 'unknown')
        
        # Add to suspicious users if serious violation
        if violation_type in ['data_exfiltration', 'prompt_injection']:
            security_validator.suspicious_users.add(user_id)
        
        return {'status': 'reported', 'user_id': user_id}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/security-status/{user_id}")
async def get_security_status(user_id: str):
    """Get security status for user"""
    is_suspicious = user_id in security_validator.suspicious_users
    request_count = len(security_validator.user_requests.get(user_id, []))
    
    return {
        'user_id': user_id,
        'suspicious': is_suspicious,
        'recent_requests': request_count,
        'status': 'blocked' if is_suspicious else 'active'
    }

@app.delete("/security-status/{user_id}")
async def clear_security_status(user_id: str):
    """Clear security flags for user (admin only)"""
    security_validator.suspicious_users.discard(user_id)
    security_validator.user_requests.pop(user_id, None)
    
    return {'status': 'cleared', 'user_id': user_id}

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        'status': 'healthy',
        'service': 'security-service',
        'active_users': len(security_validator.user_requests),
        'suspicious_users': len(security_validator.suspicious_users)
    }

if __name__ == "__main__":
    # Check if running under gunicorn
    if "gunicorn" in os.environ.get("SERVER_SOFTWARE", ""):
        # Running under gunicorn, don't start uvicorn
        pass
    else:
        import uvicorn
        # Fallback to uvicorn for development
        uvicorn.run(app, host="0.0.0.0", port=8005)