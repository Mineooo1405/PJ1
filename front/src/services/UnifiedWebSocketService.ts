import { BehaviorSubject } from 'rxjs';
import { WS_CONFIG } from './WebSocketConfig';

export type ConnectionType = 'backend' | 'bridge';
export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected';

interface ConnectionState {
  socket: WebSocket | null;
  status: BehaviorSubject<WebSocketStatus>;
  listeners: Map<string, Set<(data: any) => void>>;
  pingInterval: number | null;
  lastPingTime: number;
  connectionType: ConnectionType;
}

class UnifiedWebSocketService {
  private connections: Map<string, ConnectionState> = new Map();
  
  // Get or create a connection entry
  private getConnection(endpoint: string, connectionType: ConnectionType): ConnectionState {
    if (!this.connections.has(endpoint)) {
      this.connections.set(endpoint, {
        socket: null,
        status: new BehaviorSubject<WebSocketStatus>('disconnected'),
        listeners: new Map(),
        pingInterval: null,
        lastPingTime: 0,
        connectionType
      });
    }
    return this.connections.get(endpoint)!;
  }
  
  // Connect to a WebSocket endpoint
  public connect(endpoint: string, connectionType: ConnectionType = 'backend'): Promise<void> {
    const connection = this.getConnection(endpoint, connectionType);
    
    // Already connected or connecting
    if (connection.socket && 
        (connection.socket.readyState === WebSocket.OPEN || 
         connection.socket.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    
    // Update status to connecting
    connection.status.next('connecting');
    
    return new Promise((resolve, reject) => {
      try {
        // Build the full URL based on connection type
        const baseUrl = connectionType === 'backend' 
          ? WS_CONFIG.BACKEND_URL 
          : WS_CONFIG.BRIDGE_URL;
        
        const url = `${baseUrl}${endpoint}`;
        console.log(`Connecting to WebSocket: ${url}`);
        
        const socket = new WebSocket(url);
        connection.socket = socket;
        
        socket.onopen = () => {
          console.log(`Connected to ${url}`);
          connection.status.next('connected');
          this.startPingInterval(endpoint);
          resolve();
        };
        
        socket.onclose = () => {
          console.log(`Disconnected from ${url}`);
          connection.status.next('disconnected');
          this.stopPingInterval(endpoint);
          connection.socket = null;
        };
        
        socket.onerror = (error) => {
          console.error(`Error in WebSocket connection to ${url}:`, error);
          connection.status.next('disconnected');
          reject(error);
        };
        
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const messageType = data.type || 'unknown';
            
            // Notify listeners for this specific message type
            if (connection.listeners.has(messageType)) {
              connection.listeners.get(messageType)!.forEach(listener => {
                try {
                  listener(data);
                } catch (err) {
                  console.error(`Error in listener for message type ${messageType}:`, err);
                }
              });
            }
            
            // Notify general listeners
            if (connection.listeners.has('*')) {
              connection.listeners.get('*')!.forEach(listener => {
                try {
                  listener(data);
                } catch (err) {
                  console.error('Error in general listener:', err);
                }
              });
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err, event.data);
          }
        };
      } catch (err) {
        connection.status.next('disconnected');
        reject(err);
      }
    });
  }
  
  // Disconnect from WebSocket
  public disconnect(endpoint: string): void {
    if (this.connections.has(endpoint)) {
      const connection = this.connections.get(endpoint)!;
      
      if (connection.socket) {
        connection.socket.close();
        connection.socket = null;
      }
      
      connection.status.next('disconnected');
      this.stopPingInterval(endpoint);
    }
  }
  
  // Send a message through WebSocket
  public sendMessage(endpoint: string, message: any): boolean {
    if (!this.connections.has(endpoint)) {
      console.error(`No connection found for endpoint: ${endpoint}`);
      return false;
    }
    
    const connection = this.connections.get(endpoint)!;
    
    if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
      return true;
    }
    
