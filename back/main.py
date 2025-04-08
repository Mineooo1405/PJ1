import asyncio
import json
import time
import traceback
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager
# Replace old database imports with new ones
from robot_database import SessionLocal, Robot, EncoderData, IMUData, LogData, TrajectoryCalculator, TrajectoryData
from websockets.exceptions import ConnectionClosedOK, ConnectionClosedError
import logging
from data_converter import DataConverter
from trajectory_service import TrajectoryService
from datetime import datetime, timedelta
import math
import random
import numpy as np
from typing import Dict, Set, List
from fastapi.security import APIKeyHeader
from connection_manager import ConnectionManager
from sqlalchemy import create_engine, Column, Integer, Float, String, Boolean, DateTime, ForeignKey, ARRAY, desc
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.dialects.postgresql import JSONB
from robot_database import Base
from data_buffer_service import buffer_service
import aiohttp

# Thêm kết nối đến SQLite database
import sqlite3
from contextlib import contextmanager

# Đường dẫn đến file database
SQLITE_DB_PATH = './robot_data.db'

@contextmanager
def get_sqlite_connection():
    """Context manager for SQLite database connection"""
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row  # Get rows as dictionaries
    try:
        yield conn
    finally:
        conn.close()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("websocket")

imu_subscribers: Dict[str, Set[WebSocket]] = {}
encoder_subscribers: Dict[str, Set[WebSocket]] = {}

class PIDConfig(Base):
    __tablename__ = "pid_configs"
    __table_args__ = {'extend_existing': True}  # Add this line
    id = Column(Integer, primary_key=True)
    robot_id = Column(String, index=True)
    motor_id = Column(Integer)  # 1, 2, 3
    kp = Column(Float)
    ki = Column(Float)
    kd = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)
    raw_data = Column(JSONB, nullable=True)  # Store full JSON message
    robot_data = Column(Boolean, default=True)  # Flag to differentiate data source

# Create tables if they don't exist
from robot_database import engine
Base.metadata.create_all(bind=engine)

# Database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Constants for connection
HEARTBEAT_INTERVAL = 15  # seconds
MAX_INACTIVE_TIME = 600  # 10 minutes - very high to prevent automatic disconnection

# Replace the old lifespan handler with this new one
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start buffer service
    await buffer_service.start()
    
    # Start background tasks
    encoder_task = asyncio.create_task(broadcast_encoder_updates())
    imu_task = asyncio.create_task(broadcast_imu_updates())
    
    print("Background tasks started")
    yield
    
    # Clean up
    encoder_task.cancel()
    imu_task.cancel()
    await buffer_service.stop()
    print("Background tasks and buffer service stopped")

# Create FastAPI app with the lifespan handler
app = FastAPI(lifespan=lifespan)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400
)

# Store app start time for uptime tracking
app.state.start_time = time.time()

#tcp
import socket
import traceback

# Root endpoint for health check
@app.get("/")
def root():
    return {
        "status": "online",
        "message": "WebSocket server is running",
        "time": datetime.now().isoformat()
    }

# Health check endpoint
@app.get("/api/health-check")
async def health_check():
    return {
        "status": "ok",
        "time": datetime.now().isoformat(),
        "version": "1.0.0"
    }

# WebSocket handler for robot connections
async def handle_robot_connection(ws: WebSocket, robot_id: str):
    """Handle WebSocket connection for a specific robot"""
    # Use normalized robot_id
    robot_id = ConnectionManager.normalize_robot_id(robot_id)
    client_id = f"{ws.client.host}:{ws.client.port}"
    print(f"Connection request from {client_id} for {robot_id}")
    print(f"Active connections for {robot_id}: {len(ConnectionManager.get_websockets(robot_id))}")
    
    # Khởi tạo heartbeat task
    heartbeat_task = None
    
    try:
        # Accept connection immediately
        await ws.accept()
        print(f"Accepted {robot_id} connection from {client_id}")
        
        # Store metadata
        ws.connected_since = time.time()
        ws.last_activity = time.time()
        ws.client_id = client_id
        ws.robot_id = robot_id
        ws.manual_disconnect = False  # Flag to track manual disconnection
        
        # Add to connection manager
        ConnectionManager.add_websocket(robot_id, ws)
        
        # Send confirmation
        await ws.send_text(json.dumps({
            "status": "connected", 
            "robot_id": robot_id,
            "timestamp": time.time()
        }))
        
        # Khởi động heartbeat để giữ kết nối
        heartbeat_task = asyncio.create_task(send_heartbeat(ws, robot_id))
        
        # Send initial data
        try:
            await send_dummy_robot_data(ws, robot_id)
        except Exception as e:
            print(f"Error sending initial data for {robot_id}: {e}")
            await ws.send_text(json.dumps({
                "type": "partial_data",
                "robot_id": robot_id,
                "timestamp": time.time(),
                "message": "Initial data incomplete, will be updated shortly"
            }))
        
        # Main message loop - KHÔNG tự động ngắt kết nối
        while True:
            try:
                # Thời gian chờ đọc message cao hơn để tránh timeout
                data = await asyncio.wait_for(ws.receive_text(), timeout=MAX_INACTIVE_TIME)
                ws.last_activity = time.time()
                
                # Process command
                try:
                    json_data = json.loads(data)
                    
                    # Kiểm tra xem client có yêu cầu ngắt kết nối không
                    if json_data.get("type") == "manual_disconnect":
                        print(f"Client {client_id} requested manual disconnect from {robot_id}")
                        ws.manual_disconnect = True
                        await ws.send_text(json.dumps({
                            "type": "disconnect_confirmed",
                            "robot_id": robot_id,
                            "timestamp": time.time(),
                            "message": "Disconnect request accepted"
                        }))
                        break
                    
                    await process_websocket_message(ws, data, robot_id, SessionLocal())
                except json.JSONDecodeError:
                    await ws.send_text(json.dumps({
                        "status": "error",
                        "message": "Invalid JSON data",
                        "timestamp": time.time()
                    }))
            except asyncio.TimeoutError:
                # Không ngắt kết nối khi timeout - chỉ log và gửi ping
                current_time = time.time()
                inactive_time = current_time - ws.last_activity
                print(f"Client {client_id} inactive for {inactive_time:.1f}s")
                
                # Gửi ping để kiểm tra kết nối vẫn sống
                try:
                    await ws.send_text(json.dumps({
                        "type": "ping",
                        "robot_id": robot_id,
                        "timestamp": current_time
                    }))
                    ws.last_activity = current_time
                except Exception as e:
                    print(f"Cannot send ping to inactive client {client_id}: {e}")
                    break  # Chỉ ngắt kết nối khi không gửi được tin nhắn
            except WebSocketDisconnect:
                print(f"Client {client_id} disconnected from {robot_id}")
                break
            except ConnectionClosedOK:
                print(f"Client {client_id} closed connection normally from {robot_id}")
                break
            except ConnectionClosedError:
                print(f"Client {client_id} connection closed with error from {robot_id}")
                break
            except Exception as e:
                print(f"Error in {robot_id} loop: {e}")
                break
    
    except Exception as e:
        print(f"ERROR in {robot_id} connection: {e}")
    
    finally:
        # Hủy heartbeat task khi kết thúc
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
            
        # Clean up with connection manager
        ConnectionManager.remove_websocket(robot_id, ws)
        
        disconnect_type = "manual" if getattr(ws, "manual_disconnect", False) else "automatic"
        print(f"{robot_id} connection closed for {client_id} ({disconnect_type} disconnect)")
        print(f"Remaining {robot_id} connections: {len(ConnectionManager.get_websockets(robot_id))}")

