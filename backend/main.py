import asyncio
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd

# Load machine learning model
model = joblib.load("risk_model.pkl")

SCORE_MAP = {
    "SAFE": 20,
    "WARNING": 50,
    "HIGH": 75,
    "CRITICAL": 95
}

# In-memory store initialized with default safe telemetry
latest_sensor_data = {
    "status": "success",
    "received_data": {
        "temperature": 23.5,
        "humidity": 45.0,
        "gas_level": 110,
        "flame_detected": False,
        "motion_detected": True
    },
    "evaluation": {
        "risk_score": 20,
        "risk_level": "SAFE",
        "recommended_action": "MONITOR"
    }
}

# ------------------------------------------------------------------
# Background Loop Task
# ------------------------------------------------------------------
async def auto_simulate_telemetry():
    global latest_sensor_data
    while True:
        await asyncio.sleep(2)  # Generates telemetry every 2 seconds
        
        # Simulated sensor telemetry ranges
        temp = round(random.uniform(20.0, 65.0), 1)
        humidity = round(random.uniform(20.0, 70.0), 1)
        gas = random.randint(80, 700)
        flame = random.random() > 0.88
        motion = random.choice([True, False])

        # Prepare features for the ML model
        features = pd.DataFrame([{
            "temperature": temp,
            "humidity": humidity,
            "gas_level": gas,
            "flame_detected": int(flame),
            "motion_detected": int(motion)
        }])

        # Predict risk using loaded model
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
            "received_data": {
                "temperature": temp,
                "humidity": humidity,
                "gas_level": gas,
                "flame_detected": flame,
                "motion_detected": motion
            },
            "evaluation": {
                "risk_score": risk_score,
                "risk_level": prediction,
                "recommended_action": action
            }
        }

# ------------------------------------------------------------------
# Lifespan Handler (Triggers loop when FastAPI boots)
# ------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start background task
    task = asyncio.create_task(auto_simulate_telemetry())
    yield
    # Shutdown: Cancel background task
    task.cancel()

# Pass lifespan handler into FastAPI
app = FastAPI(title="SmartGuard AI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {"message": "SmartGuard AI Backend is Running 🚀"}

@app.get("/sensor-data")
def get_sensor_data():
    return latest_sensor_data