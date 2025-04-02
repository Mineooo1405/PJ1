import React from 'react';
import { Power, RefreshCw } from 'lucide-react';
import { WebSocketStatus } from '../services/WebSocketManager';

interface WidgetConnectionHeaderProps {
  title: string;
  status: WebSocketStatus;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const WidgetConnectionHeader: React.FC<WidgetConnectionHeaderProps> = ({ 
  title, 
  status, 
  isConnected, 
  onConnect, 
  onDisconnect 
}) => {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${
          status === 'connected' ? 'bg-green-500' : 
          status === 'connecting' ? 'bg-yellow-500' : 
          status === 'error' ? 'bg-red-500' : 'bg-gray-400'
        }`}></div>
        <span className="font-medium">{title}</span>
        <span className="text-xs text-gray-500">({status})</span>
      </div>
      
      {!isConnected ? (
        <button 
          onClick={onConnect}
          disabled={status === 'connecting'}
          className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {status === 'connecting' ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              <span>Đang kết nối...</span>
            </>
          ) : (
            <>
              <Power size={14} />
              <span>Kết nối</span>
            </>
          )}
        </button>
      ) : (
        <button 
          onClick={onDisconnect}
          className="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 flex items-center gap-1"
        >
          <Power size={14} />
          <span>Ngắt kết nối</span>
        </button>
      )}
    </div>
  );
};

export default WidgetConnectionHeader;