import { useState, useEffect, useCallback } from 'react';
import webSocketService, { WebSocketStatus } from '../services/UnifiedWebSocketService';
import { WS_CONFIG } from '../services/WebSocketConfig';

interface UseUnifiedWebSocketOptions {
  autoConnect?: boolean;
  onMessage?: (data: any) => void;
  messageTypes?: string[];
  connectionType?: 'backend' | 'bridge';
}

export function useUnifiedWebSocket(
  endpoint: string, 
  options: UseUnifiedWebSocketOptions = {}
) {
  const {
    autoConnect = false,
    onMessage,
    messageTypes = ['*'],
    connectionType = 'bridge'
  } = options;
  
  const [status, setStatus] = useState<WebSocketStatus>(
    webSocketService.getStatus(endpoint)
  );
  
  const connect = useCallback(() => {
    return webSocketService.connect(endpoint, connectionType)
      .catch(err => {
        console.error('Failed to connect:', err);
        throw err;
      });
  }, [endpoint, connectionType]);
  
  const disconnect = useCallback(() => {
    webSocketService.disconnect(endpoint);
  }, [endpoint]);
  
  const sendMessage = useCallback((message: any) => {
    return webSocketService.sendMessage(endpoint, message);
  }, [endpoint]);
  
  // Register message listener
  useEffect(() => {
    if (!onMessage) return;
    
    // Register for all specified message types
    messageTypes.forEach(type => {
      webSocketService.onMessage(endpoint, type, onMessage);
    });
    
    // Clean up on unmount
    return () => {
      messageTypes.forEach(type => {
        webSocketService.offMessage(endpoint, type, onMessage);
      });
    };
  }, [endpoint, onMessage, messageTypes]);
  
  // Status subscription
  useEffect(() => {
    const unsubscribe = webSocketService.onStatusChange(endpoint, setStatus);
    return unsubscribe;
  }, [endpoint]);
  
  // Auto-connect if enabled
  useEffect(() => {
    if (autoConnect) {
      connect().catch(console.error);
    }
    
    // Clean up on unmount
    return () => {
      // Only disconnect if we auto-connected
      if (autoConnect) {
        disconnect();
      }
    };
  }, [autoConnect, connect, disconnect]);
  
  return {
    status,
    isConnected: status === 'connected',
    connect,
    disconnect,
    sendMessage
  };
}

// Robot-specific hook for easier use with robot endpoints
export function useRobotWebSocket(
  robotId: string,
  options: Omit<UseUnifiedWebSocketOptions, 'connectionType'> = {}
) {
  const endpoint = WS_CONFIG.PATHS.ROBOT(robotId);
  
  // Always use 'bridge' connection type for robots
  return useUnifiedWebSocket(endpoint, {
    ...options,
    connectionType: 'bridge'
  });
}