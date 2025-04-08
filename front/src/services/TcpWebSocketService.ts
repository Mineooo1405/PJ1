import { EventEmitter } from 'events';

class TcpWebSocketService {
  private socket: WebSocket | null = null;
  private robotId: string = 'robot1';
  private readonly wsUrl: string;
  private connected: boolean = false;
  private eventEmitter = new EventEmitter();
  private reconnectInterval: any = null;
  private messageHandlers: Record<string, Function[]> = {};
  private connectionChangeHandlers: Function[] = [];

  constructor() {
    // Kết nối trực tiếp đến DirectBridge WebSocket, không qua FastAPI
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = `${protocol}//localhost:9003/ws/`;
  }

  public connect(): boolean {
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      console.log('Already connected or connecting');
      return false;
    }

    try {
      const fullUrl = `${this.wsUrl}${this.robotId}`;
      console.log(`Connecting to DirectBridge WebSocket at ${fullUrl}`);
      this.socket = new WebSocket(fullUrl);

      this.socket.onopen = () => {
        console.log('DirectBridge WebSocket connection established');
        this.connected = true;
        this._notifyConnectionChange(true);
        
        // Gửi xác nhận đăng ký để nhận dữ liệu trực tiếp
        this.sendMessage({
          type: 'client_registration',
          client_type: 'web_frontend',
          timestamp: Date.now() / 1000
        });
      };

      this.socket.onclose = (event) => {
        console.log(`DirectBridge WebSocket connection closed: ${event.code} ${event.reason}`);
        this.connected = false;
        this._notifyConnectionChange(false);
        
        // Thiết lập kết nối lại sau 5 giây
        if (!this.reconnectInterval) {
          this.reconnectInterval = setInterval(() => {
            if (!this.connected) {
              this.connect();
            } else {
              clearInterval(this.reconnectInterval);
              this.reconnectInterval = null;
            }
          }, 5000);
        }
      };

      this.socket.onerror = (event) => {
        console.error('DirectBridge WebSocket error:', event);
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.debug('Received message from DirectBridge:', message);
          
          // Phân phối tin nhắn tới các handlers dựa trên message.type
          const messageType = message.type || 'unknown';
          this._notifyHandlers(messageType, message);
          
          // Thông báo cho tất cả các handlers '*' (catch-all)
          this._notifyHandlers('*', message);
        } catch (err) {
          console.error('Failed to parse message:', err, event.data);
        }
      };

      return true;
    } catch (err) {
      console.error('Error connecting to DirectBridge:', err);
      return false;
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.connected = false;
    }
    
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  public isConnected(): boolean {
    return this.connected && this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  public setRobotId(robotId: string): void {
    if (robotId !== this.robotId) {
      const wasConnected = this.isConnected();
      if (wasConnected) {
        this.disconnect();
      }
      
      this.robotId = robotId;
      
      if (wasConnected) {
        this.connect();
      }
    }
  }

  public sendMessage(message: any): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message: Socket not connected');
      return false;
    }
    
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('Error sending message:', err);
      return false;
    }
  }

  public sendPidConfig(robotId: string, motorId: number, pidValues: { kp: number, ki: number, kd: number }): boolean {
    return this.sendMessage({
      type: 'pid_config',
      robot_id: robotId,
      motor_id: motorId,
      kp: pidValues.kp,
      ki: pidValues.ki,
      kd: pidValues.kd,
      timestamp: Date.now() / 1000
    });
  }

  public onMessage(messageType: string, handler: Function): void {
    if (!this.messageHandlers[messageType]) {
      this.messageHandlers[messageType] = [];
    }
    
    if (!this.messageHandlers[messageType].includes(handler)) {
      this.messageHandlers[messageType].push(handler);
    }
  }

  public offMessage(messageType: string, handler: Function): void {
    if (this.messageHandlers[messageType]) {
      const index = this.messageHandlers[messageType].indexOf(handler);
      if (index !== -1) {
        this.messageHandlers[messageType].splice(index, 1);
      }
    }
  }

  public onConnectionChange(handler: Function): void {
    if (!this.connectionChangeHandlers.includes(handler)) {
      this.connectionChangeHandlers.push(handler);
    }
  }

  public offConnectionChange(handler: Function): void {
    const index = this.connectionChangeHandlers.indexOf(handler);
    if (index !== -1) {
      this.connectionChangeHandlers.splice(index, 1);
    }
  }

  private _notifyConnectionChange(isConnected: boolean): void {
    this.connectionChangeHandlers.forEach(handler => {
      try {
        handler(isConnected);
      } catch (err) {
        console.error('Error in connection change handler:', err);
      }
    });
  }

  private _notifyHandlers(messageType: string, data: any): void {
    if (this.messageHandlers[messageType]) {
      this.messageHandlers[messageType].forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in message handler for ${messageType}:`, err);
        }
      });
    }
  }
}

// Khởi tạo và export singleton instance
const tcpWebSocketService = new TcpWebSocketService();
export default tcpWebSocketService;