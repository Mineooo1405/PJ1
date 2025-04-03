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
import argparse

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
        client_ip, client_port = addr  # Tách IP và port
        client_addr = (client_ip, client_port)  # Lưu dưới dạng tuple
        
        robot_id = None
        logger.info(f"🔌 Kết nối TCP mới từ {client_ip}:{client_port}")
        
        try:
            # Wait for registration message with proper format
            while robot_id is None:
                raw_data = await reader.readline()
                if not raw_data:
                    logger.warning(f"❗ TCP client {client_ip}:{client_port} ngắt kết nối trước khi đăng ký")
                    return  # Exit the function to close connection
                
                try:
                    message = json.loads(raw_data.decode().strip())
                    
                    # Check for proper registration message
                    if message.get("type") != "registration":
                        logger.warning(f"❌ Gói tin đầu tiên từ {client_ip}:{client_port} không phải 'registration': {message}")
                        writer.write(json.dumps({
                            "type": "error",
                            "status": "failed",
                            "message": "First message must be registration"
                        }).encode() + b'\n')
                        await writer.drain()
                        writer.close()
                        return
                    
                    robot_id = message.get("robot_id")
                    
                    if robot_id:
                        robot_id = ConnectionManager.normalize_robot_id(robot_id)
                        # Đăng ký với tuple (ip, port) thay vì chuỗi "ip:port"
                        ConnectionManager.set_tcp_client(robot_id, (reader, writer), client_addr)
                        logger.info(f"✅ Robot {robot_id} đăng ký thành công từ {client_ip}:{client_port}")
                        
                        # Gửi xác nhận đăng ký cho robot
                        confirmation = {
                            "type": "registration_response",
                            "status": "success", 
                            "robot_id": robot_id,
                            "server_time": time.time(),
                            "client_ip": client_ip,
                            "client_port": client_port,
                            "message": f"Robot {robot_id} đã được đăng ký thành công từ {client_ip}:{client_port}"
                        }
                        writer.write((json.dumps(confirmation) + "\n").encode())
                        await writer.drain()
                    else:
                        logger.warning(f"❌ Đăng ký thiếu robot_id từ {client_ip}:{client_port}: {message}")
                        writer.write(json.dumps({
                            "type": "registration_response",
                            "status": "failed",
                            "message": "Missing robot_id in registration"
                        }).encode() + b'\n')
                        await writer.drain()
                        writer.close()
                        return
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON during registration from {client_ip}:{client_port}: {raw_data.decode()}")
                    writer.close()  # Disconnect on invalid JSON
                    return  # Exit the function to close connection
            
            # Main message loop - now robot is registered
            while robot_id and self.running:
                try:
                    raw_data = await reader.readline()
                    if not raw_data:  # Connection closed
                        logger.info(f"❌ Robot {robot_id} tại {client_ip}:{client_port} đã ngắt kết nối")
                        ConnectionManager.remove_tcp_client(robot_id)
                        break

                    # Log raw data received
                    logger.info(f"RAW DATA RECEIVED: {raw_data}")

                    try:
                        message = json.loads(raw_data.decode().strip())
                        logger.info(f"Original message: {json.dumps(message, indent=2)}")
                        
                        # Chuyển đổi message sang định dạng chuẩn
                        transformed_message = transform_robot_message(message)
                        logger.info(f"Transformed message: {json.dumps(transformed_message, indent=2)}")
                        
                        # Verify message has robot_id
                        if "robot_id" not in transformed_message:
                            logger.warning(f"Message from {robot_id} missing robot_id field: {transformed_message}")
                            transformed_message["robot_id"] = robot_id
                        
                        # Forward message to all connected WebSockets for this robot
                        ws_count = 0
                        for ws in ConnectionManager.get_websockets(robot_id):
                            await ws.send(json.dumps(transformed_message))
                            ws_count += 1
                        
                        # Log forwarding information
                        if ws_count > 0:
                            logger.info(f"Forwarded message to {ws_count} WebSocket clients")
                        else:
                            logger.warning(f"No WebSocket clients to forward message to")
                        
                        # Handle data based on type
                        data_type = transformed_message.get("type")
                        if data_type == "encoder":
                            db_writer.enqueue_data("encoder", transformed_message)
                        elif data_type == "imu":
                            db_writer.enqueue_data("imu", transformed_message)
                        elif data_type in ["heartbeat", "status"]:
                            # Heartbeats và status vẫn có thể gửi qua API
                            async with aiohttp.ClientSession() as session:
                                try:
                                    async with session.post(
                                        'http://localhost:8000/api/robot-data',
                                        json=transformed_message,
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
                    logger.error(f"❗ Lỗi xử lý dữ liệu từ robot {robot_id} tại {client_ip}:{client_port}: {e}")
                    ConnectionManager.remove_tcp_client(robot_id)
                    break
        
        except Exception as e:
            logger.error(f"Error in TCP connection {client_ip}:{client_port}: {str(e)}")
        
        finally:
            # Clean up
            if robot_id:
                ConnectionManager.remove_tcp_client(robot_id)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception as e:
                logger.error(f"Error closing writer: {str(e)}")
            logger.info(f"TCP connection closed for {client_ip}:{client_port}")
    
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
                        
                        # Thêm xử lý firmware theo IP nếu có target_ip được chỉ định
                        if data.get("type") in ["firmware_update_start", "firmware_chunk", "firmware_update_complete", "check_firmware_version"]:
                            # Kiểm tra xem có target_ip không
                            target_ip = data.get("target_ip")
                            target_port = data.get("target_port")
                            
                            if target_ip:
                                # Gửi firmware theo IP
                                result = await self.send_firmware_by_ip(target_ip, data, target_port)
                                
                                # Phản hồi cho client
                                if result["status"] == "success":
                                    # Sử dụng robot_id đã xác định được từ IP
                                    identified_robot_id = result.get("robot_id", robot_id)
                                    
                                    # Chuẩn bị phản hồi tương tự như trước
                                    if data.get("type") == "firmware_chunk":
                                        chunk_index = data.get("chunk_index", 0)
                                        total_chunks = data.get("total_chunks", 1)
                                        progress = int((chunk_index + 1) / total_chunks * 100)
                                        
                                        await websocket.send(json.dumps({
                                            "type": "firmware_progress",
                                            "progress": progress,
                                            "robot_id": identified_robot_id,
                                            "target_ip": target_ip,
                                            "target_port": target_port,
                                            "timestamp": time.time()
                                        }))
                                    else:
                                        await websocket.send(json.dumps({
                                            "type": "firmware_response",
                                            "status": "processing", 
                                            "robot_id": identified_robot_id,
                                            "target_ip": target_ip,
                                            "target_port": target_port,
                                            "message": f"Firmware command sent to robot at {target_ip}" + (f":{target_port}" if target_port else ""),
                                            "timestamp": time.time()
                                        }))
                                else:
                                    # Gửi thông báo lỗi
                                    await websocket.send(json.dumps({
                                        "type": "firmware_response",
                                        "status": "error",
                                        "target_ip": target_ip,
                                        "target_port": target_port,
                                        "message": result["message"],
                                        "timestamp": time.time()
                                    }))
                                
                                # Bỏ qua phần xử lý firmware theo robot_id
                                continue
                        
                        # Xử lý các loại tin nhắn khác như trước
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

    async def send_firmware_by_ip(self, ip, firmware_data, port=None):
        """
        Gửi firmware đến robot bằng địa chỉ IP
        
        Args:
            ip (str): Địa chỉ IP của robot
            firmware_data (dict): Dữ liệu firmware cần gửi
            port (int, optional): Port nếu chỉ định
            
        Returns:
            dict: Kết quả của thao tác gửi firmware
        """
        logger.info(f"🔍 Tìm kiếm kết nối TCP cho IP {ip}" + (f":{port}" if port else ""))
        
        tcp_client = ConnectionManager.get_tcp_client_by_addr(ip, port)
        if not tcp_client:
            error_msg = f"❌ Không tìm thấy robot với IP {ip}" + (f":{port}" if port else "")
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}
        
        try:
            reader, writer = tcp_client
            
            # Lấy thông tin robot_id
            robot_id = ConnectionManager.get_robot_id_by_ip(ip, port)
            
            # Chuẩn bị dữ liệu firmware
            firmware_data["sent_by_ip"] = True
            firmware_data["target_ip"] = ip
            if port:
                firmware_data["target_port"] = port
            
            # Gửi firmware qua TCP
            writer.write((json.dumps(firmware_data) + "\n").encode())
            await writer.drain()
            
            logger.info(f"✅ Đã gửi {firmware_data.get('type', 'firmware')} đến robot {robot_id} tại {ip}" + (f":{port}" if port else ""))
            
            # Phản hồi thành công
            return {
                "status": "success", 
                "message": f"Đã gửi firmware đến robot tại {ip}" + (f":{port}" if port else ""),
                "robot_id": robot_id,
                "ip": ip,
                "port": port
            }
        except Exception as e:
            error_msg = f"❌ Lỗi gửi firmware đến robot tại {ip}" + (f":{port}" if port else "") + f": {e}"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}

    async def send_to_robot(self, robot_id, data):
        tcp_client = ConnectionManager.get_tcp_client(robot_id)
        if not tcp_client:
            logger.error(f"❌ Không thể gửi dữ liệu: Robot {robot_id} không kết nối")
            return False

        try:
            _, writer = tcp_client
            # Log trước khi gửi
            ip = ConnectionManager.get_ip_by_robot_id(robot_id)
            logger.info(f"📤 Gửi dữ liệu đến robot {robot_id} tại {ip or 'unknown IP'}")
            logger.debug(f"  Dữ liệu: {json.dumps(data)}")
            
            writer.write((json.dumps(data) + "\n").encode())
            await writer.drain()
            return True
        except Exception as e:
            logger.error(f"❌ Lỗi khi gửi dữ liệu đến robot {robot_id}: {e}")
            return False

