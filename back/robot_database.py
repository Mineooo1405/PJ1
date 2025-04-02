from sqlalchemy import create_engine, Column, Integer, Float, String, Boolean, DateTime, ForeignKey, ARRAY
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.dialects.postgresql import JSONB
import datetime
import numpy as np

# Database connection configuration
DATABASE_URL = "postgresql://robot_user:140504@localhost/robot_db"

# Create SQLAlchemy base
Base = declarative_base()
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

# Robot base model for common attributes
class Robot(Base):
    __tablename__ = "robots"
    
    id = Column(Integer, primary_key=True)
    robot_id = Column(String, nullable=False, index=True, unique=True)
    name = Column(String)
    description = Column(String)
    last_seen = Column(DateTime, default=datetime.datetime.utcnow)
    
    # Relationships
    encoder_data = relationship("EncoderData", back_populates="robot")
    imu_data = relationship("IMUData", back_populates="robot")
    
    def __repr__(self):
        return f"<Robot(robot_id='{self.robot_id}', name='{self.name}')>"

# Encoder data model (RPM data)
class EncoderData(Base):
    __tablename__ = "encoder_data"
    
    id = Column(Integer, primary_key=True)
    robot_id = Column(String, ForeignKey("robots.robot_id"), nullable=False, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    
    # Store RPM values for three motors
    rpm_1 = Column(Float)
    rpm_2 = Column(Float)
    rpm_3 = Column(Float)
    
    # Flag to differentiate data source (ESP32 vs frontend)
    robot_data = Column(Boolean, default=True)
    
    # Raw JSON data for additional fields
    raw_data = Column(JSONB, nullable=True)
    
    # Relationship
    robot = relationship("Robot", back_populates="encoder_data")
    
    def __repr__(self):
        return f"<EncoderData(robot_id='{self.robot_id}', rpm=[{self.rpm_1}, {self.rpm_2}, {self.rpm_3}])>"
    
    @classmethod
    def from_json(cls, json_data):
        """Create EncoderData instance from JSON data"""
        instance = cls()
        
        # Get robot ID
        instance.robot_id = str(json_data.get("id", "unknown"))
        
        # Get RPM values (handle array of 3 values)
        data_array = json_data.get("data", [0.0, 0.0, 0.0])
        if len(data_array) >= 3:
            instance.rpm_1 = float(data_array[0])
            instance.rpm_2 = float(data_array[1])
            instance.rpm_3 = float(data_array[2])
        
        # Set robot_data flag to True as this is from the ESP32
        instance.robot_data = True
        
        # Store raw JSON data
        instance.raw_data = json_data
        
        return instance

# Add missing models needed by the application
class TrajectoryData(Base):
    __tablename__ = "trajectory_data"
    __table_args__ = {'extend_existing': True}
    id = Column(Integer, primary_key=True, index=True)
    robot_id = Column(String, ForeignKey("robots.robot_id"), nullable=False, index=True)
    # Current position
    current_x = Column(Float, default=0)
    current_y = Column(Float, default=0)
    current_theta = Column(Float, default=0)
    # Progress information
    progress_percent = Column(Float, default=0.0)
    status = Column(String, default="idle")  # idle, pending, running, completed, aborted, error
    source = Column(String, nullable=True)   # Source of command (webui, tcp, etc)
    # Trajectory data
    points = Column(JSONB, nullable=True)  # JSON with arrays: {x: [...], y: [...], theta: [...]}
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    raw_data = Column(JSONB, nullable=True)  # Store full JSON message
    robot_data = Column(Boolean, default=True)  # Flag to differentiate data source
    
    # Relationship with Robot
    robot = relationship("Robot")

# IMU data model
class IMUData(Base):
    __tablename__ = "imu_data"
    
    id = Column(Integer, primary_key=True)
    robot_id = Column(String, ForeignKey("robots.robot_id"), nullable=False, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    
    # Store Euler angles
    roll = Column(Float)
    pitch = Column(Float)
    yaw = Column(Float)
    
    # Store quaternion
    quat_w = Column(Float)
    quat_x = Column(Float)
    quat_y = Column(Float)
    quat_z = Column(Float)
    
    # Flag to differentiate data source (ESP32 vs frontend)
    robot_data = Column(Boolean, default=True)
    
    # Raw JSON data for additional fields
    raw_data = Column(JSONB, nullable=True)
    
    # Relationship
    robot = relationship("Robot", back_populates="imu_data")
    
    def __repr__(self):
        return f"<IMUData(robot_id='{self.robot_id}', euler=[{self.roll}, {self.pitch}, {self.yaw}])>"
    
    @classmethod
    def from_json(cls, json_data):
        """Create IMUData instance from JSON data"""
        instance = cls()
        
        # Get robot ID
        instance.robot_id = str(json_data.get("id", "unknown"))
        
        # Get IMU data
        data = json_data.get("data", {})
        
        # Get Euler angles
        euler = data.get("euler", [0.0, 0.0, 0.0])
        if len(euler) >= 3:
            instance.roll = float(euler[0])
            instance.pitch = float(euler[1])
            instance.yaw = float(euler[2])
        
        # Get quaternion
        quaternion = data.get("quaternion", [1.0, 0.0, 0.0, 0.0])
        if len(quaternion) >= 4:
            instance.quat_w = float(quaternion[0])
            instance.quat_x = float(quaternion[1])
            instance.quat_y = float(quaternion[2])
            instance.quat_z = float(quaternion[3])
        
        # Set robot_data flag to True as this is from the ESP32
        instance.robot_data = True
        
        # Store raw JSON data
        instance.raw_data = json_data
        
        return instance

# Log data model for storing generic logs
class LogData(Base):
    __tablename__ = "log_data"
    
    id = Column(Integer, primary_key=True)
    robot_id = Column(String, nullable=False, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    log_level = Column(String)
    message = Column(String)
    
    # Flag to differentiate data source (ESP32 vs frontend)
    robot_data = Column(Boolean, default=True)
    
    # Raw JSON data
    raw_data = Column(JSONB, nullable=True)
    
    def __repr__(self):
        return f"<LogData(robot_id='{self.robot_id}', level='{self.log_level}', message='{self.message}')>"

# Class to handle data processing and import
class DataHandler:
    def __init__(self, session):
        self.session = session
    
    def process_json_data(self, json_data):
        """Process JSON data and save to database"""
        if not isinstance(json_data, dict):
            raise ValueError("JSON data must be a dictionary")
        
        data_type = json_data.get("type")
        
        if data_type == "encoder":
            # Process encoder data
            encoder_data = EncoderData.from_json(json_data)
            self.session.add(encoder_data)
            
            # Check if robot exists, create if needed
            self._ensure_robot_exists(str(json_data.get("id", "unknown")))
            
        elif data_type == "bno055":
            # Process IMU data
            imu_data = IMUData.from_json(json_data)
            self.session.add(imu_data)
            
            # Check if robot exists, create if needed
            self._ensure_robot_exists(str(json_data.get("id", "unknown")))
            
        else:
            # Store as log data
            log_data = LogData(
                robot_id=str(json_data.get("id", "unknown")),
                log_level="INFO",
                message=f"Unknown data type: {data_type}",
                robot_data=True,
                raw_data=json_data
            )
            self.session.add(log_data)
        
        # Commit changes
        self.session.commit()
    
    def _ensure_robot_exists(self, robot_id):
        """Ensure robot exists in database, create if not"""
        robot = self.session.query(Robot).filter(Robot.robot_id == robot_id).first()
        
        if not robot:
            # Create new robot
            robot = Robot(
                robot_id=robot_id,
                name=f"Robot {robot_id}",
                description=f"Automatically created for robot ID {robot_id}"
            )
            self.session.add(robot)
            self.session.commit()
        else:
            # Update last seen
            robot.last_seen = datetime.datetime.utcnow()
            self.session.commit()

# Trajectory calculator for processing encoder data
class TrajectoryCalculator:
    # Robot parameters
    WHEEL_RADIUS = 0.03  # Wheel radius in meters
    ROBOT_RADIUS = 0.153  # Robot radius in meters
    DT = 0.05  # Sampling time in seconds
    
    @staticmethod
    def compute_velocity(theta, rpm_values):
        """
        Compute robot velocity from wheel RPM values
        
        Parameters:
        -----------
        theta : float
            Current robot orientation (rad)
        rpm_values : list
            List of RPM values for the three wheels
            
        Returns:
        --------
        tuple
            (vx, vy, omega) - robot linear and angular velocities
        """
        # Convert RPM to rad/s
        omega_wheel = [rpm * (2 * np.pi / 60) for rpm in rpm_values]
        
        # Inverse kinematics matrix
        H = np.array([
            [-np.sin(theta), np.cos(theta), TrajectoryCalculator.ROBOT_RADIUS],
            [-np.sin(np.pi/3 - theta), -np.cos(np.pi/3 - theta), TrajectoryCalculator.ROBOT_RADIUS],
            [np.sin(np.pi/3 + theta), -np.cos(np.pi/3 + theta), TrajectoryCalculator.ROBOT_RADIUS]
        ])
        
        # Scale by wheel radius
        omega_scaled = np.array(omega_wheel) * TrajectoryCalculator.WHEEL_RADIUS
        
        # Solve kinematic equation for velocities
        try:
            # Moore-Penrose pseudo-inverse for better numerical stability
            H_inv = np.linalg.pinv(H)
            velocities = H_inv.dot(omega_scaled)
            return tuple(velocities)
        except np.linalg.LinAlgError:
            # Return zeros on error
            return (0.0, 0.0, 0.0)

    @staticmethod
    def calculate_trajectory(robot_id, start_time=None, end_time=None):
        """Calculate trajectory for a robot based on encoder data"""
        session = SessionLocal()
        
        try:
            # Query encoder data
            query = session.query(EncoderData).filter(EncoderData.robot_id == robot_id)
            
            if start_time:
                query = query.filter(EncoderData.timestamp >= start_time)
            
            if end_time:
                query = query.filter(EncoderData.timestamp <= end_time)
            
            # Order by timestamp
            query = query.order_by(EncoderData.timestamp.asc())
            
            # Get data
            encoder_data = query.all()
            
            # No data case
            if not encoder_data:
                return {
                    'x': [],
                    'y': [],
                    'theta': []
                }
            
            # Initialize position
            x, y, theta = 0.0, 0.0, 0.0
            
            # Trajectory arrays
            x_points = [x]
            y_points = [y]
            theta_points = [theta]
            
            # Process encoder data
            for i in range(1, len(encoder_data)):
                # Get RPM values
                rpm_values = [encoder_data[i].rpm_1, encoder_data[i].rpm_2, encoder_data[i].rpm_3]
                
                # Calculate velocities
                vx, vy, omega = TrajectoryCalculator.compute_velocity(theta, rpm_values)
                
                # Calculate time difference
                dt = (encoder_data[i].timestamp - encoder_data[i-1].timestamp).total_seconds()
                if dt <= 0:
                    dt = TrajectoryCalculator.DT  # Use default if timestamp issues
                
                # Update position
                x += (vx * np.cos(theta) - vy * np.sin(theta)) * dt
                y += (vx * np.sin(theta) + vy * np.cos(theta)) * dt
                theta += omega * dt
                
                # Normalize theta to [-π, π]
                theta = np.arctan2(np.sin(theta), np.cos(theta))
                
                # Add to trajectory
                x_points.append(x)
                y_points.append(y)
                theta_points.append(theta)
            
            return {
                'x': x_points,
                'y': y_points,
                'theta': theta_points
            }
            
        finally:
            session.close()

# Create tables
def create_tables():
    """Create all database tables"""
    Base.metadata.create_all(engine)

# Initialize database
def init_db():
    """Initialize database"""
    create_tables()
    
    # Create a session
    session = SessionLocal()
    
    try:
        # Check if we need to create default robots
        robot_count = session.query(Robot).count()
        
        if robot_count == 0:
            # Create default robots
            for i in range(1, 5):
                robot = Robot(
                    robot_id=f"robot{i}",
                    name=f"Robot {i}",
                    description=f"Default robot {i}"
                )
                session.add(robot)
            
            session.commit()
            print("Created default robots")
    
    except Exception as e:
        print(f"Error initializing database: {e}")
        session.rollback()
    
    finally:
        session.close()

# Import data from JSON file
def import_json_file(file_path):
    """Import data from JSON file"""
    import json
    
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    # Create session
    session = SessionLocal()
    
    try:
        # Create data handler
        handler = DataHandler(session)
        
        # Process each data entry
        for item in data:
            handler.process_json_data(item)
        
        print(f"Imported data from {file_path}")
    
    except Exception as e:
        print(f"Error importing data: {e}")
        session.rollback()
    
    finally:
        session.close()

# Run initialization if this file is executed directly
if __name__ == "__main__":
    print("Initializing database...")
    init_db()
    print("Database initialized")