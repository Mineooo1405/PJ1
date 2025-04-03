import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Play, Pause, RotateCcw, Download, ZoomIn, ZoomOut, Move } from 'lucide-react';
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
const MAX_HISTORY_POINTS = 100;
const UI_UPDATE_INTERVAL = 50; // Reduce to 50ms for more responsive UI
const CHART_SAMPLING_RATE = 1; // Set to 1 to update chart with every data point
const DATABASE_POLL_INTERVAL = 100; // More frequent polling (100ms instead of 200ms)

// Get WebSocket URL for FastAPI backend
const getWebSocketUrl = (robotId: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Force localhost:8000 which is where your FastAPI backend is running
  return `${protocol}//localhost:8000/ws/${robotId}`;
};

interface EncoderData {
  rpm_1: number;
  rpm_2: number;
  rpm_3: number;
  timestamp: string | number;
}

const EncoderDataWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  
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
  
  // Process any buffered messages and update the UI
  const processMessageBuffer = useCallback(() => {
    // Cancel any pending animation frame
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    
    // Process all messages in buffer (not just the last one)
    if (messageBuffer.current.length === 0) {
      return;
    }
    
    // Get and process all messages - this is important for faster updates
    const messages = [...messageBuffer.current];
    messageBuffer.current = []; // Clear buffer
    
    // Process each message in sequence
    for (const message of messages) {
      if (message.type === 'encoder_data') {
        const encoderValues = {
          rpm_1: typeof message.rpm_1 === 'number' ? message.rpm_1 : 0,
          rpm_2: typeof message.rpm_2 === 'number' ? message.rpm_2 : 0,
          rpm_3: typeof message.rpm_3 === 'number' ? message.rpm_3 : 0,
          timestamp: message.timestamp || Date.now()
        };
        
        // Use the latest values for current display
        if (message === messages[messages.length - 1]) {
          setEncoderData(encoderValues);
          setRpmValues([encoderValues.rpm_1, encoderValues.rpm_2, encoderValues.rpm_3]);
        }
        
        // Add to chart history - this adds every point for more complete charts
        setEncoderHistory(prev => {
          const newTimestamps = [...prev.timestamps, getTimeString()];
          const newEncoder1 = [...prev.encoder1, encoderValues.rpm_1];
          const newEncoder2 = [...prev.encoder2, encoderValues.rpm_2];
          const newEncoder3 = [...prev.encoder3, encoderValues.rpm_3];
          
          // Limit the number of points
          if (newTimestamps.length > MAX_HISTORY_POINTS) {
            return {
              timestamps: newTimestamps.slice(-MAX_HISTORY_POINTS),
              encoder1: newEncoder1.slice(-MAX_HISTORY_POINTS),
              encoder2: newEncoder2.slice(-MAX_HISTORY_POINTS),
              encoder3: newEncoder3.slice(-MAX_HISTORY_POINTS)
            };
          }
          
          return {
            timestamps: newTimestamps,
            encoder1: newEncoder1,
            encoder2: newEncoder2,
            encoder3: newEncoder3
          };
        });
      }
    }
    
    lastUIUpdateTime.current = Date.now();
  }, []);

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
    
    newSocket.onopen = () => {
      console.log(`Connected to backend WebSocket for robot ${selectedRobotId}`);
      setStatus('connected');
      setIsConnected(true);
      setError(null);
      
      // Start live updates automatically
      setTimeout(() => {
        console.log('Starting live updates automatically');
        setLiveUpdate(true);
        sendMessage({
          type: "subscribe_encoder"
        });
        
        // Start polling for database updates
        if (databasePollInterval.current === null) {
          console.log('Starting database polling');
          databasePollInterval.current = setInterval(() => {
            if (isConnected) {
              console.log(`Polling for new data since ${new Date(lastDataTimestamp.current * 1000).toISOString()}`);
              sendMessage({
                type: "get_encoder_data_since", // This is the message type your backend should handle
                since: lastDataTimestamp.current
              });
            }
          }, DATABASE_POLL_INTERVAL);
        }
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

    newSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Received WebSocket data:", data);
        
        if (data.type === 'encoder_data') {
          // Handle field name differences (rpm_1 vs rpm1)
          const values = {
            rpm_1: data.rpm_1 !== undefined ? data.rpm_1 : 
                   (data.rpm1 !== undefined ? data.rpm1 : 0),
            rpm_2: data.rpm_2 !== undefined ? data.rpm_2 : 
                   (data.rpm2 !== undefined ? data.rpm2 : 0),
            rpm_3: data.rpm_3 !== undefined ? data.rpm_3 : 
                   (data.rpm3 !== undefined ? data.rpm3 : 0),
            timestamp: data.timestamp || Date.now() / 1000
          };
          
          // Update last timestamp for polling
          if (values.timestamp > lastDataTimestamp.current) {
            lastDataTimestamp.current = values.timestamp;
            console.log(`Updated lastDataTimestamp to ${new Date(lastDataTimestamp.current * 1000).toISOString()}`);
          }
          
          // Update message buffer
          messageBuffer.current.push({
            type: 'encoder_data',
            rpm_1: values.rpm_1,
            rpm_2: values.rpm_2,
            rpm_3: values.rpm_3,
            timestamp: values.timestamp
          });
          
          // Clear loading state
          if (loading) {
            setLoading(false);
          }
          
          // Schedule UI update
          scheduleUIUpdate();
        } else if (data.type === 'error') {
          setError(data.message || "An error occurred while receiving encoder data");
          setLoading(false);
        } else if (data.type === 'info') {
          // Just log info messages
          console.log("Info from server:", data.message);
        } else {
          console.log("Unhandled message type:", data);
        }
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
          console.log(`Subscribing to encoder updates for robot ${selectedRobotId}`);
          sendMessage({
            type: "subscribe_encoder"  // Subscribe command
          });
          
          // Reset counters when starting live updates
          messageCounter.current = 0;
        } else {
          console.log(`Unsubscribing from encoder updates for robot ${selectedRobotId}`);
          sendMessage({
            type: "unsubscribe_encoder"  // Unsubscribe command
          });
        }
      }

      return newValue;
    });
  }, [isConnected, sendMessage, selectedRobotId]);

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
        tension: 0.2 // Slight smoothing for better visuals
      },
      point: {
        radius: 2, // Default point size
        hitRadius: 10, // Larger hit area for interaction
        hoverRadius: 5, // Size when hovering
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
              <span>Live: ON</span>
              {messageRate}
            </>
          ) : (
            <>
              <Play size={14} />
              <span>Live: OFF</span>
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