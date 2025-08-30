#!/usr/bin/env python3
"""
Comprehensive service testing script for es-data-chat application
"""
import requests
import json
import time
import sys

def main():
    # Service endpoints (using localhost from host machine)
    services = {
        'ai-service': 'http://localhost:8000',
        'document-service': 'http://localhost:8001', 
        'cache-service': 'http://localhost:8002',
        'auth-service': 'http://localhost:8003',
        'vector-service': 'http://localhost:8004'
    }

    print("🧪 ES-DATA-CHAT SERVICE TESTING")
    print("=" * 32)
    print()
    
    # Test health endpoints
    print("📋 Health Check Results:")
    healthy_services = 0
    for service_name, base_url in services.items():
        if test_health_endpoint(service_name, base_url):
            healthy_services += 1
    
    print()
    
    # Test AI service specific endpoints
    print("🤖 AI Service Testing:")
    ai_models_available = test_ai_models()
    chat_working = test_ai_chat()
    
    print()
    print("📊 SUMMARY:")
    print(f"   Healthy Services: {healthy_services}/{len(services)}")
    print(f"   AI Models Available: {'✅' if ai_models_available else '❌'}")
    print(f"   Chat Functionality: {'✅' if chat_working else '❌'}")
    
    unhealthy_count = len(services) - healthy_services
    if unhealthy_count > 0:
        print(f"\n⚠️ {unhealthy_count} services need attention")
        sys.exit(1)
    else:
        print("\n🎉 All services are healthy!")

def test_health_endpoint(service_name, base_url):
    """Test health endpoint for a service"""
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ {service_name}: {data.get('status', 'healthy')}")
            return True
        else:
            print(f"❌ {service_name}: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ {service_name}: {str(e)}")
        return False

def test_ai_models():
    """Test AI service models endpoint"""
    try:
        response = requests.get("http://localhost:8000/models", timeout=10)
        if response.status_code == 200:
            data = response.json()
            models = data.get('models', [])
            print(f"✅ AI Models: {len(models)} available - {', '.join(models[:3])}")
            return True
        else:
            print(f"❌ AI Models: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ AI Models: {str(e)}")
        return False

def test_ai_chat():
    """Test AI service chat endpoint"""
    try:
        payload = {
            "message": "Hello, this is a test",
            "user_id": "test-user"
        }
        response = requests.post("http://localhost:8000/chat", 
                               json=payload, timeout=15)
        if response.status_code == 200:
            data = response.json()
            if 'response' in data:
                print(f"✅ Chat Test: Response received ({len(data['response'])} chars)")
                return True
            else:
                print(f"❌ Chat Test: Invalid response format")
                return False
        else:
            print(f"❌ Chat Test: HTTP {response.status_code}")
            # Try to show error details
            try:
                error_data = response.json()
                print(f"   Error: {error_data.get('detail', 'Unknown error')}")
            except:
                pass
            return False
    except Exception as e:
        print(f"❌ Chat Test: {str(e)}")
        return False

if __name__ == "__main__":
    main()

def test_chat_functionality():
    """Test basic chat functionality"""
    try:
        payload = {
            "message": "Hello, this is a test message",
            "user_id": "test-user-123",
            "use_rag": False
        }
        response = requests.post(f"{SERVICES['ai-service']}/chat", 
                               json=payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Chat Test: Model used: {data.get('model_used')}")
            print(f"✅ Chat Test: Response length: {len(data.get('response', ''))}")
            return True
        else:
            data = response.json() if response.headers.get('content-type') == 'application/json' else response.text
            print(f"❌ Chat Test: HTTP {response.status_code} - {data}")
            return False
    except Exception as e:
        print(f"❌ Chat Test: {str(e)}")
        return False

def main():
    print("🧪 ES-DATA-CHAT SERVICE TESTING")
    print("================================")
    print()
    
    # Test health endpoints
    print("📋 Health Check Results:")
    health_results = {}
    for service_name, base_url in SERVICES.items():
        health_results[service_name] = test_health_endpoint(service_name, base_url)
    
    print()
    
    # Test AI service specific functionality
    print("🤖 AI Service Testing:")
    models_ok = test_ai_models()
    chat_ok = test_chat_functionality()
    
    print()
    
    # Summary
    healthy_services = sum(health_results.values())
    total_services = len(SERVICES)
    
    print("📊 SUMMARY:")
    print(f"   Healthy Services: {healthy_services}/{total_services}")
    print(f"   AI Models Available: {'✅' if models_ok else '❌'}")
    print(f"   Chat Functionality: {'✅' if chat_ok else '❌'}")
    
    if healthy_services == total_services and models_ok:
        print("\n🎉 All core services are operational!")
        return 0
    else:
        print(f"\n⚠️ {total_services - healthy_services} services need attention")
        return 1

if __name__ == "__main__":
    sys.exit(main())