# Thêm hàm heartbeat để giữ kết nối ổn định
async def send_heartbeat(ws: WebSocket, robot_id: str):
    """Send periodic heartbeat to client to keep connection alive"""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            try:
                await ws.send_text(json.dumps({
                    "type": "ping",
                    "robot_id": robot_id,
                    "timestamp": time.time()
                }))
            except Exception as e:
                # Nếu không gửi được, thoát khỏi vòng lặp
                print(f"Heartbeat failed for {robot_id}: {e}")
                break
    except asyncio.CancelledError:
        # Normal cancellation when connection closes
        pass

@app.websocket("/ws/server")
async def server_endpoint(ws: WebSocket):
    await handle_robot_connection(ws, "server")

@app.websocket("/ws/{robot_id}")  # Changed from /ws/{robot_id}
async def robot_endpoint(websocket: WebSocket, robot_id: str):
    # Handle specialized endpoints with parameter
    robot_id = ConnectionManager.normalize_robot_id(robot_id)
    await handle_robot_connection(websocket, robot_id)

@app.websocket("/ws/{robot_id}/encoder")
async def websocket_encoder_endpoint(websocket: WebSocket, robot_id: str):
    await websocket.accept()
    try:
        # Lấy dữ liệu encoder mới nhất từ SQLite
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM encoder_data WHERE robot_id = ? ORDER BY timestamp DESC LIMIT 10",
                (robot_id,)
            )
            rows = cursor.fetchall()
            
            # Gửi dữ liệu qua WebSocket
            for row in rows:
                # Parse raw_data JSON
                raw_data = json.loads(row['raw_data'])
                await websocket.send_json({
                    "type": "encoder_data",
                    "robot_id": row['robot_id'],
                    "rpm1": row['rpm_1'],
                    "rpm2": row['rpm_2'],
                    "rpm3": row['rpm_3'],
                    "timestamp": row['timestamp'],
                    "raw_data": raw_data
                })
                
        # Thiết lập mô hình subscribe
        while True:
            data = await websocket.receive_text()
            # Process commands if needed
    except WebSocketDisconnect:
        # Handle disconnect
        pass

