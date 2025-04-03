import sqlite3
import sys
import os
from tabulate import tabulate  # pip install tabulate
from datetime import datetime

def print_table(rows, headers):
    """Print data in table format"""
    print(tabulate(rows, headers=headers, tablefmt="grid"))

def main():
    # Default database path
    db_path = "./robot_data.db"
    
    # Check if database exists
    if not os.path.exists(db_path):
        print(f"Database file not found: {db_path}")
        sys.exit(1)
    
    # Connect to database
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    # Show menu
    while True:
        print("\n==== SQLite Database Viewer ====")
        print("1. List tables")
        print("2. View encoder data")
        print("3. View IMU data")
        print("4. View robots")
        print("5. Run custom query")
        print("6. View database stats")
        print("0. Exit")
        
        choice = input("\nEnter choice: ")
        
        if choice == "1":
            # List tables
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [row[0] for row in cursor.fetchall()]
            print("\nTables in database:")
            for i, table in enumerate(tables):
                print(f"{i+1}. {table}")
        
        elif choice == "2":
            # View encoder data
            limit = int(input("Enter number of records to show (10): ") or "10")
            robot_id = input("Enter robot_id (all): ") or None
            
            query = "SELECT id, robot_id, rpm_1, rpm_2, rpm_3, timestamp FROM encoder_data"
            params = []
            
            if robot_id:
                query += " WHERE robot_id = ?"
                params.append(robot_id)
            
            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)
            
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            
            if not rows:
                print("No encoder data found.")
            else:
                print_table(rows, ["ID", "Robot ID", "RPM 1", "RPM 2", "RPM 3", "Timestamp"])
                print(f"Showing {len(rows)} records.")
        
        elif choice == "3":
            # View IMU data
            limit = int(input("Enter number of records to show (10): ") or "10")
            robot_id = input("Enter robot_id (all): ") or None
            
            query = "SELECT id, robot_id, roll, pitch, yaw, timestamp FROM imu_data"
            params = []
            
            if robot_id:
                query += " WHERE robot_id = ?"
                params.append(robot_id)
            
            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)
            
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            
            if not rows:
                print("No IMU data found.")
            else:
                print_table(rows, ["ID", "Robot ID", "Roll", "Pitch", "Yaw", "Timestamp"])
                print(f"Showing {len(rows)} records.")
        
        elif choice == "4":
            # View robots
            cursor = conn.execute("SELECT * FROM robots")
            rows = cursor.fetchall()
            
            if not rows:
                print("No robots found.")
            else:
                print_table(rows, rows[0].keys())
        
        elif choice == "5":
            # Run custom query
            query = input("Enter SQL query: ")
            try:
                cursor = conn.execute(query)
                rows = cursor.fetchall()
                
                if not rows:
                    print("Query returned no results.")
                else:
                    print_table(rows, rows[0].keys())
                    print(f"Query returned {len(rows)} rows.")
            except Exception as e:
                print(f"Error executing query: {e}")
        
        elif choice == "6":
            # View database stats
            print("\n==== Database Statistics ====")
            
            # Count records
            cursor = conn.execute("SELECT COUNT(*) FROM encoder_data")
            encoder_count = cursor.fetchone()[0]
            
            cursor = conn.execute("SELECT COUNT(*) FROM imu_data")
            imu_count = cursor.fetchone()[0]
            
            cursor = conn.execute("SELECT COUNT(*) FROM robots")
            robot_count = cursor.fetchone()[0]
            
            # Get file size
            db_size_mb = os.path.getsize(db_path) / (1024 * 1024)
            
            # Get newest record time
            cursor = conn.execute("SELECT MAX(timestamp) FROM encoder_data")
            newest_encoder = cursor.fetchone()[0] or "No data"
            
            cursor = conn.execute("SELECT MAX(timestamp) FROM imu_data")
            newest_imu = cursor.fetchone()[0] or "No data"
            
            print(f"Database file size: {db_size_mb:.2f} MB")
            print(f"Encoder records: {encoder_count}")
            print(f"IMU records: {imu_count}")
            print(f"Robots: {robot_count}")
            print(f"Most recent encoder data: {newest_encoder}")
            print(f"Most recent IMU data: {newest_imu}")
            
        elif choice == "0":
            # Exit
            break
        else:
            print("Invalid choice. Please try again.")
    
    conn.close()
    print("Database connection closed.")

if __name__ == "__main__":
    main()