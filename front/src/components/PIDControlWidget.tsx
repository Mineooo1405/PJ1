import React, { useState, useEffect } from 'react';
import { RefreshCw, Power, Save, RotateCcw } from 'lucide-react';
import tcpWebSocketService from '../services/TcpWebSocketService';

// Interface cho thông số PID
interface PIDValues {
  kp: number;
  ki: number;
  kd: number;
}

const PIDControlWidget: React.FC = () => {
  // State
  const [pidValues, setPidValues] = useState<PIDValues>({
    kp: 1.0,
    ki: 0.1,
    kd: 0.01
  });
  const [robotId, setRobotId] = useState('robot1');
  const [motorId, setMotorId] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Kết nối đến TCP WebSocket service khi component được tạo
  useEffect(() => {
    // Xử lý thay đổi trạng thái kết nối
    const handleConnectionChange = (connected: boolean) => {
      console.log('Trạng thái kết nối TCP đã thay đổi:', connected);
      setIsConnected(connected);
    };
    
    // Đăng ký lắng nghe thay đổi kết nối
    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    
    // Kết nối đến TCP server
    if (!tcpWebSocketService.isConnected()) {
      tcpWebSocketService.connect();
    }
    
    // Đăng ký nhận phản hồi
    const handlePidResponse = (response: any) => {
      console.log('Nhận phản hồi PID:', response);
      setIsSaving(false);
      
      if (response.status === 'success') {
        setSaveStatus('success');
        console.log('Cấu hình PID đã được gửi thành công đến robot');
      } else {
        setSaveStatus('error');
        console.error('Lỗi gửi cấu hình PID:', response.message);
      }
    };
    
    // Đăng ký nhận các loại phản hồi
    tcpWebSocketService.onMessage('pid_response', handlePidResponse);
    tcpWebSocketService.onMessage('error', (error: any) => {
      console.error('Lỗi từ TCP server:', error);
      setIsSaving(false);
      setSaveStatus('error');
    });
    
    // Dọn dẹp khi unmount
    return () => {
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage('pid_response', handlePidResponse);
      tcpWebSocketService.offMessage('error', (error: any) => {});
    };
  }, []);
  
  // Xử lý thay đổi đầu vào
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPidValues(prev => ({
      ...prev,
      [name]: Number(value)
    }));
  };
  
  // Yêu cầu cập nhật PID
  const handleSave = async () => {
    if (!isConnected) {
      setErrorMessage("TCP connection not available");
      return;
    }
    
    setIsSaving(true);
    
    try {
      tcpWebSocketService.sendPidConfig(
        robotId,
        motorId,
        pidValues
      );
      
      // Hiển thị thông báo thành công
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      setSaveStatus('error');
      setErrorMessage("Failed to save PID values");
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  };
  
  // Khôi phục giá trị mặc định
  const resetToDefaults = () => {
    setPidValues({
      kp: 1.0,
      ki: 0.1,
      kd: 0.01
    });
  };
  
  // Kết nối đến TCP server
  const connect = () => {
    tcpWebSocketService.connect();
    // Trạng thái kết nối sẽ được cập nhật thông qua onConnectionChange
  };
  
  // Ngắt kết nối
  const disconnect = () => {
    tcpWebSocketService.disconnect();
    // Trạng thái kết nối sẽ được cập nhật thông qua onConnectionChange
  };
  
  // Render UI
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-gray-400'
          }`}></div>
          <span className="font-medium">Cấu hình PID</span>
          <span className="text-sm text-gray-500">({isConnected ? 'đã kết nối' : 'chưa kết nối'})</span>
        </div>
        
        {!isConnected ? (
          <button 
            onClick={connect}
            className="px-3 py-1 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 flex items-center gap-1"
          >
            <Power size={14} />
            <span>Kết nối</span>
          </button>
        ) : (
          <button 
            onClick={disconnect}
            className="px-3 py-1 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 flex items-center gap-1"
          >
            <Power size={14} />
            <span>Ngắt kết nối</span>
          </button>
        )}
      </div>
      
      {/* Chọn Robot và Motor */}
      <div className="grid grid-cols-2 gap-4 mb-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Robot</label>
          <select
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md"
          >
            <option value="robot1">Robot 1</option>
            <option value="robot2">Robot 2</option>
            <option value="robot3">Robot 3</option>
            <option value="robot4">Robot 4</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Motor</label>
          <select
            value={motorId}
            onChange={(e) => setMotorId(parseInt(e.target.value))}
            className="w-full p-2 border border-gray-300 rounded-md"
          >
            <option value={1}>Motor 1</option>
            <option value={2}>Motor 2</option>
            <option value={3}>Motor 3</option>
          </select>
        </div>
      </div>
      
      {/* Slider và Input cho các thông số PID */}
      <div className="space-y-4">
        <div>
          <label className="flex justify-between">
            <span className="text-sm font-medium text-gray-700">Kp (Tỉ lệ)</span>
            <span className="text-sm text-gray-500">{pidValues.kp.toFixed(2)}</span>
          </label>
          <input
            type="range"
            name="kp"
            min="0"
            max="10"
            step="0.1"
            value={pidValues.kp}
            onChange={handleChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <input 
            type="number"
            name="kp"
            min="0"
            max="10"
            step="0.1"
            value={pidValues.kp}
            onChange={handleChange}
            className="mt-1 w-full p-1 text-sm border border-gray-300 rounded-md"
          />
        </div>
        
        <div>
          <label className="flex justify-between">
            <span className="text-sm font-medium text-gray-700">Ki (Tích phân)</span>
            <span className="text-sm text-gray-500">{pidValues.ki.toFixed(2)}</span>
          </label>
          <input
            type="range"
            name="ki"
            min="0"
            max="5"
            step="0.01"
            value={pidValues.ki}
            onChange={handleChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <input 
            type="number"
            name="ki"
            min="0"
            max="5"
            step="0.01"
            value={pidValues.ki}
            onChange={handleChange}
            className="mt-1 w-full p-1 text-sm border border-gray-300 rounded-md"
          />
        </div>
        
        <div>
          <label className="flex justify-between">
            <span className="text-sm font-medium text-gray-700">Kd (Đạo hàm)</span>
            <span className="text-sm text-gray-500">{pidValues.kd.toFixed(3)}</span>
          </label>
          <input
            type="range"
            name="kd"
            min="0"
            max="1"
            step="0.001"
            value={pidValues.kd}
            onChange={handleChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <input 
            type="number"
            name="kd"
            min="0"
            max="1"
            step="0.001"
            value={pidValues.kd}
            onChange={handleChange}
            className="mt-1 w-full p-1 text-sm border border-gray-300 rounded-md"
          />
        </div>
      </div>
      
      {/* Nút lưu và reset */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={!isConnected || isSaving}
          className="flex-1 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              <span>Đang lưu...</span>
            </>
          ) : (
            <>
              <Save size={14} />
              <span>Lưu cấu hình</span>
            </>
          )}
        </button>
        
        <button
          onClick={resetToDefaults}
          className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-md flex items-center justify-center"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      
      {/* Thông báo trạng thái */}
      {saveStatus === 'success' && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-3 py-2 rounded text-sm flex items-center gap-1">
          Cấu hình PID đã được gửi thành công đến TCP server!
        </div>
      )}
      
      {saveStatus === 'error' && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm flex items-center gap-1">
          Không thể gửi cấu hình PID đến TCP server. Vui lòng thử lại.
        </div>
      )}
    </div>
  );
};

export default PIDControlWidget;