import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { webSocketService, WebSocketStatus } from '../services/WebSocketService';

// Định nghĩa Context API cho WebSocket
export interface WebSocketContextType {
  connect: (endpoint: string) => void;
  disconnect: (endpoint: string) => void;
  sendMessage: (endpoint: string, message: any) => boolean;
  isConnected: (endpoint: string) => boolean;
  getStatus: (endpoint: string) => string;
}

// Định nghĩa options cho useWebSocket
export interface UseWebSocketOptions {
  autoConnect?: boolean;
  autoDisconnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (data: any) => void;
}

// Tạo context với giá trị mặc định
const WebSocketContext = createContext<WebSocketContextType | null>(null);

// Provider component
export const WebSocketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Tạo bridge từ webSocketService sang context
  const contextValue: WebSocketContextType = {
    connect: (endpoint: string) => webSocketService.connect(endpoint),
    disconnect: (endpoint: string) => webSocketService.disconnect(endpoint),
    sendMessage: (endpoint: string, message: any) => webSocketService.sendMessage(endpoint, message),
    isConnected: (endpoint: string) => webSocketService.isConnected(endpoint),
    getStatus: (endpoint: string) => webSocketService.getStatus(endpoint)
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

// Custom hook để sử dụng WebSocket context
export const useWebSocketContext = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext phải được sử dụng trong WebSocketProvider');
  }
  return context;
};

// Hook tương thích với cách sử dụng cũ
export const useWebSocket = (endpoint: string, options: UseWebSocketOptions = {}) => {
  const [status, setStatus] = useState<WebSocketStatus>(webSocketService.getStatus(endpoint));
  const [isConnected, setIsConnected] = useState(webSocketService.isConnected(endpoint));
  
  useEffect(() => {
    // Theo dõi thay đổi trạng thái
    const unsubscribe = webSocketService.onStatusChange(endpoint, (newStatus) => {
      setStatus(newStatus);
      setIsConnected(newStatus === 'connected');
      
      if (newStatus === 'connected' && options.onConnect) {
        options.onConnect();
      } else if (newStatus === 'disconnected' && options.onDisconnect) {
        options.onDisconnect();
      } else if (newStatus === 'error' && options.onError) {
        options.onError(new Error(`WebSocket connection error: ${endpoint}`));
      }
    });
    
    return unsubscribe;
  }, [endpoint, options]);
  
  // Theo dõi messages
  useEffect(() => {
    if (!options.onMessage) return () => {};
    
    const unsubscribe = webSocketService.onMessage(endpoint, '*', (data) => {
      options.onMessage && options.onMessage(data);
    });
    
    return unsubscribe;
  }, [endpoint, options.onMessage]);
  
  // Auto-connect
  useEffect(() => {
    if (options.autoConnect) {
      webSocketService.connect(endpoint);
    }
    
    return () => {
      if (options.autoDisconnect) {
        webSocketService.disconnect(endpoint);
      }
    };
  }, [endpoint, options.autoConnect, options.autoDisconnect]);
  
  return {
    status,
    isConnected,
    connect: () => webSocketService.connect(endpoint),
    disconnect: () => webSocketService.disconnect(endpoint),
    sendMessage: (message: any) => webSocketService.sendMessage(endpoint, message)
  };
};