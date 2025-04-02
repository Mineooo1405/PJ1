import { EventEmitter } from 'events';

class TcpWebSocketService {
  private socket: WebSocket | null = null;
  private events = new EventEmitter();
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private robotId = 'robot1';
  
  constructor() {
    this.events.setMaxListeners(20);
  }

  setRobotId(robotId: string) {
    this.robotId = robotId;
    
    // Reconnect if already connected
    if (this.isConnected()) {
      this.disconnect();
      this.connect();
    }
  }

  connect() {
    // Cancel any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
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
      
      const url = `${protocol}//${host}:${port}/ws/${this.robotId}`;
      
      console.log(`Connecting to direct_bridge WebSocket at ${url}`);
      this.socket = new WebSocket(url);
      
      this.socket.onopen = () => {
        console.log('WebSocket connection to direct_bridge established');
        this.connecting = false;
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
        this.events.emit('connectionChange', false);
        this.socket = null;
        
        // Try to reconnect after delay if not manually disconnected
        if (event.code !== 1000 || event.reason !== 'Closed by client') {
          this.scheduleReconnect();
        }
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connecting = false;
        this.events.emit('connectionChange', false);
        
        // Socket error typically means we should reconnect
        if (this.socket) {
          this.socket.close();
          this.socket = null;
          this.scheduleReconnect();
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
    if (this.socket) {
      this.socket.close(1000, 'Closed by client');
      this.socket = null;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect WebSocket...');
      this.connect();
    }, 2000); // Try after 2 seconds
  }
  
  sendMessage(message: any): boolean {
    if (!this.isConnected()) {
      console.error('Cannot send message, WebSocket is not connected');
      // Try to reconnect if not connected
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
      
      // Log the message being sent
      console.log('Sending WebSocket message:', message);
      
      // Send the message
      this.socket!.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      
      // If we got an error while sending, the socket might be broken
      // Schedule a reconnection attempt
      if (this.socket) {
        this.socket.close(); // Force close to trigger reconnect
        this.socket = null;
        this.scheduleReconnect();
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