# Send robot data from database when connected
async def send_dummy_robot_data(ws: WebSocket, robot_id: str):
    """Send robot data when connected, trying to use database values first"""
    try:
        # Create database session
        db = SessionLocal()
        
        # Get latest IMU data
        latest_imu = db.query(IMUData).filter(
            IMUData.robot_id == robot_id
        ).order_by(IMUData.timestamp.desc()).first()
        
        # Get latest encoder data
        latest_encoder = db.query(EncoderData).filter(
            EncoderData.robot_id == robot_id
        ).order_by(EncoderData.timestamp.desc()).first()
        
        # Get latest trajectory data
        latest_trajectory = db.query(TrajectoryData).filter(
            TrajectoryData.robot_id == robot_id
        ).order_by(TrajectoryData.timestamp.desc()).first()
        
        # Generate robot data, using database values when available
        robot_data = {
            "type": "initial_data",
            "robot_id": robot_id,
            "timestamp": time.time(),
            "status": {
                "connected": True,
                "lastUpdate": datetime.now().isoformat(),
                "position": {
                    "x": latest_trajectory.current_x if latest_trajectory else random.uniform(-0.5, 0.5),
                    "y": latest_trajectory.current_y if latest_trajectory else random.uniform(-0.5, 0.5),
                    "theta": latest_trajectory.current_theta if latest_trajectory else random.uniform(-3.14, 3.14)
                },
                "encoders": {
                    "values": DataConverter.encoder_to_frontend(latest_encoder)["values"] if latest_encoder else [1000, 1050, 1100],
                    "rpm": DataConverter.encoder_to_frontend(latest_encoder)["rpm"] if latest_encoder else [
                        random.uniform(-30, 30),
                        random.uniform(-30, 30),
                        random.uniform(-30, 30)
                    ]
                },
                "battery": {
                    "voltage": 12.0 - random.uniform(0, 1.5),
                    "percent": random.randint(60, 100)
                },
                "pid": {
                    "motor1": {"kp": 0.5, "ki": 0.1, "kd": 0.05},
                    "motor2": {"kp": 0.5, "ki": 0.1, "kd": 0.05},
                    "motor3": {"kp": 0.5, "ki": 0.1, "kd": 0.05}
                }
            },
            "trajectory": {}
        }
        
        # Add trajectory data if available
        if latest_trajectory and latest_trajectory.points:
            robot_data["trajectory"] = latest_trajectory.points
        else:
            # Generate a simple trajectory
            trajectory_x = []
            trajectory_y = []
            for i in range(50):
                angle = i * 0.1
                radius = 1.0
                trajectory_x.append(radius * math.cos(angle))
                trajectory_y.append(radius * math.sin(angle))
            robot_data["trajectory"] = {
                "x": trajectory_x,
                "y": trajectory_y
            }
        
        # Add IMU data if available
        if latest_imu:
            imu_data = DataConverter.imu_to_frontend(latest_imu)
            robot_data["imu"] = imu_data
        else:
            # Generate random IMU data as fallback
            robot_data["imu"] = {
                "orientation": {
                    "roll": random.uniform(-0.1, 0.1),
                    "pitch": random.uniform(-0.1, 0.1),
                    "yaw": robot_data["status"]["position"]["theta"]
                },
                "acceleration": {
                    "x": 0.0,
                    "y": 0.0,
                    "z": 9.8
                },
                "angular_velocity": {
                    "x": 0.0,
                    "y": 0.0,
                    "z": 0.0
                },
                "timestamp": datetime.now().isoformat()
            }
        
        await ws.send_text(json.dumps(robot_data))
        logger.info(f"Sent initial data to {robot_id} (using database: {True if latest_imu or latest_encoder or latest_trajectory else False})")
    except Exception as e:
        logger.error(f"Error sending initial robot data: {e}")
        # Send a simplified response that doesn't rely on database
        await ws.send_text(json.dumps({
            "type": "status",
            "robot_id": robot_id,
            "message": f"Connected successfully, but database data unavailable: {str(e)}",
            "timestamp": time.time()
        }))
    finally:
        db.close()

