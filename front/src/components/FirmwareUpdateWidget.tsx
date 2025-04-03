import React, { useState, useRef, useEffect } from "react";
import { Upload, AlertCircle, Check, RefreshCw, Wifi, Network } from "lucide-react";
import tcpWebSocketService from '../services/TcpWebSocketService';
import { useRobotContext } from './RobotContext';

// Cập nhật interface cho robot
interface Robot {
  robot_id: string;
  ip: string;
  active?: boolean; // Thêm thuộc tính active (dùng ? để đánh dấu là tùy chọn)
  port?: number;     // Thêm port nếu API của bạn cũng trả về thông tin này
}

const FirmwareUpdateWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentVersion, setCurrentVersion] = useState('1.0.0');
  const [isConnected, setIsConnected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [useIpAddress, setUseIpAddress] = useState(false);
  const [ipAddress, setIpAddress] = useState("");
  const [availableRobots, setAvailableRobots] = useState<Robot[]>([]);

  useEffect(() => {
    if (selectedRobotId) {
      tcpWebSocketService.setRobotId(selectedRobotId);
    }
  }, [selectedRobotId]);

  useEffect(() => {
    const loadRobotAddresses = async () => {
      try {
        const response = await fetch('http://localhost:9004/connections');
        if (response.ok) {
          const data = await response.json();
          if (data.connections && Array.isArray(data.connections)) {
            setAvailableRobots(data.connections);

            const selectedRobot = data.connections.find(
              (r: Robot) => r.robot_id === selectedRobotId
            );
            if (selectedRobot) {
              setIpAddress(selectedRobot.ip);
            }
          }
        }
      } catch (error) {
        console.error("Error loading robot addresses:", error);
      }
    };

    loadRobotAddresses();
    const intervalId = setInterval(loadRobotAddresses, 10000);
    return () => clearInterval(intervalId);
  }, [selectedRobotId]);

  useEffect(() => {
    if (!tcpWebSocketService.isConnected()) {
      tcpWebSocketService.connect();
    }

    const intervalId = setInterval(() => {
      if (!isConnected) {
        console.log("Đang thử kết nối lại tới DirectBridge...");
        tcpWebSocketService.connect();
      }
    }, 10000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected]);

  useEffect(() => {
    const handleConnectionChange = (connected: boolean) => {
      console.log("DirectBridge connection state changed:", connected);
      setIsConnected(connected);
    };

    const handleFirmwareResponse = (message: any) => {
      console.log("Received firmware response:", message);

      if (message.type === "firmware_response") {
        if (message.status === "success") {
          setUploadStatus('success');
          setTimeout(() => setUploadStatus('idle'), 3000);
        } else if (message.status === "error") {
          setErrorMessage(message.message || "Lỗi không xác định");
          setUploadStatus('error');
          setTimeout(() => setUploadStatus('idle'), 5000);
        }
      } else if (message.type === "firmware_progress") {
        setProgress(message.progress || 0);
      } else if (message.type === "firmware_version") {
        setCurrentVersion(message.version || "Unknown");
      }
    };

    const handleErrorResponse = (message: any) => {
      setErrorMessage(message.message || "Lỗi không xác định");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
    };

    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    tcpWebSocketService.onMessage('firmware_response', handleFirmwareResponse);
    tcpWebSocketService.onMessage('firmware_progress', handleFirmwareResponse);
    tcpWebSocketService.onMessage('firmware_version', handleFirmwareResponse);
    tcpWebSocketService.onMessage('error', handleErrorResponse);

    setIsConnected(tcpWebSocketService.isConnected());

    return () => {
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage('firmware_response', handleFirmwareResponse);
      tcpWebSocketService.offMessage('firmware_progress', handleFirmwareResponse);
      tcpWebSocketService.offMessage('firmware_version', handleFirmwareResponse);
      tcpWebSocketService.offMessage('error', handleErrorResponse);
    };
  }, []);

  const sendFirmware = async () => {
    if (!selectedFile || !isConnected) {
      setErrorMessage("Chưa chọn file hoặc chưa kết nối tới DirectBridge");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
      return;
    }

    if (useIpAddress && !ipAddress) {
      setErrorMessage("Vui lòng nhập địa chỉ IP của robot");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
      return;
    }

    try {
      setUploadStatus('uploading');
      setProgress(0);

      const messageStart = {
        type: "firmware_update_start",
        robot_id: selectedRobotId,
        filename: selectedFile.name,
        filesize: selectedFile.size,
        version: "1.0.1"
      };

      if (useIpAddress && ipAddress) {
        (messageStart as any).target_ip = ipAddress;
      }

      const success = tcpWebSocketService.sendMessage(messageStart);

      if (!success) {
        throw new Error("Không thể khởi tạo quá trình cập nhật firmware");
      }

      const reader = new FileReader();
      reader.readAsArrayBuffer(selectedFile);

      reader.onload = async (event) => {
        if (!event.target || !event.target.result) {
          throw new Error("Không thể đọc file");
        }

        const arrayBuffer = event.target.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);

        const chunkSize = 1024;
        const totalChunks = Math.ceil(bytes.length / chunkSize);

        console.log(`Gửi firmware trong ${totalChunks} chunks, mỗi chunk ${chunkSize} bytes`);

        const sendChunkWithDelay = (chunkIndex: number): Promise<void> => {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (chunkIndex >= totalChunks) {
                resolve();
                return;
              }

              try {
                const start = chunkIndex * chunkSize;
                const end = Math.min(bytes.length, start + chunkSize);
                const chunk = bytes.slice(start, end);

                const base64Chunk = btoa(
                  Array.from(chunk)
                    .map(byte => String.fromCharCode(byte))
                    .join('')
                );

                const chunkMessage: any = {
                  type: "firmware_chunk",
                  robot_id: selectedRobotId,
                  chunk_index: chunkIndex,
                  total_chunks: totalChunks,
                  data: base64Chunk
                };

                if (useIpAddress && ipAddress) {
                  chunkMessage.target_ip = ipAddress;
                }

                const success = tcpWebSocketService.sendMessage(chunkMessage);

                if (!success) {
                  reject(new Error(`Không thể gửi chunk ${chunkIndex}`));
                  return;
                }

                const currentProgress = Math.round((chunkIndex + 1) / totalChunks * 100);
                setProgress(currentProgress);

                sendChunkWithDelay(chunkIndex + 1).then(resolve).catch(reject);

              } catch (error) {
                reject(error);
              }
            }, 100);
          });
        };

        await sendChunkWithDelay(0);

        const completeMessage: any = {
          type: "firmware_update_complete",
          robot_id: selectedRobotId
        };

        if (useIpAddress && ipAddress) {
          completeMessage.target_ip = ipAddress;
        }

        tcpWebSocketService.sendMessage(completeMessage);
      };

      reader.onerror = () => {
        throw new Error("Lỗi khi đọc file");
      };

    } catch (error) {
      console.error("Lỗi khi gửi firmware:", error);
      setUploadStatus('error');
      setErrorMessage(error instanceof Error ? error.message : "Lỗi không xác định");
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
    if (!isConnected) {
      tcpWebSocketService.connect();
      return;
    }

    const versionMessage: any = {
      type: "check_firmware_version",
      robot_id: selectedRobotId
    };

    if (useIpAddress && ipAddress) {
      versionMessage.target_ip = ipAddress;
    }

    tcpWebSocketService.sendMessage(versionMessage);
  };

  const selectRobotAddress = (robotId: string, ip: string) => {
    setIpAddress(ip);
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
          disabled={!isConnected}
        >
          <RefreshCw size={16} className={!isConnected ? "opacity-50" : ""} />
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between bg-gray-50 p-3 rounded-md">
        <div className="flex items-center">
          <div className={`w-3 h-3 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span>{isConnected ? 'Đã kết nối tới DirectBridge' : 'Chưa kết nối'}</span>
        </div>

        {!isConnected && (
          <button
            onClick={() => tcpWebSocketService.connect()}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Kết nối
          </button>
        )}
      </div>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={useIpAddress}
            onChange={() => setUseIpAddress(!useIpAddress)}
            className="mr-2"
          />
          <span className="font-medium flex items-center">
            <Wifi size={16} className="mr-1" /> Gửi firmware qua IP
          </span>
        </label>

        {useIpAddress && (
          <div className="mt-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Địa chỉ IP
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                placeholder="192.168.1.100"
                className="flex-grow p-2 border border-gray-300 rounded-md"
              />
              <button
                onClick={() => setIpAddress("")}
                className="p-2 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200"
                title="Xóa"
              >
                ×
              </button>
            </div>

            {availableRobots.length > 0 && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chọn từ danh sách robot
                </label>
                <div className="max-h-32 overflow-y-auto border rounded-md divide-y">
                  {availableRobots.map((robot, index) => (
                    <div
                      key={index}
                      className="p-2 flex justify-between items-center hover:bg-gray-50 cursor-pointer"
                      onClick={() => selectRobotAddress(robot.robot_id, robot.ip)}
                    >
                      <div>
                        <div className="font-medium">{robot.robot_id}</div>
                        <div className="text-xs text-gray-500 flex items-center">
                          <Network size={12} className="mr-1" />
                          {robot.ip}
                        </div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${robot.active ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
          disabled={!selectedFile || !isConnected || uploadStatus === 'uploading' || (useIpAddress && !ipAddress)}
          className={`px-4 py-2 rounded-md flex items-center gap-2
            ${!selectedFile || !isConnected || uploadStatus === 'uploading' || (useIpAddress && !ipAddress)
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          {uploadStatus === 'uploading' ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              <span>Đang tải lên... {progress}%</span>
            </>
          ) : (
            <>
              <Upload size={16} />
              <span>{useIpAddress ? 'Cập nhật firmware qua IP' : 'Cập nhật firmware'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default FirmwareUpdateWidget;