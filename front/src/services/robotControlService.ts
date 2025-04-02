/**
 * Robot Control Service - Direct connection to robot control WebSocket
 * This service creates a separate WebSocket connection specifically for robot control commands
 */

// Define message types
export interface RobotMessage {
  type: string;
  timestamp: number;
  robot_id?: string;
  command_id?: number;
  [key: string]: any;
}

export interface MotorControlCommand extends RobotMessage {
  type: 'motor_control';
  speeds: number[];
}

export interface PIDConfigCommand extends RobotMessage {
  type: 'pid_config';
  motor_id: number;
  parameters: {
    kp: number;
    ki: number;
    kd: number;
  };
}

export interface EmergencyStopCommand extends RobotMessage {
  type: 'emergency_stop';
}

export interface MotionCommand extends RobotMessage {
  type: 'motion_command';
  velocities: {
    x: number;
    y: number;
    theta: number;
  };
}

export interface CommandResponse extends RobotMessage {
  status: 'success' | 'error' | 'executed' | 'forwarded' | 'timeout';
  message: string;
}

// Type for message handlers
type MessageHandler = (message: RobotMessage) => void;

// Pending command interface
interface PendingCommand {
  resolve: (value: RobotMessage) => void;
  reject: (reason: Error) => void;
}

class RobotControlService {
  private socket: WebSocket | null = null;
  private connected = false;
  private connectionPromise: Promise<void> | null = null;
  private messageHandlers: Record<string, MessageHandler[]> = {};
  private commandId = 1;
  private pendingCommands: Record<number, PendingCommand> = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: number | null = null;

  /**
   * Connect to the robot control WebSocket server
   * @returns {Promise<void>} Resolves when connected
   */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    
    // If we're already connecting, return the existing promise
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      // Create WebSocket connection to the bridge
      const serverUrl = 'ws://localhost:9001';
      console.log(`Connecting to robot control WebSocket at ${serverUrl}...`);
      
      this.socket = new WebSocket(serverUrl);

      this.socket.onopen = () => {
        console.log('Robot control WebSocket connected!');
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as RobotMessage;
          console.log('Received from robot control:', message);
          
          // Check if this is a response to a pending command
          if (message.command_id && this.pendingCommands[message.command_id]) {
            const { resolve } = this.pendingCommands[message.command_id];
            resolve(message);
            delete this.pendingCommands[message.command_id];
          }
          
          // Process by message type
          const handlers = this.messageHandlers[message.type] || [];
          handlers.forEach(handler => handler(message));
          
          // Also process generic handlers
          const allHandlers = this.messageHandlers['*'] || [];
          allHandlers.forEach(handler => handler(message));
          
        } catch (e) {
          console.error('Error processing robot control message:', e);
        }
      };

      this.socket.onclose = () => {
        console.log('Robot control WebSocket disconnected');
        this.connected = false;
        this.connectionPromise = null;
        
        // Reject any pending commands
        Object.values(this.pendingCommands).forEach(({ reject }) => {
          reject(new Error('WebSocket connection closed'));
        });
        this.pendingCommands = {};
        
        // Attempt to reconnect
        this.reconnect();
      };

      this.socket.onerror = (error) => {
        console.error('Robot control WebSocket error:', error);
        reject(error);
      };
    });

    return this.connectionPromise;
  }

  /**
   * Attempt to reconnect to the WebSocket server
   */
  private reconnect(): void {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Maximum reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimeout = window.setTimeout(() => {
      console.log('Reconnecting to robot control WebSocket...');
      this.connect().catch(error => {
        console.error('Failed to reconnect:', error);
      });
    }, delay);
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.connected = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Send a command to the robot
   * @param {string} type - Command type
   * @param {object} params - Command parameters
   * @returns {Promise<RobotMessage>} Resolves with response
   */
  async sendCommand<T extends RobotMessage>(type: string, params: Partial<Omit<T, 'type' | 'command_id' | 'timestamp'>> = {}): Promise<RobotMessage> {
    await this.connect();
    
    if (!this.socket) {
      throw new Error('WebSocket not connected');
    }
    
    const commandId = this.commandId++;
    const command = {
      type,
      command_id: commandId,
      timestamp: Date.now() / 1000,
      ...params
    };
    
    console.log(`Sending robot command: ${type}`, command);
    
    return new Promise<RobotMessage>((resolve, reject) => {
      // Save the promise handlers for when we get a response
      this.pendingCommands[commandId] = { resolve, reject };
      
      // Set a timeout to reject the promise if no response
      window.setTimeout(() => {
        if (this.pendingCommands[commandId]) {
          reject(new Error(`Command ${type} timed out`));
          delete this.pendingCommands[commandId];
        }
      }, 10000); // 10 second timeout
      
      // Send the command
      this.socket!.send(JSON.stringify(command));
    });
  }

  /**
   * Register a handler for a specific message type
   * @param {string} type - Message type or '*' for all messages
   * @param {function} handler - Function to call with message
   */
  onMessage(type: string, handler: MessageHandler): void {
    if (!this.messageHandlers[type]) {
      this.messageHandlers[type] = [];
    }
    this.messageHandlers[type].push(handler);
  }

  /**
   * Remove a message handler
   * @param {string} type - Message type
   * @param {function} handler - Handler to remove
   */
  offMessage(type: string, handler: MessageHandler): void {
    if (this.messageHandlers[type]) {
      this.messageHandlers[type] = this.messageHandlers[type].filter(h => h !== handler);
    }
  }

  // Robot control convenience methods

  /**
   * Send a motor control command
   * @param {string} robotId - Robot ID
   * @param {Array<number>} speeds - Array of motor speeds
   * @returns {Promise<CommandResponse>} Resolves with response
   */
  async setMotorSpeeds(robotId: string, speeds: number[]): Promise<CommandResponse> {
    return this.sendCommand<MotorControlCommand>('motor_control', {
      robot_id: robotId,
      speeds
    }) as Promise<CommandResponse>;
  }

  /**
   * Send a PID configuration command
   * @param {string} robotId - Robot ID
   * @param {number} motorId - Motor ID
   * @param {object} parameters - PID parameters {kp, ki, kd}
   * @returns {Promise<CommandResponse>} Resolves with response
   */
  async setPIDParameters(
    robotId: string, 
    motorId: number, 
    parameters: { kp: number; ki: number; kd: number }
  ): Promise<CommandResponse> {
    return this.sendCommand<PIDConfigCommand>('pid_config', {
      robot_id: robotId,
      motor_id: motorId,
      parameters
    }) as Promise<CommandResponse>;
  }

  /**
   * Send an emergency stop command
   * @param {string} robotId - Robot ID
   * @returns {Promise<CommandResponse>} Resolves with response
   */
  async emergencyStop(robotId: string): Promise<CommandResponse> {
    return this.sendCommand<EmergencyStopCommand>('emergency_stop', {
      robot_id: robotId
    }) as Promise<CommandResponse>;
  }

  /**
   * Send a motion command (velocities)
   * @param {string} robotId - Robot ID
   * @param {object} velocities - {x, y, theta} velocities
   * @returns {Promise<CommandResponse>} Resolves with response
   */
  async setMotion(
    robotId: string, 
    velocities: { x: number; y: number; theta: number }
  ): Promise<CommandResponse> {
    return this.sendCommand<MotionCommand>('motion_command', {
      robot_id: robotId,
      velocities
    }) as Promise<CommandResponse>;
  }
}

// Create a singleton instance
const robotControlService = new RobotControlService();

export default robotControlService;