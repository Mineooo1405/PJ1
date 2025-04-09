import React, { useState, useRef, useEffect, useContext } from "react";
import { Upload, AlertCircle, Check, RefreshCw, Wifi, Network, Plug, Power, Zap } from "lucide-react";
import tcpWebSocketService from '../services/TcpWebSocketService';
import { useRobotContext } from './RobotContext';
import { GlobalAppContext } from '../contexts/GlobalAppContext'; // Thêm context mới

// Cập nhật interface cho robot
interface Robot {
  robot_id: string;
  ip: string;
  active?: boolean;
  port?: number;
}

interface FirmwareMessage {
  type: string;
  robot_id: string;
  filename?: string;
  filesize?: number;
  version?: string;
  ota_port?: number;
  target_ip?: string;
  target_port?: number;
  chunk_index?: number;
  total_chunks?: number;
  data?: string;
  binary_format?: boolean; 
}

const FirmwareUpdateWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const { setFirmwareUpdateMode } = useContext(GlobalAppContext); // Sử dụng context
  
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
  
  // Thêm trạng thái kết nối OTA0
  const [ota0Connected, setOta0Connected] = useState(false);
  const [ota0Connecting, setOta0Connecting] = useState(false);
  const [ota0Error, setOta0Error] = useState<string | null>(null);
  
  // Thêm cấu hình OTA ports
  const [otaConfig, setOtaConfig] = useState({
    OTA0: { port: 12345, description: "Firmware Update" },
    OTA1: { port: 12346, description: "Data (Encoder/IMU)" }
  });

  // Sử dụng OTA0 cho cập nhật firmware
  const FIRMWARE_PORT = otaConfig.OTA0.port;

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
          setFirmwareUpdateMode(false); // Tắt chế độ firmware update
          setTimeout(() => setUploadStatus('idle'), 3000);
        } else if (message.status === "error") {
          setErrorMessage(message.message || "Lỗi không xác định");
          setUploadStatus('error');
          setTimeout(() => setUploadStatus('idle'), 5000);
          setFirmwareUpdateMode(false); // Tắt chế độ firmware update nếu có lỗi
        }
      } else if (message.type === "firmware_progress") {
        setProgress(message.progress || 0);
      } else if (message.type === "firmware_version") {
        setCurrentVersion(message.version || "Unknown");
      } else if (message.type === "ota0_connection_response") {
        // Xử lý phản hồi từ kết nối OTA0
        if (message.status === "connected") {
          setOta0Connected(true);
          setOta0Connecting(false);
          setOta0Error(null);
        } else if (message.status === "error") {
          setOta0Connected(false);
          setOta0Connecting(false);
          setOta0Error(message.message || "Không thể kết nối đến OTA0");
        }
      }
    };

    const handleErrorResponse = (message: any) => {
      setErrorMessage(message.message || "Lỗi không xác định");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
      setFirmwareUpdateMode(false); // Tắt chế độ firmware update nếu có lỗi
    };

    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    tcpWebSocketService.onMessage('firmware_response', handleFirmwareResponse);
    tcpWebSocketService.onMessage('firmware_progress', handleFirmwareResponse);
    tcpWebSocketService.onMessage('firmware_version', handleFirmwareResponse);
    tcpWebSocketService.onMessage('ota0_connection_response', handleFirmwareResponse);
    tcpWebSocketService.onMessage('error', handleErrorResponse);

    setIsConnected(tcpWebSocketService.isConnected());

    return () => {
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage('firmware_response', handleFirmwareResponse);
      tcpWebSocketService.offMessage('firmware_progress', handleFirmwareResponse);
      tcpWebSocketService.offMessage('firmware_version', handleFirmwareResponse);
      tcpWebSocketService.offMessage('ota0_connection_response', handleFirmwareResponse);
      tcpWebSocketService.offMessage('error', handleErrorResponse);
    };
  }, [setFirmwareUpdateMode]);
  
  // Hàm kết nối đến OTA0
  const connectToOta0 = async () => {
    if (!ipAddress) {
      setOta0Error("Vui lòng nhập địa chỉ IP của robot");
      return;
    }
    
    setOta0Connecting(true);
    setOta0Error(null);
    
    // Kích hoạt chế độ update firmware - vô hiệu hóa các widget khác
    setFirmwareUpdateMode(true);
    
    try {
      // Gửi yêu cầu kết nối OTA0 cho firmware update
      tcpWebSocketService.sendMessage({
        type: "connect_ota0",
        ip_address: ipAddress,
        port: FIRMWARE_PORT,  // Sử dụng FIRMWARE_PORT cho firmware
        robot_id: selectedRobotId
      });
      
      // Kết nối được xử lý trong useEffect với message listener
    } catch (error) {
      console.error("Lỗi khi kết nối OTA:", error);
      setOta0Connected(false);
      setOta0Connecting(false);
      setOta0Error("Lỗi khi yêu cầu kết nối OTA");
      setFirmwareUpdateMode(false);
    }
  };
  
  // Hàm ngắt kết nối OTA0
  const disconnectOta0 = () => {
    tcpWebSocketService.sendMessage({
      type: "disconnect_ota0",
      robot_id: selectedRobotId,
      ip_address: ipAddress
    });
    
    setOta0Connected(false);
    setFirmwareUpdateMode(false); // Tắt chế độ firmware update
  };

  // Hàm tự động kết nối OTA0
  const autoConnectOTA0 = async () => {
    if (!isConnected) {
      setErrorMessage("Vui lòng kết nối DirectBridge trước");
      return;
    }
    
    setOta0Connecting(true);
    setOta0Error(null);
    setFirmwareUpdateMode(true);
    
    try {
      // Use selectedRobotId regardless of availableRobots
      let targetIp = ipAddress;
      
      // If no IP address set, use localhost
      if (!targetIp) {
        targetIp = "127.0.0.1";
        setIpAddress(targetIp);
        setUseIpAddress(true);
      }
      
      console.log(`Đang kết nối OTA0 đến ${selectedRobotId} (${targetIp}:${FIRMWARE_PORT})...`);
      
      // Gửi yêu cầu kết nối đến DirectBridge
      tcpWebSocketService.sendMessage({
        type: "connect_ota0",
        ip_address: targetIp,
        port: FIRMWARE_PORT,
        robot_id: selectedRobotId
      });
      
      console.log(`Đã gửi yêu cầu kết nối OTA0 tới ${targetIp}:${FIRMWARE_PORT}`);
    } catch (error) {
      console.error("Lỗi khi tự kết nối OTA0:", error);
      setOta0Connected(false);
      setOta0Connecting(false);
      setOta0Error("Lỗi khi tự kết nối: " + (error instanceof Error ? error.message : String(error)));
      setFirmwareUpdateMode(false);
    }
  };

  const sendFirmware = async () => {
    if (!selectedFile || !isConnected) {
      setErrorMessage("Chưa chọn file hoặc chưa kết nối tới DirectBridge");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
      return;
    }

    // Kiểm tra kết nối OTA0 trước khi gửi firmware
    if (!ota0Connected) {
      setErrorMessage("Chưa kết nối tới OTA0. Vui lòng kết nối trước khi cập nhật firmware.");
      setUploadStatus('error');
      setTimeout(() => setUploadStatus('idle'), 5000);
      return;
    }

    try {
      setUploadStatus('uploading');
      setProgress(0);

      const messageStart: FirmwareMessage = {
        type: "firmware_update_start",
        robot_id: selectedRobotId,
        filename: selectedFile.name,
        filesize: selectedFile.size,
        version: "1.0.1",
        ota_port: FIRMWARE_PORT,
        binary_format: true // Thêm flag để xác định đây là dữ liệu binary
      };

      if (useIpAddress && ipAddress) {
        messageStart.target_ip = ipAddress;
        messageStart.target_port = FIRMWARE_PORT;
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

        const chunkSize = 1024; // Kích thước chunk 1KB phù hợp với ESP32
        const totalChunks = Math.ceil(bytes.length / chunkSize);

        console.log(`Gửi firmware trong ${totalChunks} chunks, mỗi chunk ${chunkSize} bytes`);

        // Cập nhật hàm gửi chunk để xử lý đúng định dạng dữ liệu
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

                // Mã hóa chunk thành base64 (DirectBridge sẽ giải mã)
                const base64Chunk = btoa(
                  Array.from(chunk)
                    .map(byte => String.fromCharCode(byte))
                    .join('')
                );

                const chunkMessage: FirmwareMessage = {
                  type: "firmware_chunk",
                  robot_id: selectedRobotId,
                  chunk_index: chunkIndex,
                  total_chunks: totalChunks,
                  data: base64Chunk,
                  ota_port: FIRMWARE_PORT,
                  binary_format: true // Thêm flag để xác định đây là dữ liệu binary
                };

                if (useIpAddress && ipAddress) {
                  chunkMessage.target_ip = ipAddress;
                  chunkMessage.target_port = FIRMWARE_PORT;
                }

                const success = tcpWebSocketService.sendMessage(chunkMessage);

                if (!success) {
                  reject(new Error(`Không thể gửi chunk ${chunkIndex}`));
                  return;
                }

                const currentProgress = Math.round((chunkIndex + 1) / totalChunks * 100);
                setProgress(currentProgress);

                // Log tiến trình để debug
                if (chunkIndex % 10 === 0 || chunkIndex === totalChunks - 1) {
                  console.log(`Đã gửi chunk ${chunkIndex + 1}/${totalChunks} (${currentProgress}%)`);
                }

                sendChunkWithDelay(chunkIndex + 1).then(resolve).catch(reject);

              } catch (error) {
                reject(error);
              }
            }, 100); // Giữ độ trễ 100ms giữa các chunk để không làm quá tải ESP32
          });
        };

        await sendChunkWithDelay(0);

        const completeMessage: FirmwareMessage = {
          type: "firmware_update_complete",
          robot_id: selectedRobotId,
          ota_port: FIRMWARE_PORT,
          binary_format: true
        };

        if (useIpAddress && ipAddress) {
          completeMessage.target_ip = ipAddress;
          completeMessage.target_port = FIRMWARE_PORT;
        }

        tcpWebSocketService.sendMessage(completeMessage);
        console.log("Đã gửi tin nhắn hoàn tất cập nhật firmware");
      };

      reader.onerror = () => {
        throw new Error("Lỗi khi đọc file");
      };

    } catch (error) {
      console.error("Lỗi khi gửi firmware:", error);
      setUploadStatus('error');
      setErrorMessage(error instanceof Error ? error.message : "Lỗi không xác định");
      setTimeout(() => setUploadStatus('idle'), 5000);
      setFirmwareUpdateMode(false); // Tắt chế độ firmware update nếu có lỗi
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
        <button
          onClick={autoConnectOTA0}
          disabled={!isConnected || ota0Connected || ota0Connecting}
          className={`w-full py-2 rounded-md flex items-center justify-center gap-2
            ${(!isConnected || ota0Connected || ota0Connecting)
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        >
          {ota0Connecting ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              <span>Đang kết nối OTA0...</span>
            </>
          ) : (
            <>
              <Zap size={16} />
              <span>Tự động kết nối OTA0 cho robot {selectedRobotId}</span>
            </>
          )}
        </button>
      </div>

      {/* Thêm trạng thái và nút kết nối OTA0 */}
      <div className="mb-4 flex items-center justify-between bg-yellow-50 p-3 rounded-md">
        <div className="flex items-center">
          <div className={`w-3 h-3 rounded-full mr-2 ${
            ota0Connected ? 'bg-green-500' : (ota0Connecting ? 'bg-yellow-500' : 'bg-gray-400')
          }`}></div>
          <span>
            {ota0Connected ? `Đã kết nối OTA0 (port ${FIRMWARE_PORT})` : 
             (ota0Connecting ? 'Đang kết nối OTA...' : 'Chưa kết nối OTA')}
          </span>
        </div>

        {/* Nút kết nối/ngắt kết nối */}
        {!ota0Connected ? (
          <button
            onClick={connectToOta0}
            disabled={!isConnected || ota0Connecting || !ipAddress}
            className={`px-3 py-1 text-sm rounded flex items-center gap-1 ${
              !isConnected || ota0Connecting || !ipAddress
                ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                : 'bg-yellow-600 text-white hover:bg-yellow-700'
            }`}
          >
            {ota0Connecting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Đang kết nối...</span>
              </>
            ) : (
              <>
                <Plug size={14} />
                <span>Kết nối OTA0</span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={disconnectOta0}
            className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center gap-1"
          >
            <Power size={14} />
            <span>Ngắt kết nối</span>
          </button>
        )}
      </div>

      {ota0Error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-500 text-red-700 p-3 rounded">
          <p className="font-medium">Lỗi kết nối OTA0</p>
          <p>{ota0Error}</p>
        </div>
      )}

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

        {useIpAddress && (
          <>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                OTA Configuration
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">OTA0 (Firmware)</span>
                    <div className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full">
                      Primary
                    </div>
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2 text-sm">Port:</span>
                    <input
                      type="number"
                      value={FIRMWARE_PORT}
                      onChange={(e) => setOtaConfig(prev => ({
                        ...prev,
                        OTA0: {
                          ...prev.OTA0,
                          port: parseInt(e.target.value, 10)
                        }
                      }))}
                      className="w-24 p-1 border border-gray-300 rounded-md text-sm"
                      disabled={ota0Connected} // Không cho phép thay đổi khi đã kết nối
                    />
                  </div>
                </div>
                
                <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">OTA1 (Data)</span>
                    <div className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                      Secondary
                    </div>
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2 text-sm">Port:</span>
                    <input
                      type="number"
                      value={otaConfig.OTA1.port}
                      onChange={(e) => setOtaConfig(prev => ({
                        ...prev,
                        OTA1: {
                          ...prev.OTA1,
                          port: parseInt(e.target.value, 10)
                        }
                      }))}
                      className="w-24 p-1 border border-gray-300 rounded-md text-sm"
                      disabled={true} // Luôn disabled vì không sử dụng trong widget này
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Thêm thông tin trợ giúp về OTA0 và OTA1 */}
            <div className="mt-2 bg-blue-50 p-3 rounded-md text-sm text-blue-800">
              <p className="font-medium mb-1">Thông tin về kết nối OTA:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>OTA0 (port {FIRMWARE_PORT})</strong>: Được sử dụng để cập nhật firmware</li>
                <li><strong>OTA1 (port {otaConfig.OTA1.port})</strong>: Được sử dụng cho dữ liệu IMU, Encoder và các tính năng khác</li>
              </ul>
            </div>
          </>
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
          disabled={!selectedFile || !isConnected || uploadStatus === 'uploading' || !ota0Connected}
          className={`px-4 py-2 rounded-md flex items-center gap-2
            ${!selectedFile || !isConnected || uploadStatus === 'uploading' || !ota0Connected
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
              <span>Cập nhật firmware</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default FirmwareUpdateWidget;