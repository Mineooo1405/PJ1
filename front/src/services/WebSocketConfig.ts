// Tạo file cấu hình tập trung cho WebSocket endpoints
export const WS_CONFIG = {
  // Base URLs
  BACKEND_URL: process.env.REACT_APP_WS_URL || 'ws://localhost:8000',
  BRIDGE_URL: process.env.REACT_APP_WS_BRIDGE_URL || 'ws://localhost:9003',
  
  // Simple path formats (matching your backend)
  PATHS: {
    SERVER: '/ws/server',
    ROBOT: (robotId: string) => `/ws/${robotId}`,
  },
  
  // Full URLs (for direct use)
  getBackendUrl(path: string): string {
    return `${this.BACKEND_URL}${path}`;
  },
  
  getBridgeUrl(path: string): string {
    return `${this.BRIDGE_URL}${path}`;
  },
  
  // Message types for data requests
  MESSAGE_TYPES: {
    GET_ENCODER: 'get_encoder_data',
    GET_IMU: 'get_imu_data',
    SUBSCRIBE_IMU: 'subscribe_imu',
    UNSUBSCRIBE_IMU: 'unsubscribe_imu',
    SUBSCRIBE_ENCODER: 'subscribe_encoder',
    UNSUBSCRIBE_ENCODER: 'unsubscribe_encoder',
    GET_STATUS: 'get_status',
    PING: 'ping',
  }
};