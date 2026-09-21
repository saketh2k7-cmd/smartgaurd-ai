from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd

app = FastAPI(
    title="SmartGuard AI",
    description="AI-Powered Smart Home Safety System",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load machine learning model
model = joblib.load("risk_model.pkl")

SCORE_MAP = {
    "SAFE": 20,
    "WARNING": 50,
    "HIGH": 75,
    "CRITICAL": 95
}

class SensorData(BaseModel):
    temperature: float
    humidity: float
    gas_level: int
    flame_detected: bool
    motion_detected: bool

# Global variable storing the latest reading pushed by simulate_sensors.py
latest_sensor_data = {
    "received_data": {
        "temperature": 24.0,
        "humidity": 45.0,
        "gas_level": 90,
        "flame_detected": False,
        "motion_detected": False
    },
    "evaluation": {
        "risk_score": 20,
        "risk_level": "SAFE",
        "recommended_action": "MONITOR"
    }
}

@app.get("/")
def home():
    return {"message": "SmartGuard AI Backend is Running 🚀"}

# Endpoint polled by Frontend to view current sensor readings
@app.get("/sensor-data")
def get_sensor_data():
    return latest_sensor_data

# Endpoint posted to by simulate_sensors.py
@app.post("/sensor-data")
def receive_sensor_data(data: SensorData):
    global latest_sensor_data
    
    features = pd.DataFrame([{
        "temperature": data.temperature,
        "humidity": data.humidity,
        "gas_level": data.gas_level,
        "flame_detected": int(data.flame_detected),
        "motion_detected": int(data.motion_detected)
    }])
    
    prediction = model.predict(features)[0]
    risk_score = SCORE_MAP.get(prediction, 20)

    action = (
        "EVACUATE" if prediction == "CRITICAL" else
        "SUPPRESS" if prediction == "HIGH" else
        "VENTILATE" if prediction == "WARNING" else
        "MONITOR"
    )

    latest_sensor_data = {
        "status": "success",
        "received_data": data.dict(),
        "evaluation": {
            "risk_score": risk_score,
            "risk_level": prediction,
            "recommended_action": action
        }
    }
    return latest_sensor_data