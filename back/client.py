import socket
import json
import time

def send_message(sock, data):
    message = json.dumps(data) + "\n"  # Ensure newline character
    sock.sendall(message.encode())
    print(f"Sent: {data}")

# Connect to server
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(('localhost', 9000))
sock.setblocking(True)  # Ensure blocking mode

# First send registration message
registration = {"type": "registration", "robot_id": "robot1"}
send_message(sock, registration)

# Wait for registration to complete
time.sleep(1)

# Send multiple test messages
for i in range(3):
    test_msg = { "robot_id": "robot1", "hi": "hello"}
    send_message(sock, test_msg)
    time.sleep(1)  # Wait between messages

print("Keeping connection open. Press Ctrl+C to exit...")
try:
    while True:
        time.sleep(5)
        # Send periodic heartbeat
        heartbeat = {"type": "heartbeat", "robot_id": "robot1", "timestamp": time.time()}
        send_message(sock, heartbeat)
except KeyboardInterrupt:
    print("Closing connection...")
    sock.close()