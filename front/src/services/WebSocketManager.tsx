import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BehaviorSubject } from 'rxjs';

// Type definition for WebSocketEndpoint
export type WebSocketEndpoint = string;

// Type definition for WebSocket status
export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// WebSocket options
interface UseWebSocketOptions {
  autoConnect?: boolean;
  onMessage?: (data: any) => void;
  debug?: boolean;
}

// Store for sockets
class SocketStore {
  sockets: Record<string, {
    socket: WebSocket | null,
    listeners: Set<(data: any) => void>,
    pingTimer: number | null,
    lastPongTime: number,
  }> = {};

  statuses = new Map<string, BehaviorSubject<WebSocketStatus>>();

  getSocket(endpoint: string) {
    if (!this.sockets[endpoint]) {
      this.sockets[endpoint] = {
        socket: null,
        listeners: new Set(),
        pingTimer: null,
        lastPongTime: 0
      };
    }
    return this.sockets[endpoint];
  }

  getStatus(endpoint: string) {
    if (!this.statuses.has(endpoint)) {
      this.statuses.set(endpoint, new BehaviorSubject<WebSocketStatus>('disconnected'));
    }
    return this.statuses.get(endpoint)!;
  }
}

const socketManager = new SocketStore();

// Hook for using WebSocket connection
export function useWebSocket(endpoint: WebSocketEndpoint, options: UseWebSocketOptions = {}) {
  const { 
    autoConnect = false, 
    onMessage,
    debug = false 
  } = options;
  
  const [status, setStatus] = useState<WebSocketStatus>(
    socketManager.getStatus(endpoint).value
  );
  
  const statusSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Connect to WebSocket
  const connect = useCallback(() => {
    const socketData = socketManager.getSocket(endpoint);
    const statusSubject = socketManager.getStatus(endpoint);
    
    // Already connected or connecting
    if (socketData.socket?.readyState === WebSocket.OPEN || 
        socketData.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    
    statusSubject.next('connecting');
    
    try {
      // Make sure it uses the appropriate backend endpoint format
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
      const url = `${protocol}//${host}${endpoint}`;
      
      if (debug) console.log(`[WebSocket] Connecting to ${url}`);
      
      const socket = new WebSocket(url);
      socketData.socket = socket;
      
      socket.onopen = () => {
        if (debug) console.log(`[WebSocket] Connected to ${endpoint}`);
        statusSubject.next('connected');
        setIsConnected(true);
      };
      
      socket.onclose = () => {
        if (debug) console.log(`[WebSocket] Disconnected from ${endpoint}`);
        statusSubject.next('disconnected');
        setIsConnected(false);
      };
      
      socket.onerror = (error) => {
        console.error(`[WebSocket] Error on ${endpoint}:`, error);
        statusSubject.next('error');
        setIsConnected(false);
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (debug) console.log(`[WebSocket] Received from ${endpoint}:`, data);
          
          if (onMessage) {
            onMessage(data);
          }
          
          socketData.listeners.forEach(listener => {
            try {
              listener(data);
            } catch (err) {
              console.error(`[WebSocket] Error in message listener:`, err);
            }
          });
        } catch (err) {
          console.error(`[WebSocket] Error parsing message:`, err);
        }
      };
      
      // Start ping timer
      if (socketData.pingTimer) {
        clearInterval(socketData.pingTimer);
      }
      
      socketData.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() / 1000 }));
        }
      }, 30000);
      
    } catch (err) {
      console.error(`[WebSocket] Error creating connection:`, err);
      statusSubject.next('error');
    }
  }, [endpoint, debug, onMessage]);
  
  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    const socketData = socketManager.getSocket(endpoint);
    const statusSubject = socketManager.getStatus(endpoint);
    
    if (socketData.socket) {
      socketData.socket.close();
      socketData.socket = null;
      
      if (socketData.pingTimer) {
        clearInterval(socketData.pingTimer);
        socketData.pingTimer = null;
      }
    }
    
    statusSubject.next('disconnected');
    setIsConnected(false);
  }, [endpoint]);
  
  // Send a message to the WebSocket
  const sendMessage = useCallback((message: any) => {
    const socketData = socketManager.getSocket(endpoint);
    
    if (socketData.socket?.readyState === WebSocket.OPEN) {
      socketData.socket.send(JSON.stringify(message));
      return true;
    }
    
    return false;
  }, [endpoint]);
  
  // Subscribe to status updates
  useEffect(() => {
    const statusSubject = socketManager.getStatus(endpoint);
    
    statusSubscriptionRef.current = statusSubject.subscribe(newStatus => {
      setStatus(newStatus);
      setIsConnected(newStatus === 'connected');
    });
    
    return () => {
      if (statusSubscriptionRef.current) {
        statusSubscriptionRef.current.unsubscribe();
      }
    };
  }, [endpoint]);
  
  // Auto-connect if specified
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    
    return () => {
      if (autoConnect) { // Only auto-disconnect if we auto-connected
        disconnect();
      }
    };
  }, [autoConnect, connect, disconnect]);
  
  return {
    status,
    isConnected,
    connect,
    disconnect,
    sendMessage
  };
}

export default socketManager;