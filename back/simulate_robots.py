import socket
import json
import time
import random
import threading

def send_message(sock, data):
    message = json.dumps(data) + "\n"  # Ensure newline character
    sock.sendall(message.encode())
    print(f"Sent: {data}")

def robot_client(robot_id):
    try:
        # Connect to server
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(('localhost', 9000))
        sock.setblocking(True)  # Ensure blocking mode
        
        print(f"{robot_id}: Connected to TCP server")

        # First send registration message
        registration = {"type": "registration", "robot_id": robot_id}
        send_message(sock, registration)

        # Wait for registration to complete
        time.sleep(1)
        
        # Main loop - send data periodically
        try:
            while True:
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
                time.sleep(0.2)

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

                time.sleep(0.2)  # Longer wait between cycles
        except KeyboardInterrupt:
            print(f"{robot_id}: Closing connection...")
        finally:
            sock.close()
            
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
            time.sleep(1)
    except KeyboardInterrupt:
        print("Shutting down...")