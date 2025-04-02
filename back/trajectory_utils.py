import json
import math
import logging
from datetime import datetime

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("trajectory_utils")

class TrajectoryCalculator:
    """Utility class for trajectory calculations"""
    
    @staticmethod
    def calculate_position(current_position, encoder_values, orientation=None):
        """Calculate new position based on encoder values and orientation"""
        try:
            # Extract current position
            x = current_position.get("x", 0)
            y = current_position.get("y", 0)
            theta = current_position.get("theta", 0)
            
            # Extract orientation if available
            if orientation and "yaw" in orientation:
                theta = orientation["yaw"]  # Use IMU yaw if available
            
            # Get encoder values
            # Assuming we have 3 motors in a holonomic configuration
            e1 = encoder_values[0] if len(encoder_values) > 0 else 0
            e2 = encoder_values[1] if len(encoder_values) > 1 else 0
            e3 = encoder_values[2] if len(encoder_values) > 2 else 0
            
            # Simplified model for demonstration - real robots would need more complex mapping
            # This is just a placeholder implementation
            velocity_x = (2*e1 - e2 - e3) / 3 * 0.01  # Scale factor for demo
            velocity_y = (e2 - e3) * 0.01  # Scale factor
            velocity_theta = (e1 + e2 + e3) * 0.001  # Scale factor
            
            # Update position
            x += velocity_x * math.cos(theta) - velocity_y * math.sin(theta)
            y += velocity_x * math.sin(theta) + velocity_y * math.cos(theta)
            
            # Update orientation if no IMU data
            if not orientation:
                theta += velocity_theta
                # Normalize theta to [-π, π]
                theta = ((theta + math.pi) % (2 * math.pi)) - math.pi
            
            return {
                "x": x,
                "y": y,
                "theta": theta
            }
        except Exception as e:
            logger.error(f"Error calculating position: {str(e)}")
            return current_position  # Return unchanged if error occurs

class JSONDataHandler:
    """Utility class for handling JSON data conversion"""
    
    @staticmethod
    def to_json(data):
        """Convert data to JSON string"""
        try:
            if isinstance(data, str):
                # Check if already a JSON string
                json.loads(data)
                return data
            else:
                return json.dumps(data)
        except (json.JSONDecodeError, TypeError):
            try:
                return json.dumps(data)
            except Exception as e:
                logger.error(f"Error converting data to JSON: {str(e)}")
                return "{}"
    
    @staticmethod
    def from_json(json_str):
        """Parse JSON string to Python object"""
        try:
            if isinstance(json_str, dict):
                # Already a dictionary
                return json_str
            else:
                return json.loads(json_str)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Error parsing JSON: {str(e)}")
            return {}
    
    @staticmethod
    def merge_json(json1, json2):
        """Merge two JSON objects/strings"""
        try:
            dict1 = JSONDataHandler.from_json(json1)
            dict2 = JSONDataHandler.from_json(json2)
            merged = {**dict1, **dict2}
            return merged
        except Exception as e:
            logger.error(f"Error merging JSON: {str(e)}")
            return {}