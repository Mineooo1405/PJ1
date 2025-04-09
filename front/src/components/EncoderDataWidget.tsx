import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { RefreshCw, Play, Pause, RotateCcw, Download, ZoomIn, ZoomOut, Move, AlertCircle } from 'lucide-react';
import WidgetConnectionHeader from './WidgetConnectionHeader';
import { useRobotContext } from './RobotContext';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom'; // Thêm import cho plugin zoom
import { GlobalAppContext } from '../contexts/GlobalAppContext';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin // Đăng ký plugin zoom
);

// Modify these constants for faster updates
const MAX_HISTORY_POINTS = 10000;
const UI_UPDATE_INTERVAL = 20;

// Cập nhật hàm getWebSocketUrl đảm bảo kết nối đến Backend đúng
const getWebSocketUrl = (robotId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
  
  // Hỗ trợ cả kết nối qua DirectBridge và FastAPI
  // Nếu kết nối trực tiếp đến DirectBridge, sử dụng port 9003
  // Nếu kết nối qua FastAPI, sử dụng port 8000 
  return `${protocol}//${hostname}:9003/ws/${robotId}`;
  // Hoặc sử dụng FastAPI endpoint:
  // return `${protocol}//${hostname}:8000/ws/${robotId}`;
};

interface EncoderData {
  rpm_1: number;
  rpm_2: number;
  rpm_3: number;
  timestamp: string | number;
}

const EncoderDataWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const { firmwareUpdateMode } = useContext(GlobalAppContext);
  
  // WebSocket connection state
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  // Data state
  const [encoderData, setEncoderData] = useState<EncoderData>({
    rpm_1: 0,
    rpm_2: 0,
    rpm_3: 0,
    timestamp: new Date().toISOString()
  });
  
  const [encoderHistory, setEncoderHistory] = useState({
    timestamps: [] as string[],
    encoder1: [] as number[],
    encoder2: [] as number[],
    encoder3: [] as number[]
  });
  
  const [rpmValues, setRpmValues] = useState([0, 0, 0]);
  const [liveUpdate, setLiveUpdate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Add isPaused state here so it can be used throughout the component
  const [isPaused, setIsPaused] = useState(false);
  
  // Performance optimization refs
  const messageBuffer = useRef<any[]>([]);
  const lastUIUpdateTime = useRef(0);
  const animationFrameId = useRef<number | null>(null);
  const messageCounter = useRef(0);

  // Additional refs for connection and polling
  const connectionStartTime = useRef<number>(0);
  const databasePollInterval = useRef<NodeJS.Timeout | null>(null);
  const lastDataTimestamp = useRef<number>(0);

  // Thêm tham chiếu đến biểu đồ
  const chartRef = useRef<any>(null);

  // Helper function to get time string
  const getTimeString = (): string => {
    return new Date().toLocaleTimeString();
  };

  // Sửa hàm getTimeString để sử dụng timestamp từ dữ liệu
  const getTimeForData = (timestamp: number): string => {
    // Thay vì chỉ lấy milliseconds, lấy ra cả microseconds bằng cách giữ nguyên số thập phân
    return timestamp.toFixed(6); // Giữ lại 6 chữ số thập phân
  };
  
  // Thay đổi hàm processMessageBuffer để tổng hợp và xử lý dữ liệu theo lô
const processMessageBuffer = useCallback(() => {
  // Cancel any pending animation frame
  if (animationFrameId.current !== null) {
    cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = null;
  }
  
  // Process all messages in buffer
  if (messageBuffer.current.length === 0) {
    return;
  }
  
  console.log(`Processing ${messageBuffer.current.length} encoder messages in batch`);
  
  // Get all messages for batch processing
  const messages = [...messageBuffer.current];
  messageBuffer.current = []; // Clear buffer
  
  // Tổng hợp dữ liệu theo timestamp để tránh điểm trùng lặp
  const timestampMap: Map<string, {
    rpm_1: number,
    rpm_2: number,
    rpm_3: number,
    timestamp: number
  }> = new Map();
  
  // Xử lý tất cả tin nhắn để lấy giá trị mới nhất cho mỗi timestamp
  for (const message of messages) {
    if (message.type === 'encoder_data') {
      const encoderValues = {
        rpm_1: typeof message.rpm_1 === 'number' ? message.rpm_1 : 0,
        rpm_2: typeof message.rpm_2 === 'number' ? message.rpm_2 : 0,
        rpm_3: typeof message.rpm_3 === 'number' ? message.rpm_3 : 0,
        timestamp: message.timestamp || Date.now() / 1000
      };
      
      // Lấy timestamp đã được làm tròn đến giây (hoặc phần nhỏ hơn nếu muốn)
      const timeKey = getTimeForData(encoderValues.timestamp);
      
      // Cập nhật giá trị mới nhất cho timestamp này
      timestampMap.set(timeKey, encoderValues);
    }
  }
  
  // Sử dụng giá trị mới nhất cho hiển thị realtime (luôn cập nhật)
  if (timestampMap.size > 0) {
    const latestValues = Array.from(timestampMap.values()).pop();
    if (latestValues) {
      setEncoderData(latestValues);
      setRpmValues([latestValues.rpm_1, latestValues.rpm_2, latestValues.rpm_3]);
    }
  }
  
  // Chỉ cập nhật biểu đồ nếu không ở chế độ tạm dừng
  if (!isPaused && timestampMap.size > 0) {
    setEncoderHistory(prev => {
      // Tạo mảng mới với các điểm đã tổng hợp, sắp xếp theo thời gian
      const sortedEntries = Array.from(timestampMap.entries())
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
      
      // Tách các mảng mới để thêm vào history
      const newTimestamps = sortedEntries.map(([timeKey]) => timeKey);
      const newEncoder1 = sortedEntries.map(([, values]) => values.rpm_1);
      const newEncoder2 = sortedEntries.map(([, values]) => values.rpm_2);
      const newEncoder3 = sortedEntries.map(([, values]) => values.rpm_3);
      
      // Kết hợp với dữ liệu trước đó
      const combinedTimestamps = [...prev.timestamps, ...newTimestamps];
      const combinedEncoder1 = [...prev.encoder1, ...newEncoder1];
      const combinedEncoder2 = [...prev.encoder2, ...newEncoder2];
      const combinedEncoder3 = [...prev.encoder3, ...newEncoder3];
      
      // Giới hạn số điểm trong history
      if (combinedTimestamps.length > MAX_HISTORY_POINTS) {
        return {
          timestamps: combinedTimestamps.slice(-MAX_HISTORY_POINTS),
          encoder1: combinedEncoder1.slice(-MAX_HISTORY_POINTS),
          encoder2: combinedEncoder2.slice(-MAX_HISTORY_POINTS),
          encoder3: combinedEncoder3.slice(-MAX_HISTORY_POINTS)
        };
      }
      
      return {
        timestamps: combinedTimestamps,
        encoder1: combinedEncoder1,
        encoder2: combinedEncoder2,
        encoder3: combinedEncoder3
      };
    });
  }
  
  lastUIUpdateTime.current = Date.now();
  console.log(`UI updated at ${new Date().toLocaleTimeString()} with ${timestampMap.size} data points`);
}, [isPaused]);

  // Schedule UI updates using requestAnimationFrame for smoother performance
  const scheduleUIUpdate = useCallback(() => {
  if (animationFrameId.current !== null) {
    return; // Already scheduled
  }
  
  const now = Date.now();
  const timeSinceLastUpdate = now - lastUIUpdateTime.current;
  
  if (messageBuffer.current.length > 0 && timeSinceLastUpdate >= UI_UPDATE_INTERVAL) {
    // Time to update UI - use requestAnimationFrame for smooth rendering
    animationFrameId.current = requestAnimationFrame(() => {
      processMessageBuffer();
      animationFrameId.current = null;
    });
  }
}, [processMessageBuffer]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Record connection time and clear history
    const currentTimestamp = Math.floor(Date.now() / 1000);
    connectionStartTime.current = currentTimestamp;
    lastDataTimestamp.current = currentTimestamp;
    console.log(`Connection timestamp set to: ${new Date(currentTimestamp * 1000).toISOString()}`);
    
    // Reset history data
    setEncoderHistory({
      timestamps: [],
      encoder1: [],
      encoder2: [],
      encoder3: []
    });
    
    setStatus('connecting');
    setError(null);
    
    // Reset counters
    messageBuffer.current = [];
    messageCounter.current = 0;
    lastUIUpdateTime.current = 0;

    const wsUrl = getWebSocketUrl(selectedRobotId);
    console.log(`Connecting to backend WebSocket at ${wsUrl}`);
    
    const newSocket = new WebSocket(wsUrl);
    
    // Không cần interval để poll database nữa, chỉ lắng nghe tin nhắn WebSocket
newSocket.onopen = () => {
  console.log(`Connected to backend WebSocket for robot ${selectedRobotId}`);
  setStatus('connected');
  setIsConnected(true);
  setError(null);
  
  setTimeout(() => {
    console.log('Starting live updates automatically');
    setLiveUpdate(true);
    
    // Gửi yêu cầu subscribe để nhận dữ liệu trực tiếp, không cần thiết lập polling
    sendMessage({
      type: "subscribe_encoder" // hoặc "subscribe_imu" cho IMUWidget
    });
    
    // Không cần thiết lập databasePollInterval nữa
  }, 300);
};

    // Add detailed error handling for WebSocket
    newSocket.onclose = (event) => {
      console.log(`Disconnected from backend WebSocket for robot ${selectedRobotId} (code: ${event.code}, reason: ${event.reason})`);
      setStatus('disconnected');
      setIsConnected(false);
      setLiveUpdate(false);
      
      // Clean up polling
      if (databasePollInterval.current !== null) {
        clearInterval(databasePollInterval.current);
        databasePollInterval.current = null;
      }
      
      // Clean up animation frames
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };

    newSocket.onerror = (event) => {
      console.error(`WebSocket error for robot ${selectedRobotId}:`, event);
      setStatus('disconnected');
      setIsConnected(false);
      setError('Failed to connect to the server. Make sure the backend is running.');
    };

    // Sửa hàm xử lý tin nhắn onmessage để nhận dữ liệu trực tiếp từ robot

newSocket.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log("Received WebSocket data:", data);
    
    // Xử lý nhiều loại message types
    if (data.type === 'encoder' || data.type === 'encoder_data') {
      let values;
      
      if (data.type === 'encoder') {
        // Định dạng dữ liệu trực tiếp từ robot
        const rpms = Array.isArray(data.data) ? data.data : [0, 0, 0];
        values = {
          rpm_1: rpms[0] || 0,
          rpm_2: rpms[1] || 0,
          rpm_3: rpms[2] || 0,
          timestamp: data.timestamp || Date.now() / 1000
        };
      } else {
        // Định dạng dữ liệu cũ từ database
        values = {
          rpm_1: data.rpm_1 !== undefined ? data.rpm_1 : 
                 (data.rpm1 !== undefined ? data.rpm1 : 0),
          rpm_2: data.rpm_2 !== undefined ? data.rpm_2 : 
                 (data.rpm2 !== undefined ? data.rpm2 : 0),
          rpm_3: data.rpm_3 !== undefined ? data.rpm_3 : 
                 (data.rpm3 !== undefined ? data.rpm3 : 0),
          timestamp: data.timestamp || Date.now() / 1000
        };
      }
      
      // Debug vì vấn đề
      console.log("Processing encoder values:", values);
      
      // Update message buffer
      messageBuffer.current.push({
        type: 'encoder_data',
        ...values,
        original: data // Lưu trữ dữ liệu gốc
      });
      
      // Cập nhật timestamp gần nhất
      lastDataTimestamp.current = values.timestamp;
      
      // Tắt trạng thái loading
      if (loading) {
        setLoading(false);
      }
      
      // Lên lịch cập nhật UI ngay lập tức
      scheduleUIUpdate();
      
      // Tăng bộ đếm tin nhắn
      messageCounter.current++;
    }
    // Có thể thêm xử lý các message types khác ở đây
  } catch (err) {
    console.error("Failed to parse WebSocket message:", err);
    setError("Error processing data: " + (err instanceof Error ? err.message : String(err)));
    setLoading(false);
  }
};

    setSocket(newSocket);
  }, [selectedRobotId, loading, scheduleUIUpdate, isConnected, setLiveUpdate]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (socket) {
      socket.close();
      setSocket(null);
      setStatus('disconnected');
      setIsConnected(false);
      
      // Clear any pending updates
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      
      // Clear database polling
      if (databasePollInterval.current !== null) {
        clearInterval(databasePollInterval.current);
        databasePollInterval.current = null;
      }
      
      // Clear message buffer
      messageBuffer.current = [];
    }
  }, [socket]);

  // Send message through WebSocket
  const sendMessage = useCallback((message: any) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log("Sending to backend:", message);
      socket.send(JSON.stringify(message));
      return true;
    }
    console.warn("Cannot send message - socket not connected");
    return false;
  }, [socket]);

  // Request encoder data
  const requestEncoderData = useCallback(() => {
    if (!isConnected) return;
    
    setLoading(true);
    console.log(`Requesting encoder data for robot ${selectedRobotId} from database`);
    
    // Clear message buffer before requesting new data
    messageBuffer.current = [];
    messageCounter.current = 0;
    
    sendMessage({
      type: "get_encoder_data" // Command to get encoder data from database
    });
  }, [isConnected, sendMessage, selectedRobotId]);

  // Toggle live updates
  const toggleLiveUpdate = useCallback(() => {
  setLiveUpdate(prev => {
    const newValue = !prev;

    if (isConnected) {
      if (newValue) {
        console.log(`Đăng ký nhận encoder data cho robot ${selectedRobotId}`);
        sendMessage({
          type: "subscribe_encoder", // Sửa từ direct_subscribe thành subscribe_encoder
          robot_id: selectedRobotId
        });
      } else {
        console.log(`Hủy đăng ký nhận encoder data cho robot ${selectedRobotId}`);
        sendMessage({
          type: "unsubscribe_encoder", // Sửa từ direct_unsubscribe thành unsubscribe_encoder
          robot_id: selectedRobotId
        });
      }
    }

    return newValue;
  });
}, [isConnected, sendMessage, selectedRobotId]);

  // Set up periodic UI update ticker
  useEffect(() => {
  // Chỉnh sửa để interval chạy chính xác 1 giây 1 lần
  const intervalId = setInterval(() => {
    if (messageBuffer.current.length > 0) {
      scheduleUIUpdate();
    }
  }, UI_UPDATE_INTERVAL);
  
  return () => {
    clearInterval(intervalId);
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
    }
  };
}, [scheduleUIUpdate]);

