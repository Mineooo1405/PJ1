import sys
import os
import asyncio
import websockets
import json
import logging
from connection_manager import ConnectionManager
import aiohttp
import time
from datetime import datetime
from high_performance_db import db_writer
from aiohttp import web

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("direct_bridge")

# Đọc cấu hình port từ biến môi trường hoặc sử dụng mặc định
TCP_PORT = int(os.environ.get("TCP_PORT", "9000"))
WS_PORT = int(os.environ.get("WS_BRIDGE_PORT", "9003"))

class APIBatchSender:
    def __init__(self, batch_size=10, max_wait_time=0.5):
        self.batch_size = batch_size
        self.max_wait_time = max_wait_time
        self.data_batch = []
        self.last_send_time = time.time()
        self.lock = asyncio.Lock()
        self._running = False
        self.sender_task = None
        
    async def start(self):
        """Start the batch sender"""
        self._running = True
        self.sender_task = asyncio.create_task(self._periodic_send())
        logger.info(f"API Batch sender started")
    
    async def stop(self):
        """Stop the batch sender and send any remaining data"""
        self._running = False
        if self.sender_task:
            self.sender_task.cancel()
            try:
                await self.sender_task
            except asyncio.CancelledError:
                pass
        
        # Send any remaining data
        await self._send_batch()
        logger.info("API Batch sender stopped")
    
    async def add_data(self, data):
        """Add data to the batch"""
        async with self.lock:
            self.data_batch.append(data)
            
        # Auto-send if batch is full
        if len(self.data_batch) >= self.batch_size:
            await self._send_batch()
    
    async def _periodic_send(self):
        """Periodically send batched data"""
        try:
            while self._running:
                current_time = time.time()
                # Send if enough time has passed since last send
                if current_time - self.last_send_time >= self.max_wait_time:
                    await self._send_batch()
                
                # Wait a short time before checking again
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            logger.info("API Batch sender task cancelled")
            raise
        except Exception as e:
            logger.error(f"Error in periodic send: {e}")
    
    async def _send_batch(self):
        """Send the current batch of data to the API endpoint"""
        data_to_send = []
        
        async with self.lock:
            if not self.data_batch:
                return
            
            data_to_send = self.data_batch.copy()
            self.data_batch.clear()
            self.last_send_time = time.time()
        
        if data_to_send:
            try:
                for data in data_to_send:
                    # Send each data item to the API
                    async with aiohttp.ClientSession() as session:
                        async with session.post(
                            'http://localhost:8000/api/robot-data',
                            json=data,
                            headers={'Content-Type': 'application/json'}
                        ) as response:
                            if response.status != 200:
                                response_text = await response.text()
                                logger.warning(f"API returned non-200 status: {response.status}, {response_text}")
                
                logger.debug(f"Sent batch of {len(data_to_send)} items to API")
            except Exception as e:
                logger.error(f"Error sending batch to API: {e}")