def transform_robot_message(message):
    """
    Chuyển đổi định dạng JSON từ robot sang định dạng chuẩn cho hệ thống
    
    Args:
        message (dict): Tin nhắn từ robot theo định dạng mới
    
    Returns:
        dict: Tin nhắn đã được chuyển đổi sang định dạng chuẩn
    """
    try:
        # Lấy các thông tin chung
        robot_id = str(message.get("id", "unknown"))
        msg_type = message.get("type")
        current_time = time.time()
        
        # Trường hợp dữ liệu encoder
        if msg_type == "encoder":
            # Lấy giá trị rpm từ mảng data
            rpm_array = message.get("data", [0, 0, 0])
            if len(rpm_array) < 3:
                rpm_array = rpm_array + [0] * (3 - len(rpm_array))
                
            transformed_message = {
                "type": "encoder",
                "robot_id": robot_id,
                "rpm1": rpm_array[0],
                "rpm2": rpm_array[1],
                "rpm3": rpm_array[2],
                "timestamp": current_time
            }
            return transformed_message
            
        # Trường hợp dữ liệu IMU (bno055)
        elif msg_type == "bno055":
            data = message.get("data", {})
            
            # Lấy euler angles từ data
            euler = data.get("euler", [0, 0, 0])
            if len(euler) < 3:
                euler = euler + [0] * (3 - len(euler))
            
            # Lấy quaternion từ data
            quaternion = data.get("quaternion", [1, 0, 0, 0])
            if len(quaternion) < 4:
                quaternion = quaternion + [0] * (4 - len(quaternion))
            
            # Lấy timestamp từ data hoặc sử dụng thời gian hiện tại
            timestamp = data.get("time", current_time)
            
            transformed_message = {
                "type": "imu",  # Đổi từ bno055 thành imu
                "robot_id": robot_id,
                "roll": euler[0],
                "pitch": euler[1],
                "yaw": euler[2],
                "qw": quaternion[0],
                "qx": quaternion[1],
                "qy": quaternion[2],
                "qz": quaternion[3],
                "timestamp": timestamp
            }
            return transformed_message
            
        # Các loại tin nhắn khác giữ nguyên
        else:
            return message
            
    except Exception as e:
        logger.error(f"Error transforming message: {e}")
        logger.error(f"Original message: {message}")
        return message  # Trả về message gốc nếu có lỗi