# Process robot commands - đặc biệt quan tâm đến ping/pong
async def process_robot_command(robot_id: str, data: dict, ws: WebSocket):
    """Process command from a robot connection"""
    try:
        command_type = data.get("type", "")
        
        # Common response data
        response_base = {
            "timestamp": time.time(),
            "robot_id": robot_id
        }
        
        # XỬ LÝ PING - Ưu tiên cao nhất để giữ kết nối sống
        if command_type == "ping":
            # Cập nhật last_activity của WebSocket
            ws.last_activity = time.time()
            
            # Trả về pong ngay lập tức với timestamp từ ping để tính RTT
            await ws.send_text(json.dumps({
                **response_base,
                "type": "pong",
                "timestamp": data.get("timestamp", time.time())
            }))
            return
        # Lấy dữ liệu quỹ đạo từ database
        elif command_type == "get_trajectory":
            try:
                # Create database session
                db = SessionLocal()
                
                # Get latest trajectory data
                latest_trajectories = DataConverter.get_latest_data_by_robot(db, TrajectoryData, robot_id, 1)
                
                if latest_trajectories and len(latest_trajectories) > 0:
                    # Convert to frontend format
                    trajectory_data = DataConverter.trajectory_to_frontend(latest_trajectories[0])
                    
                    await ws.send_text(json.dumps({
                        **response_base,
                        "type": "trajectory_data",
                        **trajectory_data
                    }))
                    logger.info(f"Sent database trajectory data for {robot_id}")
                else:
                    # No trajectory data, generate sample data as fallback
                    x_points = [0]
                    y_points = [0]
                    theta_points = [0]
                    
                    # Generate a simple spiral curve for demo purposes
                    for i in range(1, 101):
                        angle = i * 0.1
                        r = i * 0.02
                        x_points.append(r * math.cos(angle))
                        y_points.append(r * math.sin(angle))
                        theta_points.append(angle)
                    
                    await ws.send_text(json.dumps({
                        **response_base,
                        "type": "trajectory_data",
                        "points": {
                            "x": x_points,
                            "y": y_points,
                            "theta": theta_points
                        },
                        "current_position": {
                            "x": x_points[-1],
                            "y": y_points[-1],
                            "theta": theta_points[-1]
                        },
                        "timestamp": datetime.now().isoformat()
                    }))
                    logger.info(f"No trajectory data found for {robot_id}, sent generated data")
            except Exception as e:
                logger.error(f"Error retrieving trajectory data: {str(e)}")
                logger.error(traceback.format_exc())
                await ws.send_text(json.dumps({
                    **response_base,
                    "type": "error",
                    "message": f"Database error: {str(e)}"
                }))
            finally:
                db.close()
            
        # Đăng ký/hủy đăng ký nhận cập nhật quỹ đạo trực tiếp
        elif command_type == "subscribe_trajectory":
            # Trong demo này chỉ thiết lập một thuộc tính, trong thực tế bạn cần lưu trạng thái này
            ws.subscribe_trajectory = True
            await ws.send_text(json.dumps({
                **response_base,
                "type": "subscription_status",
                "service": "trajectory",
                "status": "subscribed"
            }))
            
        elif command_type == "unsubscribe_trajectory":
            # Hủy đăng ký
            ws.subscribe_trajectory = False
            await ws.send_text(json.dumps({
                **response_base,
                "type": "subscription_status",
                "service": "trajectory",
                "status": "unsubscribed"
            }))
            
        # Xử lý điều khiển động cơ
        elif command_type == "motor_control":
            # Extract motor speeds
            speeds = data.get("speeds", [0, 0, 0])
            
            # Log the command
            logger.info(f"Motor control command received for {robot_id}: speeds={speeds}")
            
            # Forward to TCP server
            tcp_prefix = f"[{robot_id}:MOTOR] "
            
        # Xử lý lệnh chuyển động
        elif command_type == "motion_command":
            velocities = data.get("velocities", {})
            
            await ws.send_text(json.dumps({
                **response_base,
                "type": "motion_response",
                "status": "success",
                "velocities": velocities,
                "message": f"Motion command set: vx={velocities.get('x', 0)}, vy={velocities.get('y', 0)}, omega={velocities.get('theta', 0)}"
            }))
            
        # Xử lý đặt lại vị trí
        elif command_type == "reset_position":
            await ws.send_text(json.dumps({
                **response_base,
                "type": "position_response",
                "status": "success",
                "position": {"x": 0, "y": 0, "theta": 0},
                "message": "Position reset successfully"
            }))

        elif command_type == "get_trajectory_history":
            try:
                db = SessionLocal()
                time_filter = data.get('time_filter', '24h')
                limit = data.get('limit', 100)  # Default 100 records max
                
                # Calculate time range based on filter
                end_time = datetime.now()
                start_time = None
                
                if time_filter == '24h':
                    start_time = end_time - timedelta(hours=24)
                elif time_filter == '7d':
                    start_time = end_time - timedelta(days=7)
                elif time_filter == '30d':
                    start_time = end_time - timedelta(days=30)
                # For 'all', no start_time filter
                
                # Query trajectory data
                query = db.query(TrajectoryData).filter(TrajectoryData.robot_id == robot_id)
                
                if start_time:
                    query = query.filter(TrajectoryData.timestamp >= start_time)
                
                # Order by timestamp descending (newest first) and limit results
                trajectories = query.order_by(TrajectoryData.timestamp.desc()).limit(limit).all()
                
                # Format trajectories for frontend
                trajectory_list = []
                
                for traj in trajectories:
                    # Convert database model to dictionary format expected by frontend
                    points = {}
                    if traj.points:
                        if isinstance(traj.points, str):
                            try:
                                points = json.loads(traj.points)
                            except:
                                points = {"x": [], "y": [], "theta": []}
                        else:
                            points = traj.points
                            
                    # Ensure points has the expected structure
                    if not isinstance(points, dict) or not all(k in points for k in ["x", "y", "theta"]):
                        points = {"x": [], "y": [], "theta": []}
                            
                    # Create trajectory record in expected format
                    trajectory_record = {
                        "id": traj.id,
                        "timestamp": traj.timestamp.isoformat() if traj.timestamp else datetime.now().isoformat(),
                        "currentPosition": {
                            "x": float(traj.current_x) if traj.current_x is not None else 0.0,
                            "y": float(traj.current_y) if traj.current_y is not None else 0.0,
                            "theta": float(traj.current_theta) if traj.current_theta is not None else 0.0,
                        },
                        "points": points,
                        "status": traj.status or "unknown"
                    }
                    
                    trajectory_list.append(trajectory_record)
                
                # Send trajectories to client
                await ws.send_text(json.dumps({
                    **response_base,
                    "type": "trajectory_history",
                    "trajectories": trajectory_list,
                    "count": len(trajectory_list),
                    "time_filter": time_filter
                }))
                
                logger.info(f"Sent {len(trajectory_list)} trajectory records to client for robot {robot_id}")
                
            except Exception as e:
                logger.error(f"Error retrieving trajectory history: {str(e)}")
                logger.error(traceback.format_exc())
                
                await ws.send_text(json.dumps({
                    **response_base,
                    "type": "error",
                    "message": f"Error retrieving trajectory history: {str(e)}"
                }))
            finally:
                db.close()
            
        elif command_type == "get_imu_data":
            db = SessionLocal()
            try:
                await handle_get_imu_data(ws, robot_id, db)
            finally:
                db.close()

        elif command_type == "subscribe_imu":
            await handle_subscribe_imu(ws, robot_id)

        elif command_type == "unsubscribe_imu":
            await handle_unsubscribe_imu(ws, robot_id)

        elif command_type == "get_pid_data":
            db = SessionLocal()
            try:
                await handle_get_pid_data(ws, robot_id, db)
            finally:
                db.close()

        elif command_type == "get_encoder_data":
            db = SessionLocal()
            try:
                await handle_get_encoder_data(ws, robot_id, db)
            finally:
                db.close()

        elif command_type == "subscribe_encoder":
            await handle_subscribe_encoder(ws, robot_id)

        elif command_type == "unsubscribe_encoder":
            await handle_unsubscribe_encoder(ws, robot_id)

        elif command_type == "get_encoder_data_since":
            await handle_get_encoder_data_since(ws, robot_id, data)

        elif command_type == "get_imu_data_since":
            await handle_get_imu_data_since(ws, robot_id, data)

        # Các lệnh không xử lý được
        else:
            await ws.send_text(json.dumps({
                **response_base,
                "type": "error",
                "message": f"Unknown command type: {command_type}"
            }))
    
    except Exception as e:
        # Send error response
        await ws.send_text(json.dumps({
            "type": "error",
            "robot_id": robot_id,
            "message": f"Error processing command: {str(e)}",
            "timestamp": time.time()
        }))

@app.get("/api/connection-status")
async def get_connection_status():
    """Get the status of all WebSocket connections"""
    try:
        # Calculate server uptime
        uptime_seconds = time.time() - app.state.start_time
        uptime = {
            "days": int(uptime_seconds / 86400),
            "hours": int((uptime_seconds % 86400) / 3600),
            "minutes": int((uptime_seconds % 3600) / 60),
            "seconds": int(uptime_seconds % 60),
            "total_seconds": uptime_seconds
        }
        
        # Get WebSocket connection counts
        ws_connections = ConnectionManager.get_connection_counts()
        
        # Get active connections with client info
        active_connections = ConnectionManager.get_active_connections()
        
        return {
            "status": "ok",
            "server": {
                "start_time": datetime.fromtimestamp(app.state.start_time).isoformat(),
                "uptime": uptime,
                "current_time": datetime.now().isoformat()
            },
            "websocket_connections": ws_connections,
            "total_connections": sum(ws_connections.values()),
            "active_connections": active_connections,
            "timestamp": time.time()
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "timestamp": time.time()
        }