    console.warn(`Cannot send message, socket not open for ${endpoint}`);
    return false;
  }
  
  // Add listener for a specific message type
  public onMessage(endpoint: string, type: string, callback: (data: any) => void): void {
    if (!this.connections.has(endpoint)) {
      this.getConnection(endpoint, 'backend'); // Create default connection
    }
    
    const connection = this.connections.get(endpoint)!;
    
    if (!connection.listeners.has(type)) {
      connection.listeners.set(type, new Set());
    }
    
    connection.listeners.get(type)!.add(callback);
  }
  
  // Remove listener
  public offMessage(endpoint: string, type: string, callback: (data: any) => void): void {
    if (!this.connections.has(endpoint)) return;
    
    const connection = this.connections.get(endpoint)!;
    
    if (connection.listeners.has(type)) {
      connection.listeners.get(type)!.delete(callback);
    }
  }
  
  // Subscribe to status changes
  public onStatusChange(endpoint: string, callback: (status: WebSocketStatus) => void): () => void {
    if (!this.connections.has(endpoint)) {
      this.getConnection(endpoint, 'backend'); // Create default connection
    }
    
    const subscription = this.connections.get(endpoint)!.status.subscribe(callback);
    return () => subscription.unsubscribe();
  }
  
  // Get current status
  public getStatus(endpoint: string): WebSocketStatus {
    if (!this.connections.has(endpoint)) {
      return 'disconnected';
    }
    
    return this.connections.get(endpoint)!.status.value;
  }
  
  // Start ping interval to keep connection alive
  private startPingInterval(endpoint: string): void {
    if (!this.connections.has(endpoint)) return;
    
    const connection = this.connections.get(endpoint)!;
    this.stopPingInterval(endpoint);
    
    connection.pingInterval = window.setInterval(() => {
      if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
        this.sendMessage(endpoint, {
          type: WS_CONFIG.MESSAGE_TYPES.PING,
          timestamp: Date.now() / 1000
        });
      }
    }, 30000); // Ping every 30 seconds
  }
  
  // Stop ping interval
  private stopPingInterval(endpoint: string): void {
    if (!this.connections.has(endpoint)) return;
    
    const connection = this.connections.get(endpoint)!;
    
    if (connection.pingInterval) {
      clearInterval(connection.pingInterval);
      connection.pingInterval = null;
    }
  }
  
  // Convenience methods for robot operations
  
  // Connect to a robot
  public connectToRobot(robotId: string, isBridge = true): Promise<void> {
    const connectionType = isBridge ? 'bridge' : 'backend';
    const endpoint = WS_CONFIG.PATHS.ROBOT(robotId);
    return this.connect(endpoint, connectionType);
  }
  
  // Disconnect from a robot
  public disconnectFromRobot(robotId: string): void {
    const endpoint = WS_CONFIG.PATHS.ROBOT(robotId);
    this.disconnect(endpoint);
  }
  
  // Send message to a robot
  public sendToRobot(robotId: string, message: any): boolean {
    const endpoint = WS_CONFIG.PATHS.ROBOT(robotId);
    return this.sendMessage(endpoint, message);
  }
  
  // Request IMU data
  public requestIMUData(robotId: string): boolean {
    return this.sendToRobot(robotId, {
      type: WS_CONFIG.MESSAGE_TYPES.GET_IMU,
      robot_id: robotId
    });
  }
  
  // Subscribe to IMU updates
  public subscribeToIMU(robotId: string): boolean {
    return this.sendToRobot(robotId, {
      type: WS_CONFIG.MESSAGE_TYPES.SUBSCRIBE_IMU,
      robot_id: robotId
    });
  }
  
  // Unsubscribe from IMU updates
  public unsubscribeFromIMU(robotId: string): boolean {
    return this.sendToRobot(robotId, {
      type: WS_CONFIG.MESSAGE_TYPES.UNSUBSCRIBE_IMU,
      robot_id: robotId
    });
  }
  
  // Request encoder data
  public requestEncoderData(robotId: string): boolean {
    return this.sendToRobot(robotId, {
      type: WS_CONFIG.MESSAGE_TYPES.GET_ENCODER,
      robot_id: robotId
    });
  }
}

// Create singleton instance
const webSocketService = new UnifiedWebSocketService();
export default webSocketService;