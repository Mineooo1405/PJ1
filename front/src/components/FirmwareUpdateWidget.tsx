import React, { useState, useRef, useEffect } from "react";
import { Upload, AlertCircle, Check, RefreshCw } from "lucide-react";
import tcpWebSocketService from '../services/TcpWebSocketService';
import { useRobotContext } from './RobotContext';

const FirmwareUpdateWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentVersion, setCurrentVersion] = useState('1.0.0');
  const [isConnected, setIsConnected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleConnectionChange = (connected: boolean) => {
      setIsConnected(connected);
    };
    
    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    
    const handleMessage = (message: any) => {
      if (message.type === "firmware_response") {
        if (message.status === "success") {
          setUploadStatus('success');
          setTimeout(() => setUploadStatus('idle'), 3000);
        } else if (message.status === "error") {
          setErrorMessage(message.message || "Unknown error");
          setUploadStatus('error');
          setTimeout(() => setUploadStatus('idle'), 5000);
        }
      } else if (message.type === "progress") {
        setProgress(message.value);
      }
    };
    
    tcpWebSocketService.onMessage("firmware_response", handleMessage);
    tcpWebSocketService.onMessage("progress", handleMessage);
    
    return () => {
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage("firmware_response", handleMessage);
      tcpWebSocketService.offMessage("progress", handleMessage);
    };
  }, []);

  const sendFirmware = async () => {
    if (!selectedFile || !isConnected) {
      setErrorMessage("No file selected or not connected");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
      return;
    }
    
    try {
      setUploadStatus('uploading');
      setProgress(0);
      
      tcpWebSocketService.sendMessage({
        type: "firmware_update",
        robot_id: selectedRobotId,
        filename: selectedFile.name,
        filesize: selectedFile.size,
        version: "1.0.1",
        frontend: true,
        timestamp: Date.now() / 1000
      });
      
      const reader = new FileReader();
      reader.readAsArrayBuffer(selectedFile);
      
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        
        const chunkSize = 1024 * 64;
        const totalChunks = Math.ceil(bytes.length / chunkSize);
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(bytes.length, start + chunkSize);
          const chunk = bytes.slice(start, end);
          
          const base64Chunk = btoa(
            Array.from(chunk)
              .map(byte => String.fromCharCode(byte))
              .join('')
          );
          
          tcpWebSocketService.sendMessage({
            type: "firmware_chunk",
            robot_id: selectedRobotId,
            chunk_index: i,
            total_chunks: totalChunks,
            data: base64Chunk,
            frontend: true,
            timestamp: Date.now() / 1000
          });
          
          const currentProgress = Math.round((i + 1) / totalChunks * 100);
          if (currentProgress > progress) {
            setProgress(currentProgress);
          }
        }
        
        tcpWebSocketService.sendMessage({
          type: "firmware_complete",
          robot_id: selectedRobotId,
          frontend: true,
          timestamp: Date.now() / 1000
        });
      };
      
    } catch (error) {
      console.error("Failed to send firmware:", error);
      setUploadStatus('error');
      setErrorMessage("Failed to send firmware");
      setTimeout(() => setUploadStatus('idle'), 5000);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    
    if (file) {
      setProgress(0);
      setUploadStatus('idle');
      setErrorMessage('');
    }
  };

  const checkCurrentVersion = () => {
    tcpWebSocketService.sendMessage({
      type: "check_firmware_version",
      robot_id: selectedRobotId,
      frontend: true,
      timestamp: Date.now() / 1000
    });
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow border">
      <h3 className="text-lg font-medium mb-4">Cập Nhật Firmware</h3>
      
      <div className="mb-4 flex items-center bg-blue-50 p-3 rounded-md text-blue-700">
        <AlertCircle size={20} className="mr-2" />
        <div>
          <p className="font-medium">Robot: {selectedRobotId}</p>
          <p className="text-sm">Phiên bản hiện tại: {currentVersion}</p>
        </div>
        <button 
          onClick={checkCurrentVersion} 
          className="ml-auto p-1 hover:bg-blue-100 rounded-full"
          title="Kiểm tra phiên bản"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Chọn file firmware (.bin)
        </label>
        <div className="flex items-center">
          <input
            type="file"
            accept=".bin"
            onChange={handleFileChange}
            className="hidden"
            id="firmware-file"
            ref={fileInputRef}
          />
          <label
            htmlFor="firmware-file"
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-l-md hover:bg-gray-200 cursor-pointer"
          >
            Chọn file
          </label>
          <div className="flex-grow px-3 py-2 bg-gray-50 rounded-r-md border-l truncate">
            {selectedFile ? selectedFile.name : 'Chưa có file nào được chọn'}
          </div>
        </div>
      </div>
      
      {uploadStatus === 'uploading' && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Đang tải lên...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full" 
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      
      {uploadStatus === 'error' && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-500 text-red-700 p-3 rounded">
          <p className="font-medium">Lỗi</p>
          <p>{errorMessage}</p>
        </div>
      )}
      
      {uploadStatus === 'success' && (
        <div className="mb-4 bg-green-50 border-l-4 border-green-500 text-green-700 p-3 rounded flex items-center">
          <Check size={16} className="mr-2" />
          <p>Firmware đã được cập nhật thành công!</p>
        </div>
      )}
      
      <div className="flex justify-end mt-2">
        <button
          onClick={sendFirmware}
          disabled={!selectedFile || uploadStatus === 'uploading'}
          className={`px-4 py-2 rounded-md flex items-center gap-2
            ${!selectedFile || uploadStatus === 'uploading' 
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          {uploadStatus === 'uploading' ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              <span>Đang tải lên...</span>
            </>
          ) : (
            <>
              <Upload size={16} />
              <span>Cập nhật firmware</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default FirmwareUpdateWidget;