@app.get("/api/check-tcp-server")
async def check_tcp_server():
    """Check if TCP server is running"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', 9000))
        is_running = (result == 0)
        sock.close()
        
        return {"status": "ok" if is_running else "error"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/robot-data")
async def receive_robot_data(data: dict):
    """Receive data from DirectBridge for all robots"""
    try:
        # Extract and validate robot_id
        robot_id = data.get("robot_id")
        if not robot_id:
            return {"status": "error", "message": "Missing robot_id in data"}
            
        # Normalize robot_id to match expected format
        robot_id = ConnectionManager.normalize_robot_id(robot_id)
        
        # Validate that this is a known robot
        valid_robots = ["robot1", "robot2", "robot3", "robot4", "server"]
        if robot_id not in valid_robots:
            logger.warning(f"Received data for unknown robot_id: {robot_id}")
            return {
                "status": "error", 
                "message": f"Unknown robot_id: {robot_id}. Valid IDs are: {valid_robots}"
            }
        
        # Process based on message type
        message_type = data.get("type", "unknown")
        
        # Instead of immediately writing to database, add to buffer
        if message_type == "encoder":
            # Add to encoder buffer
            await buffer_service.add_encoder_data(data)
                
        elif message_type == "imu":
            # Add to IMU buffer
            await buffer_service.add_imu_data(data)
                
        elif message_type in ["heartbeat", "status"]:
            # Still update robot status in database immediately - this is low frequency
            db = SessionLocal()
            try:
                robot = db.query(Robot).filter(Robot.robot_id == robot_id).first()
                if robot:
                    robot.last_seen = datetime.now()
                    robot.online = True
                    robot.status = data.get("status", robot.status)
                else:
                    # Create a new robot record
                    robot = Robot(
                        robot_id=robot_id,
                        name=f"Robot {robot_id.replace('robot', '')}",
                        online=True,
                        last_seen=datetime.now(),
                        status=data.get("status", "unknown")
                    )
                    db.add(robot)
                
                db.commit()
            finally:
                db.close()
                
        else:
            # Add as general log
            await buffer_service.add_log_data({
                "robot_id": robot_id,
                "log_level": "INFO",
                "message": f"Data: {message_type}",
                "raw_data": data,
                "timestamp": data.get("timestamp", time.time())
            })
                
        # Try to update any connected websockets with this new data
        try:
            for ws in ConnectionManager.get_websockets(robot_id):
                # If the websocket has subscribed to this data type, send an update
                if message_type == "imu" and getattr(ws, "subscribe_imu", False):
                    await ws.send_json({
                        "type": "imu_update",
                        "robot_id": robot_id,
                        "data": data,
                        "timestamp": time.time()
                    })
                if message_type == "encoder" and getattr(ws, "subscribe_encoder", False):
                    await ws.send_json({
                        "type": "encoder_update",
                        "robot_id": robot_id,
                        "data": data,
                        "timestamp": time.time()
                    })
        except Exception as ws_err:
            logger.error(f"Error updating websockets: {str(ws_err)}")
                
        return {
            "status": "success", 
            "message": f"Processed {message_type} data for {robot_id}",
            "timestamp": time.time()
        }
            
    except Exception as e:
        logger.error(f"Error processing robot data: {str(e)}")
        logger.error(traceback.format_exc())
        return {"status": "error", "message": str(e)}

@app.get("/api/db-stats")
async def get_db_stats():
    """Get database performance statistics"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://localhost:9003/db-stats') as response:
                if response.status == 200:
                    return await response.json()
                else:
                    return {"error": "Could not get database statistics"}
    except Exception as e:
        return {"error": str(e)}

async def get_robot_status_data(robot_id: str, db: Session = None):
    """Centralized function for getting robot status data from DB"""
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
        
    try:
        # Get latest encoder data
        latest_encoders = DataConverter.get_latest_data_by_robot(db, EncoderData, robot_id, 1)
        
        # Get latest trajectory data for position
        latest_trajectories = DataConverter.get_latest_data_by_robot(db, TrajectoryData, robot_id, 1)
        
        # Get PID configurations
        pid_configs = db.query(PIDConfig).filter(
            PIDConfig.robot_id == robot_id
        ).all()
        
        # Build response with real data when available
        encoder_data = latest_encoders[0] if latest_encoders else None
        trajectory_data = latest_trajectories[0] if latest_trajectories else None
        
        # Convert PID data
        pid_data = {}
        for config in pid_configs:
            pid_config_json = DataConverter.pid_to_frontend(config)
            motor_id = f"motor{pid_config_json['motor_id']}"
            pid_data[motor_id] = {
                "kp": pid_config_json["kp"],
                "ki": pid_config_json["ki"],
                "kd": pid_config_json["kd"]
            }
        
        # If no PID data found, provide defaults
        if not pid_data:
            pid_data = {
                "motor1": {"kp": 0.5, "ki": 0.1, "kd": 0.05},
                "motor2": {"kp": 0.5, "ki": 0.1, "kd": 0.05},
                "motor3": {"kp": 0.5, "ki": 0.1, "kd": 0.05}
            }
        
        # Process encoder data if available
        encoder_values = [1000, 1100, 1200]
        encoder_rpm = [50, 60, 70]
        if encoder_data:
            encoder_json = DataConverter.encoder_to_frontend(encoder_data)
            encoder_values = encoder_json.get("values", encoder_values)
            encoder_rpm = encoder_json.get("rpm", encoder_rpm)
        
        # Process position data if available
        position = {"x": 1.25, "y": 0.75, "theta": 0.5}
        if trajectory_data:
            trajectory_json = DataConverter.trajectory_to_frontend(trajectory_data)
            position = trajectory_json.get("current_position", position)
        
        # Return the robot status data
        return {
            "connected": True,
            "lastUpdate": datetime.now().isoformat(),
            "encoders": {
                "values": encoder_values,
                "rpm": encoder_rpm
            },
            "position": position,
            "battery": {
                "voltage": 11.8,
                "percent": 85
            },
            "pid": pid_data
        }
        
    finally:
        if close_db:
            db.close()

