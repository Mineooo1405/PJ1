import { BehaviorSubject } from 'rxjs';

// Define WebSocket statuses
type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

class TcpWebSocketService {
  private socket: WebSocket | null = null;
  private url: string;
  private messageListeners: Map<string, Set<(data: any) => void>> = new Map();
  private connectionChangeListeners: Set<() => void> = new Set();
  private pingInterval: number | null = null;
  private status: BehaviorSubject<WebSocketStatus> = new BehaviorSubject<WebSocketStatus>('disconnected');
  
  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname === 'localhost' ? 'localhost:9003' : window.location.host;
    this.url = `${protocol}//${hostname}/ws/server`;
  }
  
  // Connect to WebSocket server
  public connect(): void {
    if (this.socket && 
        (this.socket.readyState === WebSocket.OPEN || 
         this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    this.status.next('connecting');
    
    try {
      console.log(`[TCP WebSocket] Connecting to ${this.url}...`);
      this.socket = new WebSocket(this.url);
      
      this.socket.onopen = () => {
        console.log(`[TCP WebSocket] Connected to ${this.url}`);
        this.status.next('connected');
        
        // Start ping interval
        this.startPingInterval();
        
        // Notify connection change listeners
        this.notifyConnectionChange();
      };
      
      this.socket.onclose = () => {
        console.log(`[TCP WebSocket] Disconnected from ${this.url}`);
        this.status.next('disconnected');
        this.socket = null;
        
        // Stop ping interval
        this.stopPingInterval();
        
        // Notify connection change listeners
        this.notifyConnectionChange();
      };
      
      this.socket.onerror = (error) => {
        console.error(`[TCP WebSocket] Error on ${this.url}:`, error);
        this.status.next('error');
        
        // Notify connection change listeners
        this.notifyConnectionChange();
      };
      
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Process message based on type
          const messageType = data.type || '*';
          
          // Call specific type listeners
          if (this.messageListeners.has(messageType)) {
            this.messageListeners.get(messageType)!.forEach(listener => {
              try {
                listener(data);
              } catch (err) {
                console.error(`[TCP WebSocket] Error in message listener for type ${messageType}:`, err);
              }
            });
          }
          
          // Call wildcard listeners
          if (this.messageListeners.has('*')) {
            this.messageListeners.get('*')!.forEach(listener => {
              try {
                listener(data);
              } catch (err) {
                console.error(`[TCP WebSocket] Error in wildcard listener:`, err);
              }
            });
          }
        } catch (err) {
          console.error(`[TCP WebSocket] Error parsing message:`, err);
        }
      };
    } catch (err) {
      console.error(`[TCP WebSocket] Error creating connection:`, err);
      this.status.next('error');
    }
  }
  
  // Disconnect from WebSocket server
  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.status.next('disconnected');
    this.stopPingInterval();
  }
  
  // Send a message to the WebSocket server
  public sendMessage(message: any): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    
    return false;
  }
  
  // Register a message listener for a specific type
  public onMessage(type: string, callback: (data: any) => void): void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Set());
    }
    
    this.messageListeners.get(type)!.add(callback);
  }
  
  // Unregister a message listener
  public offMessage(type: string, callback: (data: any) => void): void {
    if (this.messageListeners.has(type)) {
      this.messageListeners.get(type)!.delete(callback);
    }
  }
  
  // Register a connection change listener
  public onConnectionChange(callback: () => void): void {
    this.connectionChangeListeners.add(callback);
  }
  
  // Unregister a connection change listener
  public offConnectionChange(callback: () => void): void {
    this.connectionChangeListeners.delete(callback);
  }
  
  // Check if the WebSocket is connected
  public isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  // Get current connection status
  public getStatus(): WebSocketStatus {
    return this.status.value;
  }
  
  // Subscribe to status changes
  public onStatusChange(callback: (status: WebSocketStatus) => void): () => void {
    const subscription = this.status.subscribe(callback);
    return () => subscription.unsubscribe();
  }
  
  // Start ping interval to keep connection alive
  private startPingInterval(): void {
    this.stopPingInterval();
    
    this.pingInterval = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: "ping", timestamp: Date.now() / 1000 });
      }
    }, 30000);
  }
  
  // Stop ping interval
  private stopPingInterval(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  // Notify all connection change listeners
  private notifyConnectionChange(): void {
    this.connectionChangeListeners.forEach(listener => {
      try {
        listener();
      } catch (err) {
        console.error(`[TCP WebSocket] Error in connection change listener:`, err);
      }
    });
  }
}

// Create and export singleton instance
const tcpWebSocketService = new TcpWebSocketService();
export default tcpWebSocketService;