class DirectBridge:
    def __init__(self, tcp_port=TCP_PORT, ws_port=WS_PORT):
        self.tcp_port = tcp_port
        self.ws_port = ws_port
        self.tcp_server = None
        self.ws_server = None
        self.running = False
    
    async def start(self):
        """Start both TCP and WebSocket servers"""
        self.running = True
        
        # Start TCP server - Sửa 'localhost' thành '0.0.0.0'
        self.tcp_server = await asyncio.start_server(
            self.handle_tcp_client, '0.0.0.0', self.tcp_port
        )
        logger.info(f"TCP server started on 0.0.0.0:{self.tcp_port}")
        
        # Start WebSocket server - Sửa cả WebSocket nữa
        self.ws_server = await websockets.serve(
            self.handle_ws_client, '0.0.0.0', self.ws_port
        )
        logger.info(f"WebSocket server started on 0.0.0.0:{self.ws_port}")
    
    async def handle_tcp_client(self, reader, writer):
        """Handle TCP client connection (robot)"""
        addr = writer.get_extra_info('peername')
        client_id = f"{addr[0]}:{addr[1]}"
        robot_id = None
        logger.info(f"New TCP connection from {client_id}")
        
        try:
            # Wait for registration message with proper format
            while robot_id is None:
                raw_data = await reader.readline()
                if not raw_data:
                    logger.warning(f"TCP client {client_id} disconnected before registration")
                    return  # Exit the function to close connection
                
                # Add detailed logging of raw data received
                logger.info(f"TCP registration data received from {client_id}:")
                logger.info(f"  Raw bytes: {raw_data}")
                logger.info(f"  Decoded: {raw_data.decode().strip()}")
                
                try:
                    message = json.loads(raw_data.decode().strip())
                    logger.info(f"  Parsed JSON: {json.dumps(message, indent=2)}")
                    
                    # Check for proper registration message
                    if message.get("type") != "registration":
                        logger.warning(f"First message from {client_id} missing 'type':'registration': {message}")
                        writer.close()
                        return  # Close connection and exit
                    
                    robot_id = message.get("robot_id")
                    
                    # Normalize the robot_id and register if valid
                    if robot_id:
                        robot_id = ConnectionManager.normalize_robot_id(robot_id)
                        # Register the TCP client
                        ConnectionManager.set_tcp_client(robot_id, (reader, writer))
                        logger.info(f"TCP client {client_id} registered as robot {robot_id}")
                    else:
                        logger.warning(f"Registration without robot_id from {client_id}: {message}")
                        writer.close()
                        return  # Close connection and exit
                
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON during registration from {client_id}: {raw_data.decode()}")
                    writer.close()  # Disconnect on invalid JSON
                    return  # Exit the function to close connection
            
            # Main message loop - now robot is registered
            while robot_id and self.running:
                raw_data = await reader.readline()
                if not raw_data:
                    logger.warning(f"TCP connection closed for {robot_id}")
                    break

                # Log raw data received
                logger.info(f"RAW DATA RECEIVED: {raw_data}")

                try:
                    message = json.loads(raw_data.decode().strip())
                    logger.info(f"Parsed JSON: {json.dumps(message, indent=2)}")

                    # Verify message has robot_id
                    if "robot_id" not in message:
                        logger.warning(f"Message from {robot_id} missing robot_id field: {message}")
                        message["robot_id"] = robot_id

                    # Forward message to all connected WebSockets for this robot
                    ws_count = 0
                    for ws in ConnectionManager.get_websockets(robot_id):
                        await ws.send(json.dumps(message))
                        ws_count += 1

                    # Log forwarding information
                    if ws_count > 0:
                        logger.info(f"Forwarded message to {ws_count} WebSocket clients")
                    else:
                        logger.warning(f"No WebSocket clients to forward message to")
                    
                    # Handle data based on type
                    data_type = message.get("type")
                    if data_type == "encoder":
                        db_writer.enqueue_data("encoder", message)
                    elif data_type == "imu":
                        db_writer.enqueue_data("imu", message)
                    elif data_type in ["heartbeat", "status"]:
                        # Heartbeats và status vẫn có thể gửi qua API
                        async with aiohttp.ClientSession() as session:
                            try:
                                async with session.post(
                                    'http://localhost:8000/api/robot-data',
                                    json=message,
                                    headers={'Content-Type': 'application/json'}
                                ) as response:
                                    if response.status != 200:
                                        response_text = await response.text()
                                        logger.warning(f"API returned non-200 status: {response.status}, {response_text}")
                            except Exception as e:
                                logger.error(f"Error sending data to API: {e}")

                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON from {robot_id}: {raw_data.decode()}")
                    break  # Disconnect client on invalid JSON
        
        except Exception as e:
            logger.error(f"Error in TCP connection {client_id}: {str(e)}")
        
        finally:
            # Clean up
            if robot_id:
                ConnectionManager.remove_tcp_client(robot_id)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception as e:
                logger.error(f"Error closing writer: {str(e)}")
            logger.info(f"TCP connection closed for {client_id}")
    
    async def handle_ws_client(self, websocket, path):
        try:
            # Extract robot_id from path
            path_parts = path.strip('/').split('/')
            if len(path_parts) >= 2 and path_parts[0] == 'ws':
                robot_id = path_parts[1]
                logger.info(f"WebSocket path indicates robot_id: {robot_id}")
            else:
                logger.warning(f"Invalid WebSocket path: {path}")
                return
            
            # Add this WebSocket to our connection manager
            ConnectionManager.add_websocket(robot_id, websocket)
            
            # Keep connection alive until closed
            try:
                async for message in websocket:
                    try:
                        # Parse the incoming message
                        data = json.loads(message)
                        robot_id = data.get("robot_id", robot_id) # Use the one from the message if available
                        
                        # Handle special message types from frontend
                        if data.get("type") == "pid_config":
                            # Get the TCP client for this robot
                            tcp_client = ConnectionManager.get_tcp_client(robot_id)
                            
                            # Forward PID config to robot
                            if tcp_client:
                                reader, writer = tcp_client
                                try:
                                    # Log detailed PID values
                                    logger.info(f"Received PID config: motor_id={data.get('motor_id')}, kp={data.get('kp')}, ki={data.get('ki')}, kd={data.get('kd')}")
                                    
                                    # Send data to TCP client
                                    writer.write((json.dumps(data) + "\n").encode())
                                    await writer.drain()
                                    logger.info(f"Forwarded PID config to {robot_id} TCP")
                                    
                                    # Send preliminary success response back to WebSocket client
                                    # This guarantees client gets something even if robot doesn't respond
                                    await websocket.send(json.dumps({
                                        "type": "pid_response",
                                        "status": "processing",
                                        "robot_id": robot_id,
                                        "message": "PID configuration sent to robot, awaiting confirmation",
                                        "timestamp": time.time()
                                    }))
                                except Exception as e:
                                    logger.error(f"Error sending PID config to TCP {robot_id}: {str(e)}")
                                    
                                    # Even in case of error, don't close the WebSocket connection
                                    # Just send error response back to WebSocket client
                                    await websocket.send(json.dumps({
                                        "type": "pid_response",
                                        "status": "error",
                                        "robot_id": robot_id,
                                        "message": f"Failed to send PID config: {str(e)}",
                                        "timestamp": time.time()
                                    }))
                            else:
                                logger.warning(f"No TCP client for robot {robot_id}")
                                await websocket.send(json.dumps({
                                    "type": "pid_response",
                                    "status": "error",
                                    "robot_id": robot_id,
                                    "message": f"No TCP client connected for robot {robot_id}",
                                    "timestamp": time.time()
                                }))
                        elif data.get("type") in ["firmware_update_start", "firmware_chunk", "firmware_update_complete", "check_firmware_version"]:
                            # Same logic for firmware updates - handle similarly to PID config
                            tcp_client = ConnectionManager.get_tcp_client(robot_id)
                            if tcp_client:
                                reader, writer = tcp_client
                                try:
                                    writer.write((json.dumps(data) + "\n").encode())
                                    await writer.drain()
                                    logger.info(f"Forwarded {data.get('type')} to {robot_id} TCP")
                                    
                                    # Send proper responses based on message type
                                    if data.get("type") == "firmware_chunk":
                                        chunk_index = data.get("chunk_index", 0)
                                        total_chunks = data.get("total_chunks", 1)
                                        progress = int((chunk_index + 1) / total_chunks * 100)
                                        
                                        await websocket.send(json.dumps({
                                            "type": "firmware_progress",
                                            "progress": progress,
                                            "robot_id": robot_id,
                                            "timestamp": time.time()
                                        }))
                                    elif data.get("type") == "firmware_update_complete":
                                        await websocket.send(json.dumps({
                                            "type": "firmware_response",
                                            "status": "success",
                                            "robot_id": robot_id,
                                            "message": "Firmware update completed successfully",
                                            "timestamp": time.time()
                                        }))
                                    elif data.get("type") == "check_firmware_version":
                                        # Send dummy response if robot doesn't respond
                                        await asyncio.sleep(1)
                                        await websocket.send(json.dumps({
                                            "type": "firmware_version",
                                            "version": "1.0.0",
                                            "build_date": time.strftime("%Y-%m-%d"),
                                            "robot_id": robot_id,
                                            "timestamp": time.time()
                                        }))
                                except Exception as e:
                                    logger.error(f"Error forwarding {data.get('type')} to {robot_id} TCP: {str(e)}")
                                    await websocket.send(json.dumps({
                                        "type": "firmware_response",
                                        "status": "error",
                                        "robot_id": robot_id,
                                        "message": f"Failed to send firmware command: {str(e)}",
                                        "timestamp": time.time()
                                    }))
                            else:
                                logger.warning(f"No TCP client for robot {robot_id} when handling {data.get('type')}")
                                await websocket.send(json.dumps({
                                    "type": "firmware_response",
                                    "status": "error", 
                                    "robot_id": robot_id,
                                    "message": f"No TCP client connected for robot {robot_id}",
                                    "timestamp": time.time()
                                }))
                        else:
                            # For other message types, forward to the robot's TCP connection
                            tcp_client = ConnectionManager.get_tcp_client(robot_id)
                            if tcp_client:
                                reader, writer = tcp_client
                                try:
                                    writer.write((json.dumps(data) + "\n").encode())
                                    await writer.drain()
                                    logger.info(f"Forwarded {data.get('type', 'unknown')} to {robot_id} TCP")
                                except Exception as e:
                                    logger.error(f"Error forwarding to TCP {robot_id}: {str(e)}")
                                    await websocket.send(json.dumps({
                                        "type": "error",
                                        "message": f"Failed to forward to robot: {str(e)}",
                                        "robot_id": robot_id,
                                        "timestamp": time.time()
                                    }))
                    
                    except json.JSONDecodeError:
                        logger.error(f"Invalid JSON received from WebSocket: {message}")
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": "Invalid JSON format",
                            "timestamp": time.time()
                        }))
                    except Exception as e:
                        logger.error(f"Error processing WebSocket message: {str(e)}")
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": f"Error processing message: {str(e)}",
                            "timestamp": time.time()
                        }))
                        # Don't close the connection here!
            
            except websockets.exceptions.ConnectionClosedOK:
                logger.info(f"WebSocket connection closed normally")
            except websockets.exceptions.ConnectionClosedError as e:
                logger.error(f"WebSocket connection closed with error: {e}")
        
        except Exception as e:
            logger.error(f"Error in WebSocket connection {websocket.remote_address}: {e}")
        finally:
            # Always clean up
            ConnectionManager.remove_websocket(robot_id, websocket)
            logger.info(f"WebSocket connection closed for {websocket.remote_address}")

# Khởi tạo batch sender
api_batch_sender = APIBatchSender(batch_size=20, max_wait_time=0.2)

# Thêm endpoint để hiển thị thống kê từ database writer
routes = web.RouteTableDef()

@routes.get('/db-stats')
async def get_db_stats(request):
    """Get database writer statistics"""
    stats = db_writer.get_stats()
    return web.json_response(stats)

# Main function
async def main():
    bridge = DirectBridge()
    await bridge.start()
    
    # Start the high performance database writer
    db_writer.start()
    
    # Start the API batch sender
    await api_batch_sender.start()
    
    try:
        # Keep the server running indefinitely
        while True:
            await asyncio.sleep(3600)  # Sleep for an hour
    finally:
        # Stop the database writer
        db_writer.stop()
        # Stop the API batch sender
        await api_batch_sender.stop()

if __name__ == "__main__":
    print("Starting Direct Bridge - combines TCP server and WebSocket server in one process")
    print("Use localhost:9000 for robots (TCP)")
    print("Use ws://localhost:9003 for frontend (WebSocket)")
    print("-" * 50)
    app = web.Application()
    app.add_routes(routes)
    asyncio.run(main())