async def handle_get_imu_data(websocket: WebSocket, robot_id: str, db: Session):
    """Fetch the latest IMU data for a robot from the database"""
    try:
        # Query latest IMU data from database
        latest_imu = db.query(IMUData).filter(
            IMUData.robot_id == robot_id
        ).order_by(desc(IMUData.timestamp)).first()
        
        if latest_imu:
            # Send IMU data to client
            await websocket.send_json({
                "type": "imu_data",
                "robot_id": robot_id,
                "roll": latest_imu.roll,
                "pitch": latest_imu.pitch,
                "yaw": latest_imu.yaw,
                "quat_w": latest_imu.quat_w,
                "quat_x": latest_imu.quat_x,
                "quat_y": latest_imu.quat_y,
                "quat_z": latest_imu.quat_z,
                "timestamp": latest_imu.timestamp.timestamp()
            })
        else:
            await websocket.send_json({
                "type": "error",
                "message": f"No IMU data found for robot {robot_id}"
            })
    except Exception as e:
        logging.error(f"Error retrieving IMU data: {str(e)}")
        await websocket.send_json({
            "type": "error",
            "message": f"Error retrieving IMU data: {str(e)}"
        })

async def handle_subscribe_imu(websocket: WebSocket, robot_id: str):
    """Subscribe to IMU data updates for a specific robot"""
    if robot_id not in imu_subscribers:
        imu_subscribers[robot_id] = set()
    
    imu_subscribers[robot_id].add(websocket)
    logging.info(f"Client subscribed to IMU updates for {robot_id}")
    
    # Set a flag on the websocket object for easy reference
    websocket.subscribe_imu = True
    
    await websocket.send_json({
        "type": "subscription_status",
        "status": "subscribed",
        "message": f"Subscribed to IMU updates for {robot_id}"
    })

async def handle_unsubscribe_imu(websocket: WebSocket, robot_id: str):
    """Unsubscribe from IMU data updates"""
    if robot_id in imu_subscribers and websocket in imu_subscribers[robot_id]:
        imu_subscribers[robot_id].remove(websocket)
        logging.info(f"Client unsubscribed from IMU updates for {robot_id}")
    
    # Remove the flag from the websocket object
    websocket.subscribe_imu = False
    
    await websocket.send_json({
        "type": "subscription_status",
        "status": "unsubscribed",
        "message": f"Unsubscribed from IMU updates for {robot_id}"
    })

async def handle_get_pid_data(websocket: WebSocket, robot_id: str, db: Session):
    """Fetch the PID configuration for a robot from the database"""
    try:
        # Query PID configurations
        pid_configs = db.query(PIDConfig).filter(
            PIDConfig.robot_id == robot_id
        ).all()
        
        # Format the PID data
        pid_data = {}
        for config in pid_configs:
            motor_id = f"motor{config.motor_id}"
            pid_data[motor_id] = {
                "kp": config.kp,
                "ki": config.ki,
                "kd": config.kd
            }
        
        # If no data found, provide defaults
        if not pid_data:
            pid_data = {
                "motor1": {"kp": 0.5, "ki": 0.1, "kd": 0.05},
                "motor2": {"kp": 0.5, "ki": 0.1, "kd": 0.05},
                "motor3": {"kp": 0.5, "ki": 0.1, "kd": 0.05}
            }
        
        # Send PID data to client
        await websocket.send_json({
            "type": "pid_data",
            "robot_id": robot_id,
            "pid": pid_data,
            "timestamp": time.time()
        })
    except Exception as e:
        logging.error(f"Error retrieving PID data: {str(e)}")
        await websocket.send_json({
            "type": "error",
            "message": f"Error retrieving PID data: {str(e)}"
        })

async def handle_get_encoder_data(websocket: WebSocket, robot_id: str, db: Session):
    """Fetch the latest encoder data for a robot from the database"""
    try:
        # Query latest encoder data from database
        latest_encoder = db.query(EncoderData).filter(
            EncoderData.robot_id == robot_id
        ).order_by(desc(EncoderData.timestamp)).first()
        
        if latest_encoder:
            # Send encoder data to client
            await websocket.send_json({
                "type": "encoder_data",
                "robot_id": robot_id,
                "rpm_1": latest_encoder.rpm_1,
                "rpm_2": latest_encoder.rpm_2,
                "rpm_3": latest_encoder.rpm_3,
                "timestamp": latest_encoder.timestamp.timestamp()
            })
        else:
            await websocket.send_json({
                "type": "error", 
                "message": f"No encoder data found for robot {robot_id}"
            })
    except Exception as e:
        logging.error(f"Error retrieving encoder data: {str(e)}")
        await websocket.send_json({
            "type": "error",
            "message": f"Error retrieving encoder data: {str(e)}"
        })

