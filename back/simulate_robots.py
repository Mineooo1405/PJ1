import socket
import json
import time
import random
import threading
import select

def send_message(sock, data):
    message = json.dumps(data) + "\n"  # Ensure newline character
    sock.sendall(message.encode())
    print(f"Sent: {data}")

def receive_messages(sock, robot_id, stop_event):
    """Thread function to receive and handle incoming messages"""
    sock.settimeout(1.0)  # Set timeout for recv calls
    
    while not stop_event.is_set():
        try:
            # Use select to check if there's data available (with timeout)
            readable, _, _ = select.select([sock], [], [], 1.0)
            
            if sock in readable:
                # Data is available, read it
                data = sock.recv(4096)
                
                if not data:  # Connection closed
                    print(f"{robot_id}: Connection closed by server")
                    stop_event.set()
                    break
                
                # Try to find complete JSON messages (could be multiple or partial)
                buffer = data.decode('utf-8')
                lines = buffer.split('\n')
                
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    
                    try:
                        message = json.loads(line)
                        print(f"\n{robot_id} RECEIVED: {json.dumps(message, indent=2)}")
                        
                        # Handle specific messages
                        if message.get('type') == 'pid_config':
                            print(f"\n==== PID CONFIG RECEIVED ====")
                            print(f"Motor ID: {message.get('motor_id')}")
                            print(f"Kp: {message.get('kp')}")
                            print(f"Ki: {message.get('ki')}")
                            print(f"Kd: {message.get('kd')}")
                            print("============================\n")
                            
                            # Send an acknowledgment response
                            response = {
                                "id": robot_id,  # Đổi từ robot_id thành id
                                "type": "pid_config_response",
                                "data": {
                                    "status": "success",
                                    "motor_id": message.get("motor_id"),
                                    "time": time.time()
                                }
                            }
                            print(f"Sending PID response: {response}")
                            send_message(sock, response)
                            
                            # Gửi thêm một pid_response như DirectBridge mong đợi
                            response2 = {
                                "id": robot_id,  # Đổi từ robot_id thành id
                                "type": "pid_response",
                                "data": {
                                    "status": "success",
                                    "message": f"PID config applied to motor {message.get('motor_id')}",
                                    "time": time.time()
                                }
                            }
                            print(f"Sending additional pid_response: {response2}")
                            send_message(sock, response2)
                            
                        elif message.get('type') == 'check_firmware_version':
                            print(f"\n==== FIRMWARE VERSION CHECK ====")
                            
                            # Send back current firmware version
                            response = {
                                "id": robot_id,  # Đổi từ robot_id thành id
                                "type": "firmware_version",
                                "data": {
                                    "version": "1.0.0",
                                    "build_date": "2025-04-01",
                                    "status": "stable",
                                    "time": time.time()
                                }
                            }
                            send_message(sock, response)
                            
                        elif message.get('type') == 'firmware_update_start':
                            print(f"\n==== FIRMWARE UPDATE STARTED ====")
                            print(f"Filename: {message.get('filename')}")
                            print(f"Size: {message.get('filesize')} bytes")
                            print(f"Version: {message.get('version')}")
                            
                            # Acknowledge start of firmware update
                            response = {
                                "id": robot_id,  # Đổi từ robot_id thành id
                                "type": "firmware_response",
                                "data": {
                                    "status": "start_ok",
                                    "message": "Ready to receive firmware",
                                    "time": time.time()
                                }
                            }
                            send_message(sock, response)
                            
                        elif message.get('type') == 'firmware_chunk':
                            chunk_index = message.get('chunk_index', 0)
                            total_chunks = message.get('total_chunks', 1)
                            progress = int((chunk_index + 1) / total_chunks * 100)
                            
                            print(f"\rReceiving firmware chunk: {chunk_index+1}/{total_chunks} ({progress}%)", end="")
                            
                            # Send progress periodically to avoid flooding
                            if chunk_index % 5 == 0 or chunk_index == total_chunks - 1:
                                response = {
                                    "id": robot_id,  # Đổi từ robot_id thành id
                                    "type": "firmware_progress",
                                    "data": {
                                        "progress": progress,
                                        "chunk": chunk_index,
                                        "total": total_chunks,
                                        "time": time.time()
                                    }
                                }
                                send_message(sock, response)
                                
                        elif message.get('type') == 'firmware_update_complete':
                            print(f"\n\n==== FIRMWARE UPDATE COMPLETED ====")
                            
                            # Send completion notification
                            response = {
                                "id": robot_id,  # Đổi từ robot_id thành id
                                "type": "firmware_response",
                                "data": {
                                    "status": "success",
                                    "message": "Firmware update successful",
                                    "version": "1.0.1",
                                    "time": time.time()
                                }
                            }
                            send_message(sock, response)
                            
                    except json.JSONDecodeError:
                        print(f"{robot_id}: Failed to parse JSON: {line}")
        except socket.timeout:
            # Normal timeout, just continue the loop
            pass
        except Exception as e:
            print(f"{robot_id}: Error receiving data: {str(e)}")
            stop_event.set()
            break

