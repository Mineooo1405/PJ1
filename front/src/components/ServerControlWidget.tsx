import React from "react";
import { Activity, Power, RefreshCw } from "lucide-react";
import { useWebSocket } from '../services/WebSocketManager';

const ServerControlWidget: React.FC = () => {
  const {
    status,
    isConnected,
    connect,
    disconnect,
    sendMessage
  } = useWebSocket('/ws/server', {
    autoConnect: false,
    onMessage: (data) => {
      console.log("Server message:", data);
    }
  });

  const sendCommand = (command: string) => {
    if (!isConnected) return;
    
    sendMessage({
      type: command,
      timestamp: Date.now()
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            status === 'connected' ? 'bg-green-500' : 
            status === 'connecting' ? 'bg-yellow-500' : 
            status === 'error' ? 'bg-red-500' : 'bg-gray-400'
          }`}></div>
          <span className="font-medium">Server Control</span>
          <span className="text-sm text-gray-500">({status})</span>
        </div>
        
        {!isConnected ? (
          <button 
            onClick={connect}
            disabled={status === 'connecting'}
            className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {status === 'connecting' ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <Power size={14} />
                <span>Connect</span>
              </>
            )}
          </button>
        ) : (
          <button 
            onClick={disconnect}
            className="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 flex items-center gap-1"
          >
            <Power size={14} />
            <span>Disconnect</span>
          </button>
        )}
      </div>
      
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Server Commands</h3>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => sendCommand('get_status')}
            disabled={!isConnected}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <Activity size={14} />
            <span>Get Status</span>
          </button>
          
          <button
            onClick={() => sendCommand('ping')}
            disabled={!isConnected}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <RefreshCw size={14} />
            <span>Ping Server</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServerControlWidget;