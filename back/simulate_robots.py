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
                                "type": "pid_config_response",
                                "robot_id": robot_id,
                                "status": "success",
                                "motor_id": message.get("motor_id"),
                                "timestamp": time.time()
                            }
                            send_message(sock, response)
                            
                        elif message.get('type') == 'check_firmware_version':
                            print(f"\n==== FIRMWARE VERSION CHECK ====")
                            
                            # Send back current firmware version
                            response = {
                                "type": "firmware_version",
                                "robot_id": robot_id,
                                "version": "1.0.0",
                                "build_date": "2025-04-01",
                                "status": "stable",
                                "timestamp": time.time()
                            }
                            send_message(sock, response)
                            
                        elif message.get('type') == 'firmware_update_start':
                            print(f"\n==== FIRMWARE UPDATE STARTED ====")
                            print(f"Filename: {message.get('filename')}")
                            print(f"Size: {message.get('filesize')} bytes")
                            print(f"Version: {message.get('version')}")
                            
                            # Acknowledge start of firmware update
                            response = {
                                "type": "firmware_response",
                                "robot_id": robot_id,
                                "status": "start_ok",
                                "message": "Ready to receive firmware",
                                "timestamp": time.time()
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
                                    "type": "firmware_progress",
                                    "robot_id": robot_id,
                                    "progress": progress,
                                    "chunk": chunk_index,
                                    "total": total_chunks,
                                    "timestamp": time.time()
                                }
                                send_message(sock, response)
                                
                        elif message.get('type') == 'firmware_update_complete':
                            print(f"\n\n==== FIRMWARE UPDATE COMPLETED ====")
                            
                            # Send completion notification
                            response = {
                                "type": "firmware_response",
                                "robot_id": robot_id,
                                "status": "success",
                                "message": "Firmware update successful",
                                "version": "1.0.1",
                                "timestamp": time.time()
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

        # First send registration message
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
            while not stop_event.is_set():
                # Send encoder data
                encoder_data = {
                    "type": "encoder",
                    "robot_id": robot_id,
                    "rpm1": random.uniform(-30, 30),
                    "rpm2": random.uniform(-30, 30),
                    "rpm3": random.uniform(-30, 30),
                    "timestamp": time.time()
                }
                send_message(sock, encoder_data)
                time.sleep(10)  # Reduced time to make testing faster

                # Send IMU data
                imu_data = {
                    "type": "imu",
                    "robot_id": robot_id,
                    "roll": random.uniform(-0.5, 0.5),
                    "pitch": random.uniform(-0.3, 0.3),
                    "yaw": random.uniform(-3.14, 3.14),
                    "qw": 1.0,
                    "qx": 0.0,
                    "qy": 0.0,
                    "qz": 0.0,
                    "timestamp": time.time()
                }
                send_message(sock, imu_data)

                time.sleep(10)  # Reduced time to make testing faster
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
    
    print("===== ROBOT SIMULATOR =====")
    print("This simulator will:")
    print("1. Connect to DirectBridge as a robot")
    print("2. Send periodic encoder and IMU data")
    print("3. Receive and display PID configurations")
    print("4. Handle firmware update requests")
    print("===========================")
    
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