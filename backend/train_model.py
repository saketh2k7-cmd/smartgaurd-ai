import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
import joblib

# Set random seed for reproducibility
np.random.seed(42)

# Generate synthetic sensor training samples
num_samples = 1000

# Features: [temperature, humidity, gas_level, flame_detected, motion_detected]
temp = np.random.uniform(20.0, 60.0, num_samples)
humidity = np.random.uniform(30.0, 80.0, num_samples)
gas = np.random.randint(50, 600, num_samples)
flame = np.random.choice([0, 1], size=num_samples, p=[0.85, 0.15])
motion = np.random.choice([0, 1], size=num_samples, p=[0.7, 0.3])

# Rule-based labels for synthetic dataset training
labels = []
for i in range(num_samples):
    if flame[i] == 1 or gas[i] > 400:
        labels.append("CRITICAL")
    elif temp[i] > 45 or gas[i] > 250:
        labels.append("HIGH")
    elif temp[i] > 35 or motion[i] == 1:
        labels.append("WARNING")
    else:
        labels.append("SAFE")

# Create DataFrame
df = pd.DataFrame({
    "temperature": temp,
    "humidity": humidity,
    "gas_level": gas,
    "flame_detected": flame,
    "motion_detected": motion,
    "risk_level": labels
})

X = df[["temperature", "humidity", "gas_level", "flame_detected", "motion_detected"]]
y = df["risk_level"]

# Train Random Forest Classifier
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
model = RandomForestClassifier(n_estimators=50, random_state=42)
model.fit(X_train, y_train)

# Save trained model to disk
joblib.dump(model, "risk_model.pkl")
print("✅ Risk Model trained and saved as risk_model.pkl successfully!")