// Cập nhật UI thường xuyên hơn, bất kể có dữ liệu mới hay không
useEffect(() => {
  // Force update UI periodically
  const intervalId = setInterval(() => {
    if (liveUpdate && messageBuffer.current.length > 0) {
      console.log("Forcing UI update...");
      scheduleUIUpdate();
    }
  }, 200); // Check every 200ms
  
  return () => {
    clearInterval(intervalId);
  };
}, [scheduleUIUpdate, liveUpdate]);

  // Clean up WebSocket connection on unmount or robot ID change
  useEffect(() => {
    return () => {
      if (socket) {
        socket.close();
      }
      
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [socket, selectedRobotId]);

  // Request data once when connected
  useEffect(() => {
    if (isConnected) {
      requestEncoderData();
    }
  }, [isConnected, requestEncoderData]);

  // Reset history
  const clearHistory = () => {
    setEncoderHistory({
      timestamps: [],
      encoder1: [],
      encoder2: [],
      encoder3: []
    });
  };

  // Download data as CSV
  const downloadData = () => {
    if (encoderHistory.timestamps.length === 0) return;
    
    let csvContent = 'timestamp,encoder1,encoder2,encoder3,rpm1,rpm2,rpm3\n';
    
    for (let i = 0; i < encoderHistory.timestamps.length; i++) {
      csvContent += `${encoderHistory.timestamps[i]},`;
      csvContent += `${encoderHistory.encoder1[i] || 0},${encoderHistory.encoder2[i] || 0},${encoderHistory.encoder3[i] || 0},`;
      csvContent += `${encoderHistory.encoder1[i] || 0},${encoderHistory.encoder2[i] || 0},${encoderHistory.encoder3[i] || 0}\n`;
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `encoder_data_${selectedRobotId}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Hàm để reset zoom
  const resetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  // Chart data
  const chartData = {
    labels: encoderHistory.timestamps,
    datasets: [
      {
        label: 'Encoder 1',
        data: encoderHistory.encoder1,
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'Encoder 2',
        data: encoderHistory.encoder2,
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'Encoder 3',
        data: encoderHistory.encoder3,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      }
    ]
  };

  // Fix zoom plugin configuration
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0 // Disable animations for better performance
    },
    elements: {
      line: {
        tension: 0.3, // Tăng độ mượt của đường
        cubicInterpolationMode: 'monotone' as 'monotone', // Fix type with assertion
        stepped: false // Đảm bảo không hiển thị kiểu bậc thang
      },
      point: {
        radius: 1, // Giảm kích thước điểm để biểu đồ trông mượt mà hơn
        hitRadius: 10, 
        hoverRadius: 5
      }
    },
    scales: {
      x: {
        ticks: {
          maxTicksLimit: 5 // Limit X-axis labels
        }
      },
      y: {
        title: {
          display: true,
          text: 'RPM'
        }
      }
    },
    plugins: {
      decimation: {
        enabled: true,
      },
      legend: {
        position: 'top' as const,
      },
      zoom: {
        limits: {
          x: {minRange: 1},
          y: {minRange: 1}
        },
        pan: {
          enabled: true,
          mode: 'xy' as const, // Sử dụng as const thay vì as 'xy'
          modifierKey: undefined, // Quan trọng: cho phép kéo không cần phím modifier
          threshold: 10,
          speed: 10
        },
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true,
          },
          mode: 'xy' as const, // Sử dụng as const thay vì as 'xy'
          speed: 0.1, // Giảm tốc độ zoom để dễ kiểm soát hơn
        },
      }
    },
  };

  // Indicator showing if we're dropping messages
  const messageRate = messageCounter.current > 0 ? 
    <span className="text-xs ml-2 text-green-500">
      {`${messageCounter.current} msgs`}
    </span> : null;

  // Thêm hàm để bật/tắt chế độ tạm dừng
const togglePause = useCallback(() => {
  setIsPaused(prev => !prev);
}, []);

  // Cập nhật UI để hiển thị thông báo khi đang trong chế độ firmware update
  if (firmwareUpdateMode) {
    return (
      <div className="flex flex-col h-full p-4">
        <WidgetConnectionHeader
          title={`Encoder Data (${selectedRobotId})`}
          status="disconnected"
          isConnected={false}
          onConnect={() => {}}
          onDisconnect={() => {}}
        />
        
        <div className="flex-grow flex items-center justify-center bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <div className="text-center p-6">
            <AlertCircle size={32} className="text-yellow-500 mx-auto mb-2" />
            <h3 className="text-lg font-medium text-gray-700">Cập Nhật Firmware Đang Diễn Ra</h3>
            <p className="text-gray-500 mt-1">
              Dữ liệu encoder tạm thời không khả dụng trong quá trình cập nhật firmware.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4">
      <WidgetConnectionHeader
        title={`Encoder Data (${selectedRobotId})`}
        status={status}
        isConnected={isConnected}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      
      <div className="flex gap-2 mb-4">
        <button
          onClick={requestEncoderData}
          disabled={!isConnected || loading}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-md flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          {loading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          <span>Refresh</span>
        </button>
        
        <button
          onClick={toggleLiveUpdate}
          disabled={!isConnected}
          className={`px-3 py-1.5 rounded-md flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed
                   ${liveUpdate 
                     ? 'bg-green-600 text-white hover:bg-green-700' 
                     : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
        >
          {liveUpdate ? (
            <>
              <Pause size={14} />
              {messageRate}
            </>
          ) : (
            <>
              <Play size={14} />
            </>
          )}
        </button>
        
        {/* Nút Pause mới */}
        <button
          onClick={togglePause}
          disabled={!isConnected || !liveUpdate}
          className={`px-3 py-1.5 rounded-md flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed
                   ${isPaused 
                     ? 'bg-amber-500 text-white hover:bg-amber-600' 
                     : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
        >
          {isPaused ? (
            <>
              <Play size={14} />
              <span>Resume</span>
            </>
          ) : (
            <>
              <Pause size={14} />
              <span>Freeze Chart</span>
            </>
          )}
        </button>
        
        <button
          onClick={clearHistory}
          className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded-md flex items-center gap-1 hover:bg-gray-300"
        >
          <RotateCcw size={14} />
          <span>Clear</span>
        </button>
        
        <button
          onClick={downloadData}
          disabled={encoderHistory.timestamps.length === 0}
          className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded-md flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 ml-auto"
        >
          <Download size={14} />
          <span>CSV</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded mb-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 bg-blue-50 rounded-lg text-center">
          <div className="text-xs text-gray-500 mb-1">Encoder 1</div>
          <div className="text-xl font-bold">{rpmValues[0].toFixed(1)}</div>
          <div className="text-xs text-gray-500">Value</div>
          <div className="text-sm">{rpmValues[0].toFixed(1)} RPM</div>
        </div>
        <div className="p-3 bg-green-50 rounded-lg text-center">
          <div className="text-xs text-gray-500 mb-1">Encoder 2</div>
          <div className="text-xl font-bold">{rpmValues[1].toFixed(1)}</div>
          <div className="text-xs text-gray-500">Value</div>
          <div className="text-sm">{rpmValues[1].toFixed(1)} RPM</div>
        </div>
        <div className="p-3 bg-purple-50 rounded-lg text-center">
          <div className="text-xs text-gray-500 mb-1">Encoder 3</div>
          <div className="text-xl font-bold">{rpmValues[2].toFixed(1)}</div>
          <div className="text-xs text-gray-500">Value</div>
          <div className="text-sm">{rpmValues[2].toFixed(1)} RPM</div>
        </div>
      </div>

      <div className="flex-grow" style={{ height: 'calc(100% - 200px)' }}>
        {encoderHistory.timestamps.length > 0 ? (
          <div className="relative h-full">
            <Line 
              data={chartData} 
              options={chartOptions} 
              ref={chartRef} // Thay vì dùng callback function phức tạp
            />
            
            {/* Thêm nút reset zoom */}
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/80 rounded-md px-2 py-1 shadow-sm">
              <button
                onClick={resetZoom}
                className="p-1 hover:bg-gray-100 rounded"
                title="Reset Zoom"
              >
                <RotateCcw size={14} />
              </button>
              <span className="text-xs text-gray-500">Zoom: Cuộn chuột | Kéo: Di chuyển</span>
            </div>
            <div className="absolute bottom-2 right-2 flex gap-1">
              <button
                onClick={resetZoom}
                className="p-1 bg-white rounded-md border border-gray-200 shadow-sm"
                title="Reset Zoom"
              >
                <ZoomOut size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            No data available. Click the refresh button or enable live updates.
          </div>
        )}
      </div>
      
      <div className="mt-2 text-xs text-gray-500">
        Last updated: {new Date(encoderData.timestamp as any).toLocaleString()}
      </div>
    </div>
  );
};

export default EncoderDataWidget;