async def handle_get_encoder_data_since(websocket: WebSocket, robot_id: str, message: dict):
    try:
        # Convert timestamp to datetime
        since_timestamp = message.get("since", 0)
        since_time = datetime.fromtimestamp(float(since_timestamp))
        logging.info(f"Fetching encoder data since {since_time} for {robot_id}")
        
        # Use SQLite connection
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM encoder_data WHERE robot_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 100",
                (robot_id, since_time.isoformat())
            )
            rows = cursor.fetchall()
            
            if rows:
                logging.info(f"Found {len(rows)} encoder records since {since_time}")
                for row in rows:
                    await websocket.send_json({
                        "type": "encoder_data",
                        "robot_id": robot_id,
                        "rpm_1": row["rpm_1"],
                        "rpm_2": row["rpm_2"],
                        "rpm_3": row["rpm_3"],
                        "timestamp": datetime.fromisoformat(row["timestamp"]).timestamp()
                    })
            else:
                logging.info(f"No encoder data found since {since_time}")
                await websocket.send_json({
                    "type": "info",
                    "message": f"No new encoder data since {since_time}"
                })
                
    except Exception as e:
        logging.error(f"Error getting encoder data: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Error retrieving encoder data: {str(e)}"
        })

async def handle_subscribe_encoder(websocket: WebSocket, robot_id: str):
    """Subscribe to encoder data updates for a specific robot"""
    if robot_id not in encoder_subscribers:
        encoder_subscribers[robot_id] = set()
    
    encoder_subscribers[robot_id].add(websocket)
    logging.info(f"Client subscribed to encoder updates for {robot_id}")
    
    await websocket.send_json({
        "type": "subscription_status",
        "status": "subscribed",
        "message": f"Subscribed to encoder updates for {robot_id}"
    })

async def handle_unsubscribe_encoder(websocket: WebSocket, robot_id: str):
    """Unsubscribe from encoder data updates"""
    if robot_id in encoder_subscribers and websocket in encoder_subscribers[robot_id]:
        encoder_subscribers[robot_id].remove(websocket)
        logging.info(f"Client unsubscribed from encoder updates for {robot_id}")
    
    await websocket.send_json({
        "type": "subscription_status",
        "status": "unsubscribed",
        "message": f"Unsubscribed from encoder updates for {robot_id}"
    })

async def handle_get_imu_data_since(websocket: WebSocket, robot_id: str, message: dict):
    try:
        # Convert timestamp to datetime
        since_timestamp = message.get("since", 0)
        since_time = datetime.fromtimestamp(float(since_timestamp))
        logging.info(f"Fetching IMU data since {since_time} for {robot_id}")
        
        # Use SQLite connection
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM imu_data WHERE robot_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 100",
                (robot_id, since_time.isoformat())
            )
            rows = cursor.fetchall()
            
            if rows:
                logging.info(f"Found {len(rows)} IMU records since {since_time}")
                for row in rows:
                    await websocket.send_json({
                        "type": "imu_data",
                        "robot_id": robot_id,
                        "roll": row["roll"],
                        "pitch": row["pitch"],
                        "yaw": row["yaw"],
                        "qw": row["quat_w"], 
                        "qx": row["quat_x"],
                        "qy": row["quat_y"],
                        "qz": row["quat_z"],
                        "timestamp": datetime.fromisoformat(row["timestamp"]).timestamp()
                    })
            else:
                logging.info(f"No IMU data found since {since_time}")
                await websocket.send_json({
                    "type": "info",
                    "message": f"No new IMU data since {since_time}"
                })
                
    except Exception as e:
        logging.error(f"Error getting IMU data: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Error retrieving IMU data: {str(e)}"
        })

async def broadcast_imu_updates():
    """Periodically broadcast IMU updates to subscribers"""
    while True:
        try:
            for robot_id, subscribers in imu_subscribers.items():
                if not subscribers:
                    continue
                
                # Use SQLite to get latest IMU data
                with get_sqlite_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT * FROM imu_data WHERE robot_id = ? ORDER BY timestamp DESC LIMIT 1",
                        (robot_id,)
                    )
                    row = cursor.fetchone()
                    
                    if row:
                        message = {
                            "type": "imu_data",
                            "robot_id": robot_id,
                            "roll": row["roll"],
                            "pitch": row["pitch"],
                            "yaw": row["yaw"],
                            "quat_w": row["quat_w"],
                            "quat_x": row["quat_x"],
                            "quat_y": row["quat_y"],
                            "quat_z": row["quat_z"],
                            "timestamp": datetime.fromisoformat(row["timestamp"]).timestamp()
                        }
                        
                        # Send to all subscribers
                        for websocket in list(subscribers):
                            try:
                                await websocket.send_json(message)
                            except Exception as e:
                                logging.error(f"Error sending IMU update to client: {e}")
                                # Remove problematic subscriber
                                subscribers.remove(websocket)
            
            # Sleep before next broadcast - shorter interval for better responsiveness
            await asyncio.sleep(0.1)
        
        except Exception as e:
            logging.error(f"Error in IMU broadcast: {e}")
            await asyncio.sleep(1.0)  # Sleep longer on error

async def broadcast_encoder_updates():
    """Periodically broadcast encoder updates to subscribers"""
    while True:
        try:
            for robot_id, subscribers in encoder_subscribers.items():
                if not subscribers:
                    continue
                    
                # Use SQLite to get latest encoder data
                with get_sqlite_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT * FROM encoder_data WHERE robot_id = ? ORDER BY timestamp DESC LIMIT 1",
                        (robot_id,)
                    )
                    row = cursor.fetchone()
                    
                    if row:
                        data = {
                            "type": "encoder_data",
                            "robot_id": robot_id,
                            "rpm_1": row["rpm_1"],
                            "rpm_2": row["rpm_2"],
                            "rpm_3": row["rpm_3"],
                            "timestamp": datetime.fromisoformat(row["timestamp"]).timestamp()
                        }
                        
                        # Send to all subscribers
                        for ws in list(subscribers):
                            try:
                                await ws.send_json(data)
                            except Exception as e:
                                logging.error(f"Error sending encoder data to subscriber: {e}")
                                # Remove problematic subscriber
                                subscribers.remove(ws)
            
            # Sleep before next broadcast
            await asyncio.sleep(0.1)
        except Exception as e:
            logging.error(f"Error in encoder broadcast: {e}")
            await asyncio.sleep(1.0)

