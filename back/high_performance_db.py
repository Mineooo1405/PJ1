import sqlite3
import threading
import queue
import time
import json
import logging
from datetime import datetime
import os

logger = logging.getLogger("high_performance_db")

class HighPerformanceDBWriter:
    """
    High performance database writer optimized for high-frequency data
    Uses SQLite in WAL mode with dedicated writer thread
    """
    
    def __init__(self, db_path='./robot_data.db', max_queue_size=10000, batch_size=200):
        self.db_path = db_path
        self.queue = queue.Queue(maxsize=max_queue_size)
        self.batch_size = batch_size
        self.running = False
        self.writer_thread = None
        self.stats = {
            'enqueued': 0,
            'written': 0,
            'dropped': 0,
            'last_write_time': 0,
            'avg_write_time': 0,
            'total_write_time': 0,
            'write_count': 0
        }
        
        # Ensure database exists and has the correct schema
        self._initialize_database()
    
    def _initialize_database(self):
        """Create database and tables if they don't exist"""
        # Ensure directory exists
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        
        # Enable WAL mode for better concurrent performance
        c.execute('PRAGMA journal_mode=WAL')
        
        # Create tables if they don't exist
        c.execute('''
        CREATE TABLE IF NOT EXISTS robots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            robot_id TEXT UNIQUE,
            name TEXT,
            description TEXT,
            online BOOLEAN DEFAULT 0,
            status TEXT DEFAULT 'unknown',
            last_seen TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        c.execute('''
        CREATE TABLE IF NOT EXISTS encoder_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            robot_id TEXT,
            rpm_1 REAL,
            rpm_2 REAL,
            rpm_3 REAL,
            timestamp TIMESTAMP,
            raw_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        c.execute('''
        CREATE TABLE IF NOT EXISTS imu_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            robot_id TEXT,
            roll REAL,
            pitch REAL,
            yaw REAL,
            quat_w REAL,
            quat_x REAL,
            quat_y REAL,
            quat_z REAL,
            timestamp TIMESTAMP,
            raw_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Create indices for faster queries
        c.execute('CREATE INDEX IF NOT EXISTS idx_encoder_robot_time ON encoder_data (robot_id, timestamp)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_imu_robot_time ON imu_data (robot_id, timestamp)')
        
        conn.commit()
        conn.close()
        logger.info(f"Database initialized at {self.db_path} in WAL mode")
    
    def start(self):
        """Start the database writer thread"""
        if self.running:
            return
        
        self.running = True
        self.writer_thread = threading.Thread(target=self._writer_loop, daemon=True)
        self.writer_thread.start()
        logger.info("Database writer thread started")
    
    def stop(self):
        """Stop the database writer thread"""
        if not self.running:
            return
        
        logger.info("Stopping database writer thread, writing remaining data...")
        self.running = False
        if self.writer_thread:
            self.writer_thread.join(timeout=10.0)
            logger.info("Database writer thread stopped")
    
    def enqueue_data(self, data_type, data):
        """Add data to the queue for writing"""
        try:
            if not self.running:
                logger.warning("Cannot enqueue data - writer not running")
                return False
            
            self.queue.put_nowait((data_type, data))
            self.stats['enqueued'] += 1
            return True
        except queue.Full:
            self.stats['dropped'] += 1
            logger.warning(f"Queue full, dropping {data_type} data")
            return False
    
    def _writer_loop(self):
        """Background thread that writes data to database in batches"""
        conn = None
        try:
            # Connect to database
            conn = sqlite3.connect(self.db_path)
            conn.execute('PRAGMA journal_mode=WAL')  # Confirm WAL mode
            conn.execute('PRAGMA synchronous=NORMAL')  # Slightly faster, still safe
            conn.execute('PRAGMA temp_store=MEMORY')  # Use memory for temp storage
            conn.execute('PRAGMA cache_size=10000')  # Use more memory for caching
            conn.execute('PRAGMA mmap_size=30000000')  # Memory map the database
            
            # Processing loop
            batch = []
            last_write = time.time()
            
            while self.running or not self.queue.empty():
                try:
                    # Get data with timeout to allow checking running state
                    try:
                        data_type, data = self.queue.get(timeout=0.5)
                        batch.append((data_type, data))
                    except queue.Empty:
                        # If no new data and we have a batch, write it
                        if batch:
                            self._write_batch(conn, batch)
                            batch = []
                            last_write = time.time()
                        continue
                    
                    # Write batch if it's full or enough time has passed
                    if len(batch) >= self.batch_size or (time.time() - last_write) > 0.5:
                        self._write_batch(conn, batch)
                        batch = []
                        last_write = time.time()
                        
                except Exception as e:
                    logger.error(f"Error in database writer loop: {e}")
                    # Try to recover
                    if batch:
                        logger.warning(f"Discarding batch of {len(batch)} items due to error")
                        batch = []
                    time.sleep(1.0)  # Brief pause to avoid thrashing
            
            # Write any remaining data
            if batch:
                self._write_batch(conn, batch)
                
        except Exception as e:
            logger.error(f"Fatal error in database writer thread: {e}")
        finally:
            if conn:
                conn.close()
                logger.info("Database connection closed")
    
    def _write_batch(self, conn, batch):
        """Write a batch of data to database"""
        if not batch:
            return
            
        start_time = time.time()
        
        # Group data by type
        encoder_data = []
        imu_data = []
        
        for data_type, data in batch:
            if data_type == "encoder":
                encoder_data.append(data)
            elif data_type == "imu":
                imu_data.append(data)
        
        # Use a transaction for the batch
        with conn:  # This automatically manages the transaction
            try:
                # Insert encoder data
                if encoder_data:
                    conn.executemany(
                        '''INSERT INTO encoder_data 
                           (robot_id, rpm_1, rpm_2, rpm_3, timestamp, raw_data) 
                           VALUES (?, ?, ?, ?, ?, ?)''',
                        [(
                            d.get("robot_id", "unknown"),
                            d.get("rpm1", 0.0),
                            d.get("rpm2", 0.0),
                            d.get("rpm3", 0.0),
                            datetime.fromtimestamp(d.get("timestamp", time.time())).isoformat(),
                            json.dumps(d)
                        ) for d in encoder_data]
                    )
                
                # Insert IMU data
                if imu_data:
                    conn.executemany(
                        '''INSERT INTO imu_data 
                           (robot_id, roll, pitch, yaw, quat_w, quat_x, quat_y, quat_z, timestamp, raw_data) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                        [(
                            d.get("robot_id", "unknown"),
                            d.get("roll", 0.0),
                            d.get("pitch", 0.0),
                            d.get("yaw", 0.0),
                            d.get("qw", 1.0),
                            d.get("qx", 0.0),
                            d.get("qy", 0.0),
                            d.get("qz", 0.0),
                            datetime.fromtimestamp(d.get("timestamp", time.time())).isoformat(),
                            json.dumps(d)
                        ) for d in imu_data]
                    )
                    
                # Update robot last seen time
                robot_ids = set([d.get("robot_id") for d in encoder_data + imu_data])
                for robot_id in robot_ids:
                    conn.execute(
                        '''INSERT INTO robots (robot_id, name, online, last_seen) 
                           VALUES (?, ?, 1, ?) 
                           ON CONFLICT(robot_id) 
                           DO UPDATE SET last_seen=excluded.last_seen, online=1''',
                        (robot_id, f"Robot {robot_id}", datetime.now().isoformat())
                    )
                
                self.stats['written'] += len(batch)
                
            except Exception as e:
                logger.error(f"Error writing batch to database: {e}")
                # Transaction will be automatically rolled back
        
        # Update timing stats
        duration = time.time() - start_time
        self.stats['last_write_time'] = duration
        self.stats['total_write_time'] += duration
        self.stats['write_count'] += 1
        self.stats['avg_write_time'] = self.stats['total_write_time'] / self.stats['write_count']
        
        if len(batch) > 10:
            logger.info(f"Wrote batch of {len(batch)} items in {duration:.3f}s ({len(batch)/duration:.1f} items/sec)")
    
    def get_stats(self):
        """Get current statistics"""
        stats = self.stats.copy()
        stats['queue_size'] = self.queue.qsize()
        stats['queue_full_percent'] = (self.queue.qsize() / self.queue.maxsize) * 100 if self.queue.maxsize > 0 else 0
        return stats

# Create global instance
db_writer = HighPerformanceDBWriter(db_path='./robot_data.db', batch_size=200, max_queue_size=100000)