def robot_client(robot_id):
    try:
        # Connect to server
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(('localhost', 9000))
        
        print(f"{robot_id}: Connected to TCP server")

        # First send registration message - giữ nguyên định dạng này để tương thích
        registration = {"type": "registration", "robot_id": robot_id}
        send_message(sock, registration)

        # Create a stop event for graceful thread termination
        stop_event = threading.Event()
        
        # Start a thread for receiving messages
        receive_thread = threading.Thread(
            target=receive_messages, 
            args=(sock, robot_id, stop_event),
            daemon=True
        )
        receive_thread.start()
        print(f"{robot_id}: Started receive thread")

        # Wait for registration to complete
        time.sleep(1)
        
        # Main loop - send data periodically
        try:
            # Keep track of last send times to maintain stable frequency
            last_encoder_send = time.time()
            last_imu_send = time.time()
            
            # Target frequencies
            encoder_interval = 0.020  # 50Hz (every 20ms)
            imu_interval = 0.050      # 20Hz (every 50ms)
            
            while not stop_event.is_set():
                current_time = time.time()
                
                # Send encoder data at target frequency
                if current_time - last_encoder_send >= encoder_interval:
                    # Format mới cho encoder data
                    encoder_data = {
                        "id": robot_id,  # Đổi từ robot_id thành id
                        "type": "encoder",
                        "data": [
                            random.uniform(-30, 30),  # rpm1
                            random.uniform(-30, 30),  # rpm2
                            random.uniform(-30, 30)   # rpm3
                        ]
                    }
                    send_message(sock, encoder_data)
                    last_encoder_send = current_time
                
                # Send IMU data at target frequency
                if current_time - last_imu_send >= imu_interval:
                    # Format mới cho IMU data
                    imu_data = {
                        "id": robot_id,  # Đổi từ robot_id thành id
                        "type": "bno055",  # Đổi từ imu thành bno055
                        "data": {
                            "time": current_time,
                            "euler": [
                                random.uniform(-0.5, 0.5),    # roll
                                random.uniform(-0.3, 0.3),    # pitch
                                random.uniform(-3.14, 3.14)   # yaw
                            ],
                            "quaternion": [
                                1.0,  # qw
                                0.0,  # qx
                                0.0,  # qy
                                0.0   # qz
                            ]
                        }
                    }
                    send_message(sock, imu_data)
                    last_imu_send = current_time
                
                # Sleep a short time to avoid CPU spinning
                time.sleep(0.001)
                
        except KeyboardInterrupt:
            print(f"{robot_id}: Closing connection...")
        finally:
            # Signal the receive thread to stop
            stop_event.set()
            sock.close()
            receive_thread.join(timeout=2.0)
            
    except Exception as e:
        print(f"{robot_id}: Error - {str(e)}")

# Start a thread for each robot
if __name__ == "__main__":
    robots = ["robot1"]
    threads = []
   
    try:
        for robot_id in robots:
            thread = threading.Thread(target=robot_client, args=(robot_id,))
            thread.daemon = True
            threads.append(thread)
            thread.start()
            print(f"Started thread for {robot_id}")
            time.sleep(1)  # Stagger connections
        
        # Keep main thread running
        while True:
            time.sleep(0.1)  # Faster response to KeyboardInterrupt
    except KeyboardInterrupt:
        print("\nShutting down...")