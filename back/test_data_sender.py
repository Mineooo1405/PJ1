import socket
import json
import time
import argparse
import os

def send_message(sock, data):
    """Send JSON message to socket with newline terminator"""
    message = json.dumps(data) + "\n"
    sock.sendall(message.encode())
    print(f"Sent: {data.get('type')} message")

def load_json_data(file_path):
    """Load JSON data from file"""
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
        print(f"Loaded {len(data)} records from {file_path}")
        return data
    except Exception as e:
        print(f"Error loading data from {file_path}: {e}")
        return []

def connect_to_direct_bridge(robot_id, service_type="data"):
    """Connect to DirectBridge and register as a robot"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.connect(('localhost', 9000))
        print(f"Connected to DirectBridge on port 9000 as {robot_id}")
        
        # Register with DirectBridge
        registration = {"type": "registration", "robot_id": robot_id, "service": service_type}
        send_message(sock, registration)
        
        # Wait for registration response
        response = sock.recv(4096).decode()
        print(f"Registration response: {response.strip()}")
        
        return sock
    except Exception as e:
        print(f"Error connecting to DirectBridge: {e}")
        sock.close()
        return None

def send_test_data(data_type, data_file, robot_id="robot1", delay=0.1):
    """Send test data from JSON file to DirectBridge"""
    # Connect to DirectBridge
    sock = connect_to_direct_bridge(robot_id)
    if not sock:
        return False
    
    try:
        # Load data
        data_path = os.path.join("json_data", data_file)
        if not os.path.exists(data_path):
            data_path = data_file  # Try direct path if not found in json_data folder
        
        data_records = load_json_data(data_path)
        
        if not data_records:
            print(f"No data found in {data_path}")
            return False
        
        # Filter out empty records
        data_records = [record for record in data_records if record]
        print(f"Found {len(data_records)} non-empty records")
        
        # Send data records with delay between them
        sent_count = 0
        for record in data_records:
            # Skip records without type
            if "type" not in record:
                record["type"] = data_type
            
            # Ensure record has robot_id
            if "id" not in record:
                record["id"] = robot_id
            
            # Send the record
            send_message(sock, record)
            sent_count += 1
            
            # Print progress
            if sent_count % 10 == 0:
                print(f"Sent {sent_count}/{len(data_records)} records")
            
            # Delay to simulate real-time data
            time.sleep(delay)
        
        print(f"Completed sending {sent_count} {data_type} records")
        return True
        
    except Exception as e:
        print(f"Error sending test data: {e}")
        return False
    finally:
        # Close connection
        sock.close()
        print("Connection closed")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send test data from JSON files to DirectBridge")
    parser.add_argument("--type", choices=["encoder", "bno055"], default="bno055", help="Data type to send")
    parser.add_argument("--file", required=True, help="JSON file containing test data")
    parser.add_argument("--robot", default="robot1", help="Robot ID")
    parser.add_argument("--delay", type=float, default=0.1, help="Delay between records (seconds)")
    
    args = parser.parse_args()
    
    print(f"Sending {args.type} data from {args.file} for robot {args.robot}...")
    send_test_data(args.type, args.file, args.robot, args.delay)