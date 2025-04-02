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
        """Handle WebSocket client connection (frontend)"""
        client_id = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        robot_id = None
        logger.info(f"New WebSocket connection from {client_id}, path: {path}")
        
        try:
            # Extract robot_id from path if available - update path handling
            if path and path.startswith('/'):
                parts = path[1:].split('/')
                if len(parts) >= 2 and parts[0] == "ws":
                    # For paths like /ws/robot1, use the second part
                    robot_id = ConnectionManager.normalize_robot_id(parts[1])
                    logger.info(f"WebSocket path indicates robot_id: {robot_id}")
                elif len(parts) >= 1:
                    # Handle legacy paths or other formats
                    robot_id = ConnectionManager.normalize_robot_id(parts[0])
                    logger.info(f"WebSocket path indicates robot_id (legacy): {robot_id}")
            
            # Wait for identification message if robot_id not in path
            if not robot_id:
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        robot_id = data.get("robot_id")
                        if robot_id:
                            robot_id = ConnectionManager.normalize_robot_id(robot_id)
                            logger.info(f"WebSocket client {client_id} identified as {robot_id}")
                            break
                        else:
                            await websocket.send(json.dumps({
                                "type": "error",
                                "message": "Missing robot_id in identification message"
                            }))
                    except json.JSONDecodeError:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": "Invalid JSON message"
                        }))
            
            # Register WebSocket with connection manager
            if robot_id:
                ConnectionManager.add_websocket(robot_id, websocket)
                
                # Main message loop
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        logger.debug(f"WebSocket received from {client_id}: {data}")
                        
                        # Get TCP client for this robot
                        tcp_client = ConnectionManager.get_tcp_client(robot_id)
                        if tcp_client:
                            # Forward message to TCP client (robot)
                            reader, writer = tcp_client
                            try:
                                writer.write((json.dumps(data) + "\n").encode())
                                await writer.drain()
                                logger.debug(f"Forwarded to {robot_id} TCP: {data}")
                            except Exception as e:
                                logger.error(f"Error sending to TCP {robot_id}: {str(e)}")
                                # Remove dead TCP client
                                ConnectionManager.remove_tcp_client(robot_id)
                        else:
                            # No TCP client for this robot
                            await websocket.send(json.dumps({
                                "type": "error",
                                "message": f"No TCP client connected for {robot_id}"
                            }))
                    
                    except json.JSONDecodeError:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": "Invalid JSON message"
                        }))
        
        except Exception as e:
            logger.error(f"Error in WebSocket connection {client_id}: {str(e)}")
        
        finally:
            # Clean up
            if robot_id:
                ConnectionManager.remove_websocket(robot_id, websocket)
            logger.info(f"WebSocket connection closed for {client_id}")

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