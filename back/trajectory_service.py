import math
import datetime
import logging
from typing import Dict, List, Any, Optional
from sqlalchemy.orm import Session
from datetime import datetime
import numpy as np
from robot_database import TrajectoryCalculator

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trajectory_service")

class TrajectoryService:
    # Store robot positions in memory
    robot_positions = {}
    
    @staticmethod
    def initialize_robot_position(robot_id):
        """Initialize robot position data structure"""
        TrajectoryService.robot_positions[robot_id] = {
            "x": 0.0,
            "y": 0.0,
            "theta": 0.0,
            "points": {
                "x": [0.0],
                "y": [0.0],
                "theta": [0.0]
            },
            "last_update": datetime.now().timestamp()
        }
    
    @staticmethod
    def get_robot_position(robot_id):
        """Get current robot position"""
        if robot_id not in TrajectoryService.robot_positions:
            TrajectoryService.initialize_robot_position(robot_id)
        return TrajectoryService.robot_positions[robot_id]
    
    @staticmethod
    def update_robot_position(robot_id, x, y, theta):
        """Update robot position"""
        if robot_id not in TrajectoryService.robot_positions:
            TrajectoryService.initialize_robot_position(robot_id)
        
        position = TrajectoryService.robot_positions[robot_id]
        
        # Update current position
        position["x"] = x
        position["y"] = y
        position["theta"] = theta
        
        # Add to trajectory points
        position["points"]["x"].append(x)
        position["points"]["y"].append(y)
        position["points"]["theta"].append(theta)
        
        # Update timestamp
        position["last_update"] = datetime.now().timestamp()
        
        # Limit array sizes to prevent memory issues
        max_points = 1000
        if len(position["points"]["x"]) > max_points:
            position["points"]["x"] = position["points"]["x"][-max_points:]
            position["points"]["y"] = position["points"]["y"][-max_points:]
            position["points"]["theta"] = position["points"]["theta"][-max_points:]
        
        return position
    
    @staticmethod
    def calculate_position_from_encoder(robot_id, encoder_data, imu_data=None):
        """Calculate new position from encoder data"""
        position = TrajectoryService.get_robot_position(robot_id)
        
        try:
            # Get RPM values
            rpm_values = encoder_data.get("rpm", [0, 0, 0])
            
            # Get current orientation from position or IMU if available
            if imu_data and "orientation" in imu_data:
                theta = imu_data["orientation"].get("yaw", position["theta"])
            else:
                theta = position["theta"]
            
            # Calculate velocities using the new TrajectoryCalculator
            vx, vy, omega = TrajectoryCalculator.compute_velocity(theta, rpm_values)
            
            # Calculate time since last update
            current_time = datetime.now().timestamp()
            dt = current_time - position["last_update"]
            
            # Update position using velocity and time
            x = position["x"] + (vx * np.cos(theta) - vy * np.sin(theta)) * dt
            y = position["y"] + (vx * np.sin(theta) + vy * np.cos(theta)) * dt
            new_theta = theta + omega * dt
            
            # Update robot position
            return TrajectoryService.update_robot_position(robot_id, x, y, new_theta)
        except Exception as e:
            print(f"Error calculating position from encoder: {e}")
            return None
    
    @staticmethod
    def save_trajectory_to_db(db, robot_id):
        """Save current trajectory to database"""
        from main import TrajectoryData  # Import here to avoid circular import
        
        position = TrajectoryService.get_robot_position(robot_id)
        
        try:
            # Create new trajectory entry
            trajectory = TrajectoryData(
                robot_id=robot_id,
                current_x=position["x"],
                current_y=position["y"],
                current_theta=position["theta"],
                points=position["points"],
                status="calculated",
                robot_data=True,
                timestamp=datetime.now()
            )
            
            db.add(trajectory)
            db.commit()
            
            return trajectory
        except Exception as e:
            print(f"Error saving trajectory: {e}")
            db.rollback()
            return None