import time
import random
import requests

API_URL = "http://127.0.0.1:8000/sensor-data"

print("Starting sensor simulation feed...")

while True:
    # Generate realistic telemetry streams
    payload = {
        "temperature": round(random.uniform(20.0, 65.0), 1),
        "humidity": round(random.uniform(20.0, 70.0), 1),
        "gas_level": random.randint(80, 700),
        "flame_detected": random.random() > 0.85,
        "motion_detected": random.choice([True, False])
    }
    
    try:
        response = requests.post(API_URL, json=payload, timeout=2)
        print(f"[POST SUCCESS] Sent: {payload} | Server Response: {response.json()['evaluation']['risk_level']}")
    except Exception as e:
        print(f"[ERROR] Could not connect to FastAPI backend: {e}")
        
    time.sleep(2)