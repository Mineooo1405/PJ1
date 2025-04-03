import asyncio
import logging
import time
from datetime import datetime
from sqlalchemy.orm import Session
from threading import Lock
from robot_database import SessionLocal, EncoderData, IMUData, LogData, Robot

logger = logging.getLogger("data_buffer")

class DataBufferService:
    """Service to buffer data before batch-writing to database"""
    
    def __init__(self, max_buffer_size=100, flush_interval_seconds=1.0):
        self.encoder_buffer = []
        self.imu_buffer = []
        self.log_buffer = []
        self.max_buffer_size = max_buffer_size
        self.flush_interval = flush_interval_seconds
        self.lock = Lock()
        self._running = False
        self.flush_task = None
    
    async def start(self):
        """Start the buffer service"""
        self._running = True
        self.flush_task = asyncio.create_task(self._periodic_flush())
        logger.info(f"Data buffer service started with max_size={self.max_buffer_size}, interval={self.flush_interval}s")
    
    async def stop(self):
        """Stop the buffer service and flush remaining data"""
        self._running = False
        if self.flush_task:
            self.flush_task.cancel()
            try:
                await self.flush_task
            except asyncio.CancelledError:
                pass
        
        # Flush any remaining data
        await self.flush_all()
        logger.info("Data buffer service stopped")
    
    async def add_encoder_data(self, data):
        """Add encoder data to buffer"""
        with self.lock:
            self.encoder_buffer.append(data)
            
        # Auto-flush if buffer is full
        if len(self.encoder_buffer) >= self.max_buffer_size:
            await self.flush_encoder_buffer()
    
    async def add_imu_data(self, data):
        """Add IMU data to buffer"""
        with self.lock:
            self.imu_buffer.append(data)
            
        # Auto-flush if buffer is full
        if len(self.imu_buffer) >= self.max_buffer_size:
            await self.flush_imu_buffer()
    
    async def add_log_data(self, data):
        """Add log data to buffer"""
        with self.lock:
            self.log_buffer.append(data)
            
        # Auto-flush if buffer is full
        if len(self.log_buffer) >= self.max_buffer_size:
            await self.flush_log_buffer()
    
    async def _periodic_flush(self):
        """Periodically flush all buffers"""
        try:
            while self._running:
                await asyncio.sleep(self.flush_interval)
                await self.flush_all()
        except asyncio.CancelledError:
            # Handle task cancellation
            logger.info("Periodic flush task cancelled")
            raise
    
    async def flush_all(self):
        """Flush all data buffers"""
        await self.flush_encoder_buffer()
        await self.flush_imu_buffer()
        await self.flush_log_buffer()
    
    async def flush_encoder_buffer(self):
        """Flush encoder data buffer to database"""
        data_to_flush = []
        with self.lock:
            if not self.encoder_buffer:
                return
            
            data_to_flush = self.encoder_buffer.copy()
            self.encoder_buffer.clear()
        
        if data_to_flush:
            # Use a thread to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(None, self._write_encoder_data_to_db, data_to_flush)
                logger.info(f"Flushed {len(data_to_flush)} encoder records to database")
            except Exception as e:
                logger.error(f"Error flushing encoder buffer: {e}")
    
    async def flush_imu_buffer(self):
        """Flush IMU data buffer to database"""
        data_to_flush = []
        with self.lock:
            if not self.imu_buffer:
                return
            
            data_to_flush = self.imu_buffer.copy()
            self.imu_buffer.clear()
        
        if data_to_flush:
            # Use a thread to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(None, self._write_imu_data_to_db, data_to_flush)
                logger.info(f"Flushed {len(data_to_flush)} IMU records to database")
            except Exception as e:
                logger.error(f"Error flushing IMU buffer: {e}")
    
    async def flush_log_buffer(self):
        """Flush log data buffer to database"""
        data_to_flush = []
        with self.lock:
            if not self.log_buffer:
                return
            
            data_to_flush = self.log_buffer.copy()
            self.log_buffer.clear()
        
        if data_to_flush:
            # Use a thread to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(None, self._write_log_data_to_db, data_to_flush)
                logger.info(f"Flushed {len(data_to_flush)} log records to database")
            except Exception as e:
                logger.error(f"Error flushing log buffer: {e}")
    
    def _write_encoder_data_to_db(self, data_list):
        """Write a batch of encoder data to database (runs in thread)"""
        db = SessionLocal()
        start_time = time.time()
        try:
            # Prepare all encoder objects
            encoder_objects = []
            robot_ids = set()
            
            for data in data_list:
                robot_id = data.get("robot_id", "unknown")
                robot_ids.add(robot_id)
                
                encoder_objects.append(EncoderData(
                    robot_id=robot_id,
                    rpm_1=data.get("rpm1", 0),
                    rpm_2=data.get("rpm2", 0),
                    rpm_3=data.get("rpm3", 0),
                    raw_data=data,
                    timestamp=datetime.fromtimestamp(data.get("timestamp", time.time()))
                ))
            
            # Bulk insert all objects in one transaction
            if encoder_objects:
                db.add_all(encoder_objects)
                
                # Update robot last_seen timestamp
                for robot_id in robot_ids:
                    self._ensure_robot_exists(db, robot_id)
                
                db.commit()
                
        except Exception as e:
            db.rollback()
            logger.error(f"Database error in encoder batch write: {e}")
            raise
        finally:
            db.close()
            logger.debug(f"Encoder batch write took {time.time() - start_time:.3f}s")
    
    def _write_imu_data_to_db(self, data_list):
        """Write a batch of IMU data to database (runs in thread)"""
        db = SessionLocal()
        start_time = time.time()
        try:
            # Prepare all IMU objects
            imu_objects = []
            robot_ids = set()
            
            for data in data_list:
                robot_id = data.get("robot_id", "unknown")
                robot_ids.add(robot_id)
                
                imu_objects.append(IMUData(
                    robot_id=robot_id,
                    roll=data.get("roll", 0),
                    pitch=data.get("pitch", 0),
                    yaw=data.get("yaw", 0),
                    quat_w=data.get("qw", 1),
                    quat_x=data.get("qx", 0),
                    quat_y=data.get("qy", 0),
                    quat_z=data.get("qz", 0),
                    raw_data=data,
                    timestamp=datetime.fromtimestamp(data.get("timestamp", time.time()))
                ))
            
            # Bulk insert all objects in one transaction
            if imu_objects:
                db.add_all(imu_objects)
                
                # Update robot last_seen timestamp
                for robot_id in robot_ids:
                    self._ensure_robot_exists(db, robot_id)
                
                db.commit()
                
        except Exception as e:
            db.rollback()
            logger.error(f"Database error in IMU batch write: {e}")
            raise
        finally:
            db.close()
            logger.debug(f"IMU batch write took {time.time() - start_time:.3f}s")
    
    def _write_log_data_to_db(self, data_list):
        """Write a batch of log data to database (runs in thread)"""
        db = SessionLocal()
        start_time = time.time()
        try:
            # Prepare all log objects
            log_objects = []
            
            for data in data_list:
                robot_id = data.get("robot_id", "unknown")
                message = data.get("message", "Unknown log")
                
                log_objects.append(LogData(
                    robot_id=robot_id,
                    log_level=data.get("log_level", "INFO"),
                    message=message,
                    robot_data=True,
                    raw_data=data,
                    timestamp=datetime.fromtimestamp(data.get("timestamp", time.time()))
                ))
            
            # Bulk insert all objects in one transaction
            if log_objects:
                db.add_all(log_objects)
                db.commit()
                
        except Exception as e:
            db.rollback()
            logger.error(f"Database error in log batch write: {e}")
            raise
        finally:
            db.close()
            logger.debug(f"Log batch write took {time.time() - start_time:.3f}s")
    
    def _ensure_robot_exists(self, db: Session, robot_id: str):
        """Ensure robot exists in database, create if not"""
        robot = db.query(Robot).filter(Robot.robot_id == robot_id).first()
        
        if not robot:
            # Create new robot
            robot = Robot(
                robot_id=robot_id,
                name=f"Robot {robot_id}",
                description=f"Automatically created for robot ID {robot_id}"
            )
            db.add(robot)
        else:
            # Update last seen
            robot.last_seen = datetime.utcnow()

# Create global instance
buffer_service = DataBufferService(max_buffer_size=50, flush_interval_seconds=0.5)