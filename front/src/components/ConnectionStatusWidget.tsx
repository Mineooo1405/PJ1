import React, { useState, useEffect } from 'react';
import { useWebSocket, WebSocketEndpoint } from '../services/WebSocketManager';
import tcpWebSocketService from '../services/TcpWebSocketService';

// Danh sách các endpoint được hỗ trợ
const backendEndpoints: WebSocketEndpoint[] = [
  '/ws/robot1',
  '/ws/robot2',
  '/ws/robot3',
  '/ws/robot4',
  '/ws/server'
];

// Danh sách robot ID
const robotIds = ['robot1', 'robot2', 'robot3', 'robot4'];

interface TcpRobotStatus {
  robotId: string;
  connected: boolean;
  lastSeen?: string;
}

const ConnectionStatusWidget: React.FC = () => {
  const [tcpRobotStatus, setTcpRobotStatus] = useState<Record<string, TcpRobotStatus>>({
    robot1: { robotId: 'robot1', connected: false },
    robot2: { robotId: 'robot2', connected: false },
    robot3: { robotId: 'robot3', connected: false },
    robot4: { robotId: 'robot4', connected: false }
  });
  
  const [tcpBridgeConnected, setTcpBridgeConnected] = useState(false);

  // Kết nối đến TCP Bridge và lắng nghe cập nhật trạng thái robot
  useEffect(() => {
    // Kết nối đến TCP WebSocket Bridge
    try {
      tcpWebSocketService.connect();
      console.log('Đã kết nối đến TCP WebSocket Bridge');
      setTcpBridgeConnected(true);
      
      // Yêu cầu cập nhật trạng thái robot ngay lập tức
      tcpWebSocketService.sendMessage({
        type: "get_robot_connections",
        timestamp: Date.now() / 1000
      });
    } catch (err) {
      console.error('Lỗi kết nối đến TCP WebSocket Bridge:', err);
      setTcpBridgeConnected(false);
    }
    
    // Xử lý phản hồi từ data_ack khi không có thông tin trạng thái
    const handleDataAck = (data: any) => {
      if (data.type === 'data_ack' && data.message_type === 'get_robot_connections') {
        // Trích xuất robot_id từ yêu cầu gốc
        const robotId = data.robot_id || 'robot1';
        
        // Giả sử robot đã kết nối nếu có data_ack từ TCP server
        // Đây là xử lý tạm thời cho đến khi TCP server cung cấp thông tin đầy đủ
        const newStatus = { ...tcpRobotStatus };
        newStatus[robotId] = {
          robotId: robotId,
          connected: true, // Giả định là đã kết nối
          lastSeen: new Date().toLocaleTimeString()
        };
        setTcpRobotStatus(newStatus);
      }
    };
    
    // Đăng ký lắng nghe cập nhật trạng thái robot
    const handleRobotStatusUpdate = (data: any) => {
      if (data.type === 'robot_status_update' && data.robot_connections) {
        console.log('Nhận cập nhật trạng thái robot:', data);
        
        const newStatus = { ...tcpRobotStatus };
        Object.keys(data.robot_connections).forEach(robotId => {
          newStatus[robotId] = {
            robotId,
            connected: data.robot_connections[robotId],
            lastSeen: new Date().toLocaleTimeString()
          };
        });
        setTcpRobotStatus(newStatus);
      }
    };
    
    tcpWebSocketService.onMessage('robot_status_update', handleRobotStatusUpdate);
    tcpWebSocketService.onMessage('data_ack', handleDataAck);
    
    // Cập nhật trạng thái kết nối của TCP bridge
    const handleConnectionChange = () => {
      setTcpBridgeConnected(tcpWebSocketService.isConnected());
    };
    
    // Xử lý khi kết nối bị đóng
    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    
    // Truy vấn trạng thái robot định kỳ
    const interval = setInterval(() => {
      if (tcpWebSocketService.isConnected()) {
        tcpWebSocketService.sendMessage({
          type: "get_robot_connections",
          timestamp: Date.now() / 1000
        });
      }
    }, 5000);
    
    // Debug handler để xem tất cả các thông điệp từ TCP server
    const debugHandler = (data: any) => {
      console.log("DEBUG TCP MESSAGE:", data);
      
      // Nếu nhận data_ack cho get_robot_connections, lấy thông tin kết nối từ tcp server
      if (data.type === 'data_ack' && data.message_type === 'get_robot_connections') {
        // Gửi lại lệnh để lấy danh sách robot thực tế
        tcpWebSocketService.sendMessage({
          type: "get_robot_list",
          timestamp: Date.now() / 1000
        });
      }
    };
    
    // Xử lý danh sách robot thực tế
    const handleRobotList = (data: any) => {
      if (data.type === 'robot_list' && data.robots) {
        console.log("Nhận danh sách robot:", data.robots);
        
        const newStatus = { ...tcpRobotStatus };
        // Cập nhật trạng thái cho các robot có trong danh sách
        for (const robotInfo of data.robots) {
          if (robotInfo.id && robotIds.includes(robotInfo.id)) {
            newStatus[robotInfo.id] = {
              robotId: robotInfo.id,
              connected: robotInfo.connected,
              lastSeen: robotInfo.last_seen || new Date().toLocaleTimeString()
            };
          }
        }
        setTcpRobotStatus(newStatus);
      }
    };
    
    // Đăng ký các handler
    tcpWebSocketService.onMessage('*', debugHandler);
    tcpWebSocketService.onMessage('robot_list', handleRobotList);
    
    // Dọn dẹp khi unmount
    return () => {
      clearInterval(interval);
      tcpWebSocketService.offMessage('robot_status_update', handleRobotStatusUpdate);
      tcpWebSocketService.offMessage('data_ack', handleDataAck);
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage('*', debugHandler);
      tcpWebSocketService.offMessage('robot_list', handleRobotList);
    };
  }, []);

  return (
    <div className="bg-gray-900 p-2 rounded-md">
      <h3 className="text-xs font-bold mb-2 text-white">Connection Status</h3>
      
      {/* TCP Bridge Status */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs py-1 border-b border-gray-700">
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full ${tcpBridgeConnected ? 'bg-green-500' : 'bg-red-500'} mr-2`} />
            <span className="text-gray-300">TCP Bridge</span>
          </div>
          <span className="text-gray-400 text-xs">
            {tcpBridgeConnected ? 'connected' : 'disconnected'}
          </span>
        </div>
      </div>
      
      {/* Backend Connections */}
      <div className="mb-3">
        <h4 className="text-xs text-gray-400 mb-1 border-b border-gray-700 pb-1">Backend WebSockets</h4>
        <div className="space-y-1">
          {backendEndpoints.map(endpoint => {
            // Đổi tên hiển thị của các endpoint robot
            const displayName = endpoint.includes('robot') 
              ? `backendConnection${endpoint.replace('/ws/robot', '').replace('/ws/', '')}`
              : endpoint.replace('/ws/', '');
            
            return (
              <BackendConnectionStatus 
                key={endpoint} 
                endpoint={endpoint} 
                displayName={displayName}
              />
            );
          })}
        </div>
      </div>
      
      {/* TCP Server Connections */}
      <div>
        <h4 className="text-xs text-gray-400 mb-1 border-b border-gray-700 pb-1">TCP Server Connections</h4>
        <div className="space-y-1">
          {robotIds.map(robotId => (
            <TcpConnectionStatus 
              key={robotId} 
              status={tcpRobotStatus[robotId]} 
              tcpBridgeConnected={tcpBridgeConnected}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface BackendConnectionStatusProps {
  endpoint: WebSocketEndpoint;
  displayName: string;
}

const BackendConnectionStatus: React.FC<BackendConnectionStatusProps> = ({ endpoint, displayName }) => {
  const { status, isConnected, connect, disconnect } = useWebSocket(endpoint, {
    autoConnect: false,
    onMessage: () => {}
  });
  
  const statusColor = 
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-yellow-500' :
    status === 'error' ? 'bg-red-500' :
    'bg-gray-500';
  
  return (
    <div className="flex items-center justify-between text-xs py-1 border-t border-gray-700">
      <div className="flex items-center">
        <div className={`w-2 h-2 rounded-full ${statusColor} mr-2`} />
        <span className="text-gray-300">{displayName}</span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-xs">{status}</span>
        
        {!isConnected ? (
          <button
            onClick={connect}
            disabled={status === 'connecting'}
            className="px-1.5 py-0.5 rounded text-[10px] bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-600"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="px-1.5 py-0.5 rounded text-[10px] bg-red-600 hover:bg-red-700 text-white"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
};

interface TcpConnectionStatusProps {
  status: TcpRobotStatus;
  tcpBridgeConnected: boolean;
}

const TcpConnectionStatus: React.FC<TcpConnectionStatusProps> = ({ status, tcpBridgeConnected }) => {
  const statusColor = status.connected ? 'bg-green-500' : 'bg-red-500';
  const statusText = status.connected ? 'connected' : 'disconnected';
  
  return (
    <div className="flex items-center justify-between text-xs py-1 border-t border-gray-700">
      <div className="flex items-center">
        <div className={`w-2 h-2 rounded-full ${statusColor} mr-2`} />
        <span className="text-gray-300">{status.robotId}</span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-xs">{statusText}</span>
        {status.connected && (
          <span className="text-gray-500 text-[10px]">
            {status.lastSeen || ''}
          </span>
        )}
      </div>
    </div>
  );
};

export default ConnectionStatusWidget;