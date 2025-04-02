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
# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("direct_bridge")

# Đọc cấu hình port từ biến môi trường hoặc sử dụng mặc định
TCP_PORT = int(os.environ.get("TCP_PORT", "9000"))
WS_PORT = int(os.environ.get("WS_BRIDGE_PORT", "9003"))

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
                    
                    # Forward to backend API
                    await self.forward_to_backend(message, robot_id)

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
                                    
                                    # Send success response back to WebSocket client
                                    await websocket.send(json.dumps({
                                        "type": "pid_response",
                                        "status": "success",
                                        "robot_id": robot_id,
                                        "message": "PID configuration sent to robot",
                                        "timestamp": time.time()
                                    }))
                                except Exception as e:
                                    logger.error(f"Error sending PID config to TCP {robot_id}: {str(e)}")
                                    # Send error response back to WebSocket client
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

    async def forward_to_backend(self, message, robot_id):
        """Forward robot data from TCP server to FastAPI backend"""
        try:
            # Get backend URL from environment variable or use default
            backend_url = os.environ.get("BACKEND_URL", "http://localhost:8000")
            endpoint = f"{backend_url}/api/robot-data"
            
            # Add metadata if not present
            if "timestamp" not in message:
                message["timestamp"] = time.time()
                
            if "robot_id" not in message:
                message["robot_id"] = robot_id
                
            logger.info(f"Forwarding {message.get('type', 'unknown')} data from robot {robot_id} to backend")
            
            # Send HTTP POST request to backend
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    endpoint,
                    json=message,
                    headers={"Content-Type": "application/json"}
                ) as response:
                    if response.status == 200:
                        response_data = await response.json()
                        logger.debug(f"Backend response for {robot_id}: {response_data}")
                        return True
                    else:
                        response_text = await response.text()
                        logger.warning(f"Backend responded with status {response.status}: {response_text}")
                        return False
                    
        except Exception as e:
            logger.error(f"Error forwarding to backend: {str(e)}")
            return False

# Main function
async def main():
    bridge = DirectBridge()
    await bridge.start()
    # Keep the server running indefinitely
    while True:
        await asyncio.sleep(3600)  # Sleep for an hour

if __name__ == "__main__":
    print("Starting Direct Bridge - combines TCP server and WebSocket server in one process")
    print("Use localhost:9000 for robots (TCP)")
    print("Use ws://localhost:9003 for frontend (WebSocket)")
    print("-" * 50)
    asyncio.run(main())