import { EventEmitter } from 'events';

class TcpWebSocketService {
  private socket: WebSocket | null = null;
  private events = new EventEmitter();
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private url = '';
  private robotId = 'robot1';
  
  constructor() {
    this.events.setMaxListeners(20);
  }

  setRobotId(robotId: string) {
    this.robotId = robotId;
    
    // Reconnect if already connected
    if (this.isConnected()) {
      this.disconnect();
      setTimeout(() => this.connect(), 500);
    }
  }

  connect() {
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // If already connected or connecting, do nothing
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket is already connected or connecting');
      return;
    }
    
    if (this.connecting) {
      console.log('Connection already in progress');
      return;
    }
    
    this.connecting = true;
    
    try {
      // Connect to direct_bridge WebSocket server
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      const port = 9003; // direct_bridge WebSocket port
      
      this.url = `${protocol}//${host}:${port}/ws/${this.robotId}`;
      
      console.log(`Connecting to direct_bridge WebSocket at ${this.url}`);
      this.socket = new WebSocket(this.url);
      
      this.socket.onopen = () => {
        console.log('WebSocket connection to direct_bridge established');
        this.connecting = false;
        this.reconnectAttempts = 0;
        this.events.emit('connectionChange', true);
        
        // Send identification message
        this.sendMessage({
          type: 'registration',
          robot_id: this.robotId,
          client_type: 'frontend'
        });
      };
      
      this.socket.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code} - ${event.reason}`);
        this.connecting = false;
        this.socket = null;
        this.events.emit('connectionChange', false);
        
        // Always try to reconnect unless it was a manual disconnect
        if (event.reason !== 'Manual disconnect') {
          this.scheduleReconnect();
        }
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connecting = false;
        this.events.emit('connectionChange', false);
        
        // If there's an error, close the socket to trigger reconnect via onclose
        if (this.socket) {
          this.socket.close();
        }
      };
      
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received WebSocket message:', data);
          
          // Forward message to listeners
          this.events.emit('message', data);
          
          // Also emit based on message type if available
          if (data.type) {
            this.events.emit(`message:${data.type}`, data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      this.connecting = false;
      this.events.emit('connectionChange', false);
      this.scheduleReconnect();
    }
  }
  
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.socket) {
      // Use manual disconnect reason to avoid auto reconnect
      this.socket.close(1000, 'Manual disconnect');
      this.socket = null;
    }
  }
  
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // Exponential backoff with max delay of 30 seconds
    this.reconnectAttempts++;
    const delay = Math.min(Math.pow(1.5, Math.min(this.reconnectAttempts, 10)) * 1000, 30000);
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect...');
      this.connect();
    }, delay);
  }
  
  sendMessage(message: any): boolean {
    if (!this.isConnected()) {
      console.error('Cannot send message, WebSocket is not connected');
      // Try to reconnect
      this.connect();
      return false;
    }
    
    try {
      // Add robot_id and timestamp if not already present
      if (!message.robot_id) {
        message.robot_id = this.robotId;
      }
      
      if (!message.timestamp) {
        message.timestamp = Date.now() / 1000;
      }
      
      // Clone the message before stringifying to avoid circular references
      const messageCopy = JSON.parse(JSON.stringify(message));
      
      this.socket!.send(JSON.stringify(messageCopy));
      console.log('Sent message:', messageCopy);
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      
      // If there's an error while sending, the connection might be broken
      // Close the socket to trigger reconnect
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      
      return false;
    }
  }
  
  // Send PID configuration directly to robot via direct_bridge
  sendPidConfig(robotId: string, motorId: number, pidValues: any): boolean {
    return this.sendMessage({
      type: 'pid_config',
      robot_id: robotId,
      motor_id: motorId,
      kp: pidValues.kp,
      ki: pidValues.ki,
      kd: pidValues.kd
    });
  }
  
  // Event listeners
  onMessage(type: string | 'message', callback: (data: any) => void) {
    if (type === 'message') {
      this.events.on('message', callback);
    } else {
      this.events.on(`message:${type}`, callback);
    }
    return this;
  }
  
  offMessage(type: string | 'message', callback: (data: any) => void) {
    if (type === 'message') {
      this.events.off('message', callback);
    } else {
      this.events.off(`message:${type}`, callback);
    }
    return this;
  }
  
  onConnectionChange(callback: (connected: boolean) => void) {
    this.events.on('connectionChange', callback);
    return this;
  }
  
  offConnectionChange(callback: (connected: boolean) => void) {
    this.events.off('connectionChange', callback);
    return this;
  }
}

// Create a singleton instance
const tcpWebSocketService = new TcpWebSocketService();
export default tcpWebSocketService;