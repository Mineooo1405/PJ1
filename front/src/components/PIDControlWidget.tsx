import React, { useState, useEffect } from 'react';
import { RefreshCw, Power, Save, RotateCcw } from 'lucide-react';
import tcpWebSocketService from '../services/TcpWebSocketService';
import { useRobotContext } from './RobotContext';

// Interface cho thông số PID
interface PIDValues {
  kp: number;
  ki: number;
  kd: number;
}

const PIDControlWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  
  // State
  const [pidValues, setPidValues] = useState<PIDValues>({
    kp: 1.0,
    ki: 0.1,
    kd: 0.01
  });
  const [motorId, setMotorId] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Cập nhật robotId khi selectedRobotId thay đổi
  useEffect(() => {
    if (selectedRobotId) {
      tcpWebSocketService.setRobotId(selectedRobotId);
    }
  }, [selectedRobotId]);
  
  // Kết nối đến DirectBridge WebSocket service
  useEffect(() => {
    // Xử lý thay đổi trạng thái kết nối
    const handleConnectionChange = (connected: boolean) => {
      console.log('Trạng thái kết nối DirectBridge đã thay đổi:', connected);
      setIsConnected(connected);
    };
    
    // Xử lý phản hồi PID
    const handlePidResponse = (response: any) => {
      console.log('Nhận phản hồi PID:', response);
      setIsSaving(false);
      
      if (response.status === 'success') {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        setErrorMessage(response.message || 'Unknown error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    };
    
    // Đăng ký lắng nghe sự kiện
    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    tcpWebSocketService.onMessage('pid_response', handlePidResponse);
    tcpWebSocketService.onMessage('error', (error: any) => {
      console.error('Lỗi từ server:', error);
      setIsSaving(false);
      setSaveStatus('error');
      setErrorMessage(error.message || 'Unknown error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    });
    
    // Kiểm tra trạng thái kết nối hiện tại
    setIsConnected(tcpWebSocketService.isConnected());
    
    // Dọn dẹp khi unmount
    return () => {
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage('pid_response', handlePidResponse);
      tcpWebSocketService.offMessage('error', () => {});
    };
  }, []);
  
  // Tự động kết nối khi component mount
  useEffect(() => {
    // Cố gắng kết nối ngay khi component được tạo
    if (!tcpWebSocketService.isConnected()) {
      tcpWebSocketService.connect();
    }
  }, []);
  
  // Xử lý thay đổi đầu vào
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPidValues(prev => ({
      ...prev,
      [name]: Number(value)
    }));
  };
  
  // Lưu và gửi cấu hình PID
  const handleSave = async () => {
    if (!isConnected) {
      // Thử kết nối lại
      tcpWebSocketService.connect();
      setErrorMessage("Đang kết nối tới DirectBridge...");
      setSaveStatus('error');
      
      // Đợi 2 giây rồi kiểm tra kết nối
      setTimeout(() => {
        if (tcpWebSocketService.isConnected()) {
          // Nếu kết nối thành công, thử gửi lại
          handleSave();
        } else {
          setErrorMessage("Không thể kết nối tới DirectBridge. Vui lòng thử lại.");
          setTimeout(() => setSaveStatus('idle'), 3000);
        }
      }, 2000);
      return;
    }
    
    setIsSaving(true);
    setSaveStatus('idle');
    setErrorMessage(null);
    
    try {
      // Gửi cấu hình PID
      const success = tcpWebSocketService.sendPidConfig(
        selectedRobotId,
        motorId,
        pidValues
      );
      
      if (!success) {
        throw new Error("Không thể gửi thông số PID");
      }
      
      // Đặt timeout để tự động hiển thị thành công nếu không nhận được phản hồi
      setTimeout(() => {
        if (isSaving) {
          setIsSaving(false);
          setSaveStatus('success');
          setTimeout(() => setSaveStatus('idle'), 3000);
        }
      }, 5000);
      
    } catch (error) {
      setSaveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : "Lỗi không xác định");
      setIsSaving(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };
  
  // Khôi phục giá trị mặc định
  const resetToDefaults = () => {
    setPidValues({
      kp: 1.0,
      ki: 0.1,
      kd: 0.01
    });
    setSaveStatus('idle');
    setErrorMessage(null);
  };
  
  // Kết nối đến DirectBridge
  const connect = () => {
    tcpWebSocketService.connect();
  };
  
  // Ngắt kết nối
  const disconnect = () => {
    tcpWebSocketService.disconnect();
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
      
      {/* Motor Selection */}
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
          Cấu hình PID đã được gửi thành công!
        </div>
      )}
      
      {saveStatus === 'error' && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm flex items-center gap-1">
          {errorMessage || "Không thể gửi cấu hình PID. Vui lòng thử lại."}
        </div>
      )}
    </div>
  );
};

export default PIDControlWidget;