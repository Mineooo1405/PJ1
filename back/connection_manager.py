import time
from typing import Dict, List, Any, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("connection_manager")

class ConnectionManager:
    # Singleton instance
    _instance = None
    
    # Dict to store all connections
    # Structure: {robot_id: {'websockets': [], 'tcp': None}}
    connections = {
        "robot1": {"websockets": [], "tcp": None},
        "robot2": {"websockets": [], "tcp": None},
        "robot3": {"websockets": [], "tcp": None},
        "robot4": {"websockets": [], "tcp": None},
        "server": {"websockets": [], "tcp": None},
    }
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConnectionManager, cls).__new__(cls)
        return cls._instance
    
    @classmethod
    def normalize_robot_id(cls, robot_id: str) -> str:
        """Normalize robot ID across all components"""
        if "/" in robot_id:
            parts = robot_id.split("/", 1)
            return f"{parts[0]}_{parts[1]}"
        return robot_id
    
    @classmethod
    def add_websocket(cls, robot_id: str, websocket) -> None:
        """Add WebSocket connection for a robot"""
        robot_id = cls.normalize_robot_id(robot_id)
        
        # Initialize dict entry if needed
        if robot_id not in cls.connections:
            cls.connections[robot_id] = {"websockets": [], "tcp": None}
            
        if websocket not in cls.connections[robot_id]["websockets"]:
            cls.connections[robot_id]["websockets"].append(websocket)
            logger.info(f"Added WebSocket for {robot_id}, total: {len(cls.connections[robot_id]['websockets'])}")
    
    @classmethod
    def remove_websocket(cls, robot_id: str, websocket) -> None:
        """Remove WebSocket connection for a robot"""
        robot_id = cls.normalize_robot_id(robot_id)
        
        if robot_id in cls.connections and websocket in cls.connections[robot_id]["websockets"]:
            cls.connections[robot_id]["websockets"].remove(websocket)
            logger.info(f"Removed WebSocket for {robot_id}, remaining: {len(cls.connections[robot_id]['websockets'])}")
    
    @classmethod
    def set_tcp_client(cls, robot_id: str, tcp_socket) -> None:
        """Set TCP client for a robot"""
        robot_id = cls.normalize_robot_id(robot_id)
        
        # Initialize dict entry if needed
        if robot_id not in cls.connections:
            cls.connections[robot_id] = {"websockets": [], "tcp": None}
            
        cls.connections[robot_id]["tcp"] = tcp_socket
        logger.info(f"Set TCP client for {robot_id}")
    
    @classmethod
    def remove_tcp_client(cls, robot_id: str) -> None:
        """Remove TCP client for a robot"""
        robot_id = cls.normalize_robot_id(robot_id)
        
        if robot_id in cls.connections:
            cls.connections[robot_id]["tcp"] = None
            logger.info(f"Removed TCP client for {robot_id}")
    
    @classmethod
    def get_websockets(cls, robot_id: str) -> list:
        """Get all WebSocket connections for a robot"""
        robot_id = cls.normalize_robot_id(robot_id)
        
        if robot_id in cls.connections:
            return cls.connections[robot_id]["websockets"]
        return []
    
    @classmethod
    def get_tcp_client(cls, robot_id: str):
        """Get TCP client for a robot"""
        robot_id = cls.normalize_robot_id(robot_id)
        
        if robot_id in cls.connections:
            return cls.connections[robot_id]["tcp"]
        return None
    
    @classmethod
    def get_connection_stats(cls) -> Dict[str, Dict[str, Any]]:
        """Get connection statistics for all robots"""
        stats = {}
        for robot_id, conn in cls.connections.items():
            stats[robot_id] = {
                "websocket_count": len(conn["websockets"]),
                "has_tcp": conn["tcp"] is not None
            }
        return stats