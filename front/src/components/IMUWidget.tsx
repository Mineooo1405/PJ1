import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useRobotContext } from './RobotContext';
import WidgetConnectionHeader from './WidgetConnectionHeader';
import { RefreshCw, Play, Pause, RotateCcw, Download, ZoomIn, ZoomOut, Move, AlertCircle } from 'lucide-react';
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

// Performance optimization constants
const MAX_HISTORY_POINTS = 10000;
const UI_UPDATE_INTERVAL = 20;

// Cập nhật URL WebSocket để kết nối trực tiếp với DirectBridge
const getWebSocketUrl = (robotId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
  
  // Kết nối trực tiếp đến DirectBridge
  return `${protocol}//${hostname}:9003/ws/${robotId}`;
};

// Replace the current SimpleCompassVisualizer with this simpler YPR visualization
const SimpleYPRVisualizer: React.FC<{ roll: number; pitch: number; yaw: number }> = ({ roll, pitch, yaw }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Calculate dimensions for each diagram
    const diagramSize = Math.min(width, height / 3) - 20;
    const centerX = width / 2;
    
    // Vertical spacing
    const yaw_y = height * 0.17;
    const pitch_y = height * 0.5;
    const roll_y = height * 0.83;
    
    // Clear canvas
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, width, height);
    
    // Draw section dividers
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, height/3);
    ctx.lineTo(width-20, height/3);
    ctx.moveTo(20, height*2/3);
    ctx.lineTo(width-20, height*2/3);
    ctx.stroke();
    
    // ===== YAW DIAGRAM (TOP) =====
    // Draw yaw circle
    ctx.beginPath();
    ctx.arc(centerX, yaw_y, diagramSize/2, 0, Math.PI * 2);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw cardinal directions
    const directions = ['N', 'E', 'S', 'W'];
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI / 2);
      const x = centerX + Math.sin(angle) * (diagramSize/2 + 15);
      const y = yaw_y - Math.cos(angle) * (diagramSize/2 + 15);
      
      ctx.font = i === 0 ? 'bold 14px Arial' : '14px Arial';
      ctx.fillStyle = i === 0 ? '#cc0000' : '#333';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(directions[i], x, y);
    }
    
    // Draw yaw arrow
    ctx.save();
    ctx.translate(centerX, yaw_y);
    ctx.rotate(yaw);
    
    ctx.beginPath();
    ctx.moveTo(0, -diagramSize/2 + 5);
    ctx.lineTo(0, -diagramSize/2 + 15);
    ctx.lineTo(10, -diagramSize/2 + 15);
    ctx.lineTo(0, -diagramSize/2);
    ctx.lineTo(-10, -diagramSize/2 + 15);
    ctx.lineTo(0, -diagramSize/2 + 15);
    ctx.fillStyle = '#4299e1';
    ctx.fill();
    
    // Draw vehicle outline (top view)
    ctx.beginPath();
    ctx.moveTo(0, -diagramSize/4);
    ctx.lineTo(-diagramSize/4, diagramSize/4);
    ctx.lineTo(diagramSize/4, diagramSize/4);
    ctx.closePath();
    ctx.fillStyle = '#90cdf4';
    ctx.fill();
    ctx.strokeStyle = '#3182ce';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    ctx.restore();
    
    // Add yaw label
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('YAW', centerX, yaw_y - diagramSize/2 - 25);
    ctx.fillText(formatAngle(yaw), centerX, yaw_y + diagramSize/2 + 20);
    
    // ===== PITCH DIAGRAM (MIDDLE) =====
    // Draw pitch diagram (side view)
    ctx.beginPath();
    ctx.arc(centerX, pitch_y, diagramSize/2, 0, Math.PI * 2);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw pitch reference lines
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const y = pitch_y + i * (diagramSize/5);
      
      ctx.beginPath();
      ctx.moveTo(centerX - diagramSize/2, y);
      ctx.lineTo(centerX + diagramSize/2, y);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Add degree labels
      ctx.fillStyle = '#888';
      ctx.font = '10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`${-i*30}°`, centerX - diagramSize/2 - 5, y + 3);
    }
    
    // Draw horizon line
    ctx.beginPath();
    ctx.moveTo(centerX - diagramSize/2, pitch_y);
    ctx.lineTo(centerX + diagramSize/2, pitch_y);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw vehicle (side view)
    ctx.save();
    ctx.translate(centerX, pitch_y);
    ctx.rotate(pitch);
    
    ctx.beginPath();
    ctx.moveTo(-diagramSize/3, 0);
    ctx.lineTo(diagramSize/3, 0);
    ctx.moveTo(diagramSize/3, 0);
    ctx.lineTo(diagramSize/5, -diagramSize/8);
    ctx.moveTo(-diagramSize/5, -diagramSize/8);
    ctx.lineTo(-diagramSize/3, 0);
    ctx.strokeStyle = '#e53e3e';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw wheel
    ctx.beginPath();
    ctx.arc(-diagramSize/4, 0, diagramSize/16, 0, Math.PI * 2);
    ctx.arc(diagramSize/4, 0, diagramSize/16, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.fill();
    
    ctx.restore();
    
    // Add pitch label
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PITCH', centerX, pitch_y - diagramSize/2 - 25);
    ctx.fillText(formatAngle(pitch), centerX, pitch_y + diagramSize/2 + 20);
    
    // ===== ROLL DIAGRAM (BOTTOM) =====
    // Draw roll diagram (front view)
    ctx.beginPath();
    ctx.arc(centerX, roll_y, diagramSize/2, 0, Math.PI * 2);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw roll reference lines
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const angle = i * Math.PI/6;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const x1 = centerX - diagramSize/2 * cos;
      const y1 = roll_y - diagramSize/2 * sin;
      const x2 = centerX + diagramSize/2 * cos;
      const y2 = roll_y + diagramSize/2 * sin;
      
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Add degree labels
      ctx.fillStyle = '#888';
      ctx.font = '10px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`${i*30}°`, x2 + 5, y2 + 3);
    }
    
    // Draw horizon line
    ctx.beginPath();
    ctx.moveTo(centerX - diagramSize/2, roll_y);
    ctx.lineTo(centerX + diagramSize/2, roll_y);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw vehicle (front view)
    ctx.save();
    ctx.translate(centerX, roll_y);
    ctx.rotate(-roll); // Inverted for more intuitive display
    
    ctx.beginPath();
    ctx.rect(-diagramSize/3, -diagramSize/10, diagramSize/1.5, diagramSize/5);
    ctx.fillStyle = '#48bb78';
    ctx.fill();
    ctx.strokeStyle = '#2f855a';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw wheels
    ctx.beginPath();
    ctx.rect(-diagramSize/3 - diagramSize/16, diagramSize/10, diagramSize/8, diagramSize/16);
    ctx.rect(diagramSize/3 - diagramSize/16, diagramSize/10, diagramSize/8, diagramSize/16);
    ctx.fillStyle = '#333';
    ctx.fill();
    
    // Draw windshield indicator
    ctx.beginPath();
    ctx.moveTo(-diagramSize/6, -diagramSize/10);
    ctx.lineTo(diagramSize/6, -diagramSize/10);
    ctx.lineTo(diagramSize/6, -diagramSize/5);
    ctx.lineTo(-diagramSize/6, -diagramSize/5);
    ctx.closePath();
    ctx.fillStyle = '#bee3f8';
    ctx.fill();
    ctx.strokeStyle = '#3182ce';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    ctx.restore();
    
    // Add roll label
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ROLL', centerX, roll_y - diagramSize/2 - 25);
    ctx.fillText(formatAngle(roll), centerX, roll_y + diagramSize/2 + 20);
    
  }, [roll, pitch, yaw]);
  
  // Helper function to format angle
  const formatAngle = (rad: number) => {
    return `${(rad * 180 / Math.PI).toFixed(1)}°`;
  };
  
  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={400}
      className="w-full h-full"
    />
  );
};

const IMUWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const [imuData, setImuData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveUpdate, setLiveUpdate] = useState(false);
  const [activeChart, setActiveChart] = useState<'orientation' | 'quaternion'>('orientation');
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  // Performance optimization refs
  const messageBuffer = useRef<any[]>([]);
  const lastUIUpdateTime = useRef(0);
  const animationFrameId = useRef<number | null>(null);
  const messageCounter = useRef(0);

  // Additional refs for database polling
  const databasePollInterval = useRef<NodeJS.Timeout | null>(null);
  const lastDataTimestamp = useRef<number>(0);
  
  const [history, setHistory] = useState({
    timestamps: [] as string[],
    orientation: {
      roll: [] as number[],
      pitch: [] as number[],
      yaw: [] as number[]
    },
    quaternion: {
      w: [] as number[],
      x: [] as number[],
      y: [] as number[],
      z: [] as number[]
    }
  });

  // Thêm tham chiếu đến biểu đồ
  const chartRef = useRef<any>(null);

  // Thêm state để quản lý chế độ tạm dừng cập nhật biểu đồ
  const [isPaused, setIsPaused] = useState(false);

  // Thêm context
  const { firmwareUpdateMode } = useContext(GlobalAppContext);

  // Helper function to get time string
  const getTimeString = (): string => {
    return new Date().toLocaleTimeString();
  };

  // Sửa hàm getTimeString để sử dụng timestamp từ dữ liệu
  const getTimeForData = (timestamp: number): string => {
    // Thay vì chỉ lấy milliseconds, lấy ra cả microseconds bằng cách giữ nguyên số thập phân
    return timestamp.toFixed(6); // Giữ lại 6 chữ số thập phân
  };

  // Process any buffered messages and update the UI
  // Cập nhật hàm processMessageBuffer để kiểm tra trạng thái tạm dừng
  const processMessageBuffer = useCallback(() => {
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    
    if (messageBuffer.current.length === 0) {
      return;
    }
    
    console.log(`Processing ${messageBuffer.current.length} IMU messages in batch`);
    
    // Get and process all messages
    const messages = [...messageBuffer.current];
    messageBuffer.current = []; // Clear buffer
    
    // Tổng hợp dữ liệu theo timestamp
    const timestampMap: Map<string, {
      roll: number,
      pitch: number,
      yaw: number,
      quat_w: number,
      quat_x: number,
      quat_y: number,
      quat_z: number,
      timestamp: number
    }> = new Map();
    
    // Xử lý tất cả tin nhắn để lấy giá trị mới nhất cho mỗi timestamp
    for (const message of messages) {
      if (message.type === 'imu_data') {
        // Extract values
        const roll = typeof message.roll === 'number' ? message.roll : 
                    (message.orientation?.roll ?? 0);
        const pitch = typeof message.pitch === 'number' ? message.pitch : 
                     (message.orientation?.pitch ?? 0);
        const yaw = typeof message.yaw === 'number' ? message.yaw : 
                   (message.orientation?.yaw ?? 0);

        // Extract quaternion values
        const quat_w = typeof message.quat_w === 'number' ? message.quat_w : 
                      (message.qw ?? 1.0);
        const quat_x = typeof message.quat_x === 'number' ? message.quat_x : 
                      (message.qx ?? 0.0);
        const quat_y = typeof message.quat_y === 'number' ? message.quat_y : 
                      (message.qy ?? 0.0);
        const quat_z = typeof message.quat_z === 'number' ? message.quat_z : 
                      (message.qz ?? 0.0);
        
        // Lấy timestamp từ dữ liệu
        const timestamp = message.timestamp || Date.now() / 1000;
        
        // Lấy timestamp đã được làm tròn đến giây
        const timeKey = getTimeForData(timestamp);
        
        // Cập nhật giá trị mới nhất cho timestamp này
        timestampMap.set(timeKey, {
          roll,
          pitch,
          yaw,
          quat_w,
          quat_x,
          quat_y,
          quat_z,
          timestamp
        });
      }
    }
    
    // Sử dụng giá trị mới nhất cho hiển thị realtime
    if (timestampMap.size > 0) {
      const latestValues = Array.from(timestampMap.values()).pop();
      if (latestValues) {
        setImuData(latestValues);
      }
    }
    
    // Chỉ cập nhật biểu đồ nếu không ở chế độ tạm dừng
    if (!isPaused && timestampMap.size > 0) {
      setHistory(prev => {
        // Tạo mảng mới với các điểm đã tổng hợp, sắp xếp theo thời gian
        const sortedEntries = Array.from(timestampMap.entries())
          .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
        
        // Tách các mảng mới để thêm vào history
        const newTimestamps = sortedEntries.map(([timeKey]) => timeKey);
        const newOrientationRoll = sortedEntries.map(([, values]) => values.roll);
        const newOrientationPitch = sortedEntries.map(([, values]) => values.pitch);
        const newOrientationYaw = sortedEntries.map(([, values]) => values.yaw);
        const newQuaternionW = sortedEntries.map(([, values]) => values.quat_w);
        const newQuaternionX = sortedEntries.map(([, values]) => values.quat_x);
        const newQuaternionY = sortedEntries.map(([, values]) => values.quat_y);
        const newQuaternionZ = sortedEntries.map(([, values]) => values.quat_z);
        
        // Kết hợp với dữ liệu trước đó
        const combinedTimestamps = [...prev.timestamps, ...newTimestamps];
        
        // Giới hạn số điểm trong history
        if (combinedTimestamps.length > MAX_HISTORY_POINTS) {
          return {
            timestamps: combinedTimestamps.slice(-MAX_HISTORY_POINTS),
            orientation: {
              roll: [...prev.orientation.roll, ...newOrientationRoll].slice(-MAX_HISTORY_POINTS),
              pitch: [...prev.orientation.pitch, ...newOrientationPitch].slice(-MAX_HISTORY_POINTS),
              yaw: [...prev.orientation.yaw, ...newOrientationYaw].slice(-MAX_HISTORY_POINTS)
            },
            quaternion: {
              w: [...prev.quaternion.w, ...newQuaternionW].slice(-MAX_HISTORY_POINTS),
              x: [...prev.quaternion.x, ...newQuaternionX].slice(-MAX_HISTORY_POINTS),
              y: [...prev.quaternion.y, ...newQuaternionY].slice(-MAX_HISTORY_POINTS),
              z: [...prev.quaternion.z, ...newQuaternionZ].slice(-MAX_HISTORY_POINTS)
            }
          };
        }
        
        return {
          timestamps: combinedTimestamps,
          orientation: {
            roll: [...prev.orientation.roll, ...newOrientationRoll],
            pitch: [...prev.orientation.pitch, ...newOrientationPitch],
            yaw: [...prev.orientation.yaw, ...newOrientationYaw]
          },
          quaternion: {
            w: [...prev.quaternion.w, ...newQuaternionW],
            x: [...prev.quaternion.x, ...newQuaternionX],
            y: [...prev.quaternion.y, ...newQuaternionY],
            z: [...prev.quaternion.z, ...newQuaternionZ]
          }
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
    if (messageBuffer.current.length > 0 && now - lastUIUpdateTime.current > UI_UPDATE_INTERVAL) {
      // Time to update UI
      animationFrameId.current = requestAnimationFrame(() => {
        processMessageBuffer();
        animationFrameId.current = null;
      });
    }
  }, [processMessageBuffer]);

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

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Record connection time and reset history
    const currentTimestamp = Math.floor(Date.now() / 1000);
    lastDataTimestamp.current = currentTimestamp;
    console.log(`Connection timestamp set to: ${new Date(currentTimestamp * 1000).toISOString()}`);

    setStatus('connecting');
    setError(null);
    
    // Reset counters
    messageBuffer.current = [];
    messageCounter.current = 0;
    lastUIUpdateTime.current = 0;

    const wsUrl = getWebSocketUrl(selectedRobotId);
    console.log(`Connecting to backend WebSocket at ${wsUrl}`);
    
    const newSocket = new WebSocket(wsUrl);
    
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
          type: "subscribe_imu" // hoặc "subscribe_imu" cho IMUWidget
        });
        
        // Không cần thiết lập databasePollInterval nữa
      }, 300);
    };

    newSocket.onclose = () => {
      console.log(`Disconnected from backend WebSocket for robot ${selectedRobotId}`);
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
      setError('Failed to connect to the server');
    };

    // Cập nhật hàm xử lý tin nhắn WebSocket
    newSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Received WebSocket data:", data);
        
        // Xử lý dữ liệu từ bno055 hoặc imu_data
        if (data.type === 'bno055' || data.type === 'imu_data') {
          let values;
          
          if (data.type === 'bno055') {
            // Định dạng dữ liệu trực tiếp từ robot
            const imuData = data.data || {};
            const eulerData = imuData.euler || [0, 0, 0];
            const quaternionData = imuData.quaternion || [1, 0, 0, 0];
            
            values = {
              roll: eulerData[0] || 0,
              pitch: eulerData[1] || 0,
              yaw: eulerData[2] || 0,
              quat_w: quaternionData[0] || 1.0,
              quat_x: quaternionData[1] || 0.0,
              quat_y: quaternionData[2] || 0.0,
              quat_z: quaternionData[3] || 0.0,
              timestamp: imuData.time || data.timestamp || Date.now() / 1000
            };
          } else {
            // Định dạng dữ liệu cũ từ database
            values = {
              roll: typeof data.roll === 'number' ? data.roll : 
                    (data.orientation?.roll ?? 0),
              pitch: typeof data.pitch === 'number' ? data.pitch : 
                    (data.orientation?.pitch ?? 0),
              yaw: typeof data.yaw === 'number' ? data.yaw : 
                    (data.orientation?.yaw ?? 0),
              quat_w: typeof data.quat_w === 'number' ? data.quat_w : 
                      (data.qw ?? 1.0),
              quat_x: typeof data.quat_x === 'number' ? data.quat_x : 
                      (data.qx ?? 0.0),
              quat_y: typeof data.quat_y === 'number' ? data.quat_y : 
                      (data.qy ?? 0.0),
              quat_z: typeof data.quat_z === 'number' ? data.quat_z : 
                      (data.qz ?? 0.0),
              timestamp: data.timestamp || Date.now() / 1000
            };
          }
          
          console.log("Processing IMU values:", values);
          
          // Cập nhật buffer
          messageBuffer.current.push({
            type: 'imu_data',
            ...values,
            original: data
          });
          
          // Cập nhật timestamp gần nhất
          lastDataTimestamp.current = values.timestamp;
          
          if (loading) {
            setLoading(false);
          }
          
          // Lên lịch cập nhật UI
          scheduleUIUpdate();
          
          // Tăng bộ đếm tin nhắn
          messageCounter.current++;
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
        setError("Error processing data: " + (err instanceof Error ? err.message : String(err)));
      }
    };

    setSocket(newSocket);
  }, [selectedRobotId, loading, scheduleUIUpdate, isConnected, sendMessage]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (socket) {
      socket.close();
      setSocket(null);
      setStatus('disconnected');
      setIsConnected(false);
      
      // Clean up any pending updates
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      
      // Clean up database polling
      if (databasePollInterval.current !== null) {
        clearInterval(databasePollInterval.current);
        databasePollInterval.current = null;
      }
      
      // Clear message buffer
      messageBuffer.current = [];
    }
  }, [socket]);

  // Request IMU data
  const requestIMUData = useCallback(() => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);
    console.log(`Requesting IMU data for robot ${selectedRobotId} from database`);
    
    // Clear message buffer before requesting new data
    messageBuffer.current = [];
    messageCounter.current = 0;

    sendMessage({
      type: "get_imu_data" // Command to get IMU data from database
    });
  }, [isConnected, sendMessage, selectedRobotId]);

  // Toggle live updates
  const toggleLiveUpdate = useCallback(() => {
    setLiveUpdate(prev => {
      const newValue = !prev;

      if (isConnected) {
        if (newValue) {
          console.log(`Subscribing to IMU updates for robot ${selectedRobotId}`);
          sendMessage({
            type: "subscribe_imu"  // Subscribe command
          });
          
          // Reset counters when starting live updates
          messageCounter.current = 0;
        } else {
          console.log(`Unsubscribing from IMU updates for robot ${selectedRobotId}`);
          sendMessage({
            type: "unsubscribe_imu"  // Unsubscribe command
          });
        }
      }

      return newValue;
    });
  }, [isConnected, sendMessage, selectedRobotId]);

  // Thêm hàm để bật/tắt chế độ tạm dừng
  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  // Set up periodic UI update ticker
  useEffect(() => {
    // Set up interval for checking if UI updates needed
    const intervalId = setInterval(() => {
      if (messageBuffer.current.length > 0) {
        scheduleUIUpdate();
      }
    }, Math.floor(UI_UPDATE_INTERVAL / 2)); // Check slightly more often than update interval
    
    return () => {
      clearInterval(intervalId);
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [scheduleUIUpdate]);

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
      requestIMUData();
    }
  }, [isConnected, requestIMUData]);

  // Download data as CSV
  const downloadData = () => {
    if (history.timestamps.length === 0) return;
    
    let csvContent = 'timestamp,roll,pitch,yaw,quatW,quatX,quatY,quatZ\n';
    
    for (let i = 0; i < history.timestamps.length; i++) {
      csvContent += `${history.timestamps[i]},`;
      csvContent += `${history.orientation.roll[i] || 0},${history.orientation.pitch[i] || 0},${history.orientation.yaw[i] || 0},`;
      csvContent += `${history.quaternion.w[i] || 0},${history.quaternion.x[i] || 0},${history.quaternion.y[i] || 0},${history.quaternion.z[i] || 0}\n`;
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `imu_data_${selectedRobotId}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Reset history
  const clearHistory = () => {
    setHistory({
      timestamps: [],
      orientation: { roll: [], pitch: [], yaw: [] },
      quaternion: { w: [], x: [], y: [], z: [] }
    });
  };

  // Hàm để reset zoom
  const resetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  // Chart data for different modes
  const chartData = {
    labels: history.timestamps,
    datasets: activeChart === 'orientation' ? [
      {
        label: 'Roll',
        data: history.orientation.roll,
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'Pitch',
        data: history.orientation.pitch,
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'Yaw',
        data: history.orientation.yaw,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      }
    ] : [
      {
        label: 'W',
        data: history.quaternion.w,
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'X',
        data: history.quaternion.x,
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'Y',
        data: history.quaternion.y,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      },
      {
        label: 'Z',
        data: history.quaternion.z,
        borderColor: 'rgba(153, 102, 255, 1)',
        backgroundColor: 'rgba(153, 102, 255, 0.2)',
        borderWidth: 2,
        pointRadius: 2, // Changed from 0 to 2 to show data points
        pointHoverRadius: 5,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0 // Disable animations for better performance
    },
    elements: {
      line: {
        tension: 0.3, // Tăng độ mượt của đường
        cubicInterpolationMode: 'monotone' as const, // Thêm chế độ nội suy đường cong
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
          text: activeChart === 'orientation' ? 'Rad' : 'Value'
        }
      }
    },
    plugins: {
      title: {
        display: true,
        text: activeChart === 'orientation'
          ? 'Orientation (Roll, Pitch, Yaw)'
          : 'Quaternion (W, X, Y, Z)'
      },
      legend: {
        position: 'top' as const,
      },
      decimation: {
        enabled: true,
        algorithm: 'lttb' as const,
        samples: 50
      },
      zoom: {
        limits: {
          x: {minRange: 1},
          y: {minRange: 1}
        },
        pan: {
          enabled: true,
          mode: 'xy' as const,
          modifierKey: undefined,
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
          mode: 'xy' as const,
          speed: 0.1,
        },
      }
    },
  };

  // Format angle to degrees
  const formatAngle = (rad: number) => {
    return (rad * 180 / Math.PI).toFixed(1) + '°';
  };

  // Indicator showing if we're receiving messages
  const messageRate = messageCounter.current > 0 ? 
    <span className="text-xs ml-2 text-green-500">
      {`${messageCounter.current} msgs`}
    </span> : null;

  // Cập nhật UI để hiển thị thông báo khi đang trong chế độ firmware update
  if (firmwareUpdateMode) {
    return (
      <div className="flex flex-col h-full p-4">
        <WidgetConnectionHeader
          title="IMU Data Visualization"
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
              Dữ liệu IMU tạm thời không khả dụng trong quá trình cập nhật firmware.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <WidgetConnectionHeader
        title="IMU Data Visualization"
        status={status}
        isConnected={isConnected}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      
      <div className="flex gap-2 mb-4">
        <button
          onClick={requestIMUData}
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
          disabled={history.timestamps.length === 0}
          className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded-md flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 ml-auto"
        >
          <Download size={14} />
          <span>CSV</span>
        </button>
      </div>
      
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-4 rounded">
          <p className="font-medium">Error</p>
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* IMU Orientation Visualization */}
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium">Orientation Visualization</h3>
          </div>

          <div className="aspect-square w-full mb-3 bg-gray-50 rounded-lg">
            <SimpleYPRVisualizer 
              roll={imuData?.roll || 0}
              pitch={imuData?.pitch || 0}
              yaw={imuData?.yaw || 0}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-red-50 rounded">
              <div className="text-xs text-gray-500">Roll</div>
              <div className="font-bold">{formatAngle(imuData?.roll || 0)}</div>
            </div>
            <div className="p-2 bg-green-50 rounded">
              <div className="text-xs text-gray-500">Pitch</div>
              <div className="font-bold">{formatAngle(imuData?.pitch || 0)}</div>
            </div>
            <div className="p-2 bg-blue-50 rounded">
              <div className="text-xs text-gray-500">Yaw</div>
              <div className="font-bold">{formatAngle(imuData?.yaw || 0)}</div>
            </div>
          </div>
        </div>

        {/* Current IMU Data */}
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <h3 className="font-medium mb-3">Current IMU Data</h3>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-1">Quaternion</h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-gray-50 rounded">
                  <div className="text-xs text-gray-500">W</div>
                  <div className="font-medium">{imuData?.quat_w?.toFixed(3) || '1.000'}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded">
                  <div className="text-xs text-gray-500">X</div>
                  <div className="font-medium">{imuData?.quat_x?.toFixed(3) || '0.000'}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded">
                  <div className="text-xs text-gray-500">Y</div>
                  <div className="font-medium">{imuData?.quat_y?.toFixed(3) || '0.000'}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded">
                  <div className="text-xs text-gray-500">Z</div>
                  <div className="font-medium">{imuData?.quat_z?.toFixed(3) || '0.000'}</div>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500 text-center">
              Last Updated: {imuData?.timestamp ? new Date(imuData.timestamp * 1000).toLocaleString() : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* History Chart */}
      <div className="bg-white p-4 rounded-lg shadow border border-gray-200 flex-grow">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-medium">IMU Data History</h3>
          
          <div className="flex items-center gap-2">
            {/* Các nút chuyển đổi chế độ hiện tại */}
            <div className="inline-flex bg-gray-100 rounded-lg p-1">
              <button
                className={`px-3 py-1 rounded-md text-sm ${
                  activeChart === 'orientation'
                    ? 'bg-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setActiveChart('orientation')}
              >
                Orientation
              </button>
              <button
                className={`px-3 py-1 rounded-md text-sm ${
                  activeChart === 'quaternion'
                    ? 'bg-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setActiveChart('quaternion')}
              >
                Quaternion
              </button>
            </div>
            
            {/* Thêm các nút điều khiển zoom */}
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={resetZoom}
                className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600"
                title="Reset Zoom"
              >
                <RotateCcw size={16} />
              </button>
              <div className="text-xs text-gray-500">Zoom: Cuộn chuột | Kéo: Di chuyển</div>
            </div>
          </div>
        </div>

        <div style={{ height: '250px' }}>
          {history.timestamps.length > 0 ? (
            <Line 
            data={chartData} 
            options={chartOptions} 
            ref={chartRef} // Thay vì dùng callback function phức tạp
          />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400">
              No data available. Click the refresh button or enable live updates.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IMUWidget;