# File cấu hình chung cho hệ thống

import os

# Server configuration
TCP_SERVER_HOST = "0.0.0.0"
TCP_SERVER_PORT = 9000

# WebSocket Bridge configuration
WS_BRIDGE_HOST = "0.0.0.0"
WS_BRIDGE_PORT = 9003

# Frontend WebSocket configuration
FRONTEND_WS_HOST = "0.0.0.0"
FRONTEND_WS_PORT = 9002

# Backend configuration
BACKEND_HOST = "localhost"  # hoặc IP của backend server
BACKEND_PORT = 8000

# Authentication
API_KEY = "140504"  # Thay đổi thành một key bảo mật hơn

# Logging configuration
LOG_LEVEL = "INFO"
LOG_FILE = "tcp_server.log"

# Debug mode (set to False in production)
DEBUG = True