async def process_websocket_message(websocket: WebSocket, data: str, robot_id: str, db: Session):
    try:
        message = json.loads(data)
        message_type = message.get("type", "")
        
        # Handle different message types
        if message_type == "get_encoder_data":
            await handle_get_encoder_data(websocket, robot_id, db)
        
        elif message_type == "subscribe_encoder":
            await handle_subscribe_encoder(websocket, robot_id)
        
        elif message_type == "unsubscribe_encoder":
            await handle_unsubscribe_encoder(websocket, robot_id)
        
        elif message_type == "get_imu_data":
            await handle_get_imu_data(websocket, robot_id, db)
        
        elif message_type == "subscribe_imu":
            await handle_subscribe_imu(websocket, robot_id)
        
        elif message_type == "unsubscribe_imu":
            await handle_unsubscribe_imu(websocket, robot_id)
        
        elif message_type == "get_pid_data":
            await handle_get_pid_data(websocket, robot_id, db)
        
        elif message_type == "get_encoder_data_since":
            await handle_get_encoder_data_since(websocket, robot_id, message)
        
        elif message_type == "get_imu_data_since":
            await handle_get_imu_data_since(websocket, robot_id, message)
            
        # Add any other message types you need to handle
            
    except Exception as e:
        logging.error(f"Error processing WebSocket message: {str(e)}")
        await websocket.send_json({
            "type": "error",
            "message": f"Error processing message: {str(e)}"
        })

@app.get("/api/encoder-data/{robot_id}")
async def get_encoder_data(robot_id: str, limit: int = 100, downsample: int = 1):
    """Get encoder data with optional downsampling"""
    try:
        with get_sqlite_connection() as conn:
            cursor = conn.cursor()
            
            if downsample <= 1:
                # No downsampling
                cursor.execute(
                    "SELECT * FROM encoder_data WHERE robot_id = ? ORDER BY timestamp DESC LIMIT ?",
                    (robot_id, limit)
                )
            else:
                # With downsampling - use modulo on rowid
                cursor.execute("""
                    SELECT * FROM encoder_data 
                    WHERE robot_id = ? AND (id % ?) = 0
                    ORDER BY timestamp DESC LIMIT ?
                """, (robot_id, downsample, limit))
                
            rows = cursor.fetchall()
            
            result = []
            for row in rows:
                result.append({
                    "id": row['id'],
                    "robot_id": row['robot_id'],
                    "rpm1": row['rpm_1'],
                    "rpm2": row['rpm_2'],
                    "rpm3": row['rpm_3'],
                    "timestamp": row['timestamp']
                })
            
            return {"data": result, "count": len(result)}
    except Exception as e:
        logger.error(f"Error getting encoder data: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/debug/database-content")
async def get_database_content(table: str = "encoder_data", limit: int = 10):
    """Debug endpoint to directly view raw database content"""
    try:
        with sqlite3.connect(SQLITE_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Verify table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [row['name'] for row in cursor.fetchall()]
            
            if table not in tables:
                return {
                    "status": "error",
                    "message": f"Table '{table}' not found. Available tables: {tables}"
                }
            
            # Get table schema
            cursor.execute(f"PRAGMA table_info({table})")
            schema = [dict(row) for row in cursor.fetchall()]
            
            # Get content
            cursor.execute(f"SELECT * FROM {table} ORDER BY id DESC LIMIT {limit}")
            rows = cursor.fetchall()
            content = [dict(row) for row in rows]
            
            return {
                "status": "success",
                "table": table,
                "schema": schema,
                "row_count": len(content),
                "sample_data": content
            }
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_imu_data_since_timestamp(robot_id: str, since_timestamp: float):
    """Get IMU data since timestamp - compatible with both SQLite and SQLAlchemy"""
    try:
        # First try with direct SQLite query
        with get_sqlite_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            since_time_iso = datetime.fromtimestamp(since_timestamp).isoformat()
            
            # Note: Using string comparison for timestamp as it's stored as ISO string
            cursor.execute(
                "SELECT * FROM imu_data WHERE robot_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 50",
                (robot_id, since_time_iso)
            )
            results = cursor.fetchall()
            
            if results:
                print(f"Found {len(results)} IMU records via SQLite direct query")
                return [dict(row) for row in results]
            else:
                print("No IMU data found via SQLite direct query")
                return []
    except Exception as e:
        print(f"SQLite query error: {e}")
        # Fall back to SQLAlchemy
        try:
            db = SessionLocal()
            try:
                since_time = datetime.fromtimestamp(since_timestamp)
                results = db.query(IMUData).filter(
                    IMUData.robot_id == robot_id
                ).order_by(IMUData.timestamp.desc()).limit(50).all()
                
                if results:
                    print(f"Found {len(results)} IMU records via SQLAlchemy fallback")
                    return results
                return []
            finally:
                db.close()
        except Exception as e2:
            print(f"SQLAlchemy fallback error: {e2}")
            return []

# Thêm hàm xử lý tin nhắn từ DirectBridge
@app.websocket("/ws/{robot_id}")
async def robot_endpoint(websocket: WebSocket, robot_id: str):
    robot_id = ConnectionManager.normalize_robot_id(robot_id)
    await handle_robot_connection(websocket, robot_id)

# Đảm bảo khi có tin nhắn từ robot được chuyển tiếp từ DirectBridge,
# nó sẽ được gửi đến tất cả các clients đang subscribe
async def handle_robot_message(robot_id: str, message: dict):
    # Forward to all clients subscribed to this robot
    if robot_id in imu_subscribers and message.get('type') in ['bno055', 'imu', 'imu_data']:
        for ws in imu_subscribers[robot_id]:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.error(f"Error forwarding IMU data: {e}")
    
    if robot_id in encoder_subscribers and message.get('type') in ['encoder', 'encoder_data']:
        for ws in encoder_subscribers[robot_id]:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.error(f"Error forwarding encoder data: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)