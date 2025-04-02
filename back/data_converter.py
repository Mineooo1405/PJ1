import datetime
import json
from typing import List, Dict, Any, Optional
import logging
from sqlalchemy.orm import Session

logger = logging.getLogger("data_converter")

class DataConverter:
    @staticmethod
    def imu_to_frontend(imu_data) -> Dict[str, Any]:
        """Convert IMUData to frontend format"""
        if not imu_data:
            return {
                "orientation": {"roll": 0, "pitch": 0, "yaw": 0},
                "acceleration": {"x": 0, "y": 0, "z": 9.8},
                "angular_velocity": {"x": 0, "y": 0, "z": 0}
            }
        
        # Get orientation from new schema fields
        orientation = {
            "roll": float(imu_data.roll or 0),
            "pitch": float(imu_data.pitch or 0),
            "yaw": float(imu_data.yaw or 0)
        }
        
        # Extract acceleration and angular velocity from raw_data if available
        acceleration = {"x": 0, "y": 0, "z": 9.8}
        angular_velocity = {"x": 0, "y": 0, "z": 0}
        
        if hasattr(imu_data, "raw_data") and imu_data.raw_data:
            data = imu_data.raw_data.get("data", {})
            if isinstance(data, dict):
                # Try to extract acceleration
                if "accelerometer" in data:
                    accel = data["accelerometer"]
                    if isinstance(accel, list) and len(accel) >= 3:
                        acceleration = {
                            "x": float(accel[0]),
                            "y": float(accel[1]),
                            "z": float(accel[2])
                        }
                
                # Try to extract angular velocity
                if "gyro" in data:
                    gyro = data["gyro"]
                    if isinstance(gyro, list) and len(gyro) >= 3:
                        angular_velocity = {
                            "x": float(gyro[0]),
                            "y": float(gyro[1]),
                            "z": float(gyro[2])
                        }
        
        return {
            "orientation": orientation,
            "acceleration": acceleration,
            "angular_velocity": angular_velocity,
            "timestamp": imu_data.timestamp.isoformat() if hasattr(imu_data, "timestamp") else datetime.datetime.now().isoformat()
        }
    
    @staticmethod
    def trajectory_to_frontend(trajectory_data) -> Dict[str, Any]:
        """Convert TrajectoryData to frontend format"""
        if not trajectory_data:
            return {
                "current_position": {"x": 0, "y": 0, "theta": 0},
                "points": {"x": [], "y": [], "theta": []},
                "timestamp": datetime.datetime.now().isoformat()
            }
        
        # Extract current position
        current_position = {
            "x": float(trajectory_data.current_x or 0),
            "y": float(trajectory_data.current_y or 0),
            "theta": float(trajectory_data.current_theta or 0)
        }
        
        # Extract trajectory points
        points = trajectory_data.points or {"x": [], "y": [], "theta": []}
        
        return {
            "current_position": current_position,
            "points": points,
            "timestamp": trajectory_data.timestamp.isoformat() if hasattr(trajectory_data, "timestamp") else datetime.datetime.now().isoformat()
        }
    
    @staticmethod
    def encoder_to_frontend(encoder_data) -> Dict[str, Any]:
        """Convert EncoderData to frontend format"""
        if not encoder_data:
            return {"values": [0, 0, 0], "rpm": [0, 0, 0]}
        
        # Using the new schema field names
        rpm_values = [
            float(encoder_data.rpm_1 or 0),
            float(encoder_data.rpm_2 or 0),
            float(encoder_data.rpm_3 or 0)
        ]
        
        # In the new schema, we use RPM values directly (encoder values not needed)
        values = [1000, 1100, 1200]  # Dummy values
        
        return {
            "values": values,
            "rpm": rpm_values,
            "timestamp": encoder_data.timestamp.isoformat() if hasattr(encoder_data, "timestamp") else datetime.datetime.now().isoformat()
        }
    
    @staticmethod
    def pid_to_frontend(pid_config) -> Dict[str, Any]:
        """Convert PIDConfig to frontend format"""
        if not pid_config:
            return {"motor_id": 1, "kp": 0.5, "ki": 0.1, "kd": 0.05}
        
        return {
            "motor_id": pid_config.motor_id,
            "kp": float(pid_config.kp or 0.5),
            "ki": float(pid_config.ki or 0.1),
            "kd": float(pid_config.kd or 0.05)
        }

    @staticmethod
    def get_latest_data_by_robot(db: Session, model_class, robot_id: str, limit: int = 1):
        """Get the latest records for a robot from a specific model class"""
        try:
            results = db.query(model_class).filter(
                model_class.robot_id == robot_id
            ).order_by(model_class.timestamp.desc()).limit(limit).all()
            
            return results
        except Exception as e:
            print(f"Error querying {model_class.__name__}: {e}")
            return []