# Khởi tạo batch sender
api_batch_sender = APIBatchSender(batch_size=20, max_wait_time=0.2)

# Thêm endpoint để hiển thị thống kê từ database writer
routes = web.RouteTableDef()

@routes.get('/')
async def status_page(request):
    """Simple status page with active connections"""
    try:
        connections = []
        
        for robot_id, addr in getattr(ConnectionManager, '_robot_to_addr', {}).items():
            if addr and len(addr) == 2:
                ip, port = addr
                connections.append({
                    "robot_id": robot_id,
                    "ip": ip,
                    "port": port,
                    "active": robot_id in getattr(ConnectionManager, '_tcp_clients', {})
                })
        
        # HTML template
        html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>DirectBridge Status</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ddd; padding: 8px; }
                th { background-color: #4CAF50; color: white; }
                .active { color: green; font-weight: bold; }
                .inactive { color: red; }
            </style>
        </head>
        <body>
            <h1>DirectBridge Status</h1>
            <p>Server time: {server_time}</p>
            <p>Connections: {connection_count}</p>
            
            <table>
                <tr>
                    <th>Robot ID</th>
                    <th>IP Address</th>
                    <th>Port</th>
                    <th>Status</th>
                </tr>
                {connection_rows}
            </table>
            
            <script>
                setTimeout(function() {{ 
                    window.location.reload(); 
                }}, 5000);
            </script>
        </body>
        </html>
        """
        
        # Generate table rows
        connection_rows = ""
        for conn in connections:
            status_class = "active" if conn.get("active", False) else "inactive"
            status_text = "Connected" if conn.get("active", False) else "Disconnected"
            connection_rows += f"""
            <tr>
                <td>{conn.get("robot_id", "Unknown")}</td>
                <td>{conn.get("ip", "Unknown")}</td>
                <td>{conn.get("port", "Unknown")}</td>
                <td class="{status_class}">{status_text}</td>
            </tr>
            """
        
        # Fill template with safe defaults for missing values
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        html = html.format(
            server_time=current_time,
            connection_count=len(connections),
            connection_rows=connection_rows or "<tr><td colspan='4'>No connections</td></tr>"
        )
        
        return web.Response(text=html, content_type="text/html")
    except Exception as e:
        # Log lỗi và trả về trang lỗi chi tiết
        logger.error(f"Error in status page: {e}", exc_info=True)
        # ... error page HTML ...

@routes.get('/db-stats')
async def get_db_stats(request):
    """Get database writer statistics"""
    stats = db_writer.get_stats()
    return web.json_response(stats)

@routes.get('/robots-list')
async def get_robots_list(request):
    """Get list of all connected robots with their IP addresses"""
    robots = ConnectionManager.get_all_robots_with_ip()
    return web.json_response({
        "status": "success",
        "robots": robots,
        "count": len(robots)
    })

@routes.post('/firmware/ip')
async def send_firmware_by_ip(request):
    """Send firmware to a robot by IP address"""
    try:
        data = await request.json()
        target_ip = data.get("ip")
        target_port = data.get("port")
        firmware_data = data.get("firmware_data")
        
        if not target_ip or not firmware_data:
            return web.json_response({
                "status": "error", 
                "message": "Missing ip or firmware_data in request"
            }, status=400)
        
        # Use the DirectBridge instance to send firmware
        bridge = DirectBridge()
        result = await bridge.send_firmware_by_ip(target_ip, firmware_data, target_port)
        
        if result["status"] == "success":
            return web.json_response(result)
        else:
            return web.json_response(result, status=404)
            
    except Exception as e:
        logger.error(f"Error processing firmware by IP request: {e}")
        return web.json_response({
            "status": "error",
            "message": str(e)
        }, status=500)

@routes.get('/connections')
async def list_connections(request):
    """List all active connections with IP and robot ID mapping"""
    try:
        connections = []
        
        for robot_id, addr in getattr(ConnectionManager, '_robot_to_addr', {}).items():
            if addr and len(addr) == 2:
                ip, port = addr
                connections.append({
                    "robot_id": robot_id,
                    "ip": ip,
                    "port": port,
                    "active": robot_id in getattr(ConnectionManager, '_tcp_clients', {}),
                    "connected_since": time.time()
                })
        
        return web.json_response({
            "status": "success",
            "connections": connections,
            "count": len(connections),
            "timestamp": time.time()
        })
    except Exception as e:
        logger.error(f"Error in connections API: {e}", exc_info=True)
        return web.json_response({
            "status": "error",
            "message": str(e),
            "timestamp": time.time()
        }, status=500)

# Main function
async def main():
    # Khởi tạo các tham số từ command line
    parser = argparse.ArgumentParser(description="DirectBridge TCP-WebSocket bridge")
    parser.add_argument("--tcp-port", type=int, default=9000, help="TCP server port")
    parser.add_argument("--ws-port", type=int, default=9003, help="WebSocket server port")
    parser.add_argument("--api-port", type=int, default=9004, help="API server port") # Thêm tham số API port
    parser.add_argument("--log-level", type=str, default="INFO", help="Logging level")
    args = parser.parse_args()

    # Thiết lập logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(levelname)s:%(name)s:%(message)s',
    )
    
    # Khởi tạo bridge
    bridge = DirectBridge(tcp_port=args.tcp_port, ws_port=args.ws_port)
    await bridge.start()
    
    # Khởi động high performance database writer
    db_writer.start()
    
    # Tạo và khởi động API server
    logger.info(f"Khởi động API server trên port {args.api_port}...")
    app = web.Application()
    app.add_routes(routes)  # routes đã được định nghĩa trước đó
    
    # Khởi động API server
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', args.api_port)
    await site.start()
    logger.info(f"✅ API server đã khởi động thành công tại http://localhost:{args.api_port}")
    
    try:
        # Giữ server chạy vô thời hạn
        while True:
            await asyncio.sleep(3600)  # Sleep trong 1 giờ
    finally:
        # Dọn dẹp khi kết thúc
        logger.info("Đang dừng các dịch vụ...")
        db_writer.stop()
        await runner.cleanup()

if __name__ == "__main__":
    asyncio.run(main())