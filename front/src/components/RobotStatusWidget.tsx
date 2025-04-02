import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../services/WebSocketManager';
import { RefreshCw, Activity, Gauge, Download, RotateCcw, Play, Pause } from 'lucide-react';
import WidgetConnectionHeader from './WidgetConnectionHeader';
import Chart from 'chart.js/auto';
import { useRobotContext } from './RobotContext';
import { Line } from 'react-chartjs-2';

// Định nghĩa kiểu dữ liệu
interface RobotStatus {
  connected: boolean;
  lastUpdate: Date | null;
  encoders: {
    values: number[];  // Hoặc có thể đổi tên thành rpm
    rpm: number[];
  };
  pid: {
    motor1: { kp: number; ki: number; kd: number };
    motor2: { kp: number; ki: number; kd: number };
    motor3: { kp: number; ki: number; kd: number };
  };
  position: {
    x: number;
    y: number;
    theta: number;
  };
  battery: {
    voltage: number;
    percent: number;
  };
}

// Cập nhật interface Trajectory để phù hợp với TrajectoryData
interface Trajectory {
  currentPosition: {
    x: number;
    y: number;
    theta: number;
  };
  points: {
    x: number[];
    y: number[];
    theta: number[];
  };
  status: string;
  progress_percent: number;
}

// Khởi tạo trạng thái robot mặc định
const defaultStatus: RobotStatus = {
  connected: false,
  lastUpdate: null,
  encoders: {
    values: [0, 0, 0],
    rpm: [0, 0, 0],
  },
  pid: {
    motor1: { kp: 0, ki: 0, kd: 0 },
    motor2: { kp: 0, ki: 0, kd: 0 },
    motor3: { kp: 0, ki: 0, kd: 0 },
  },
  position: {
    x: 0,
    y: 0,
    theta: 0,
  },
  battery: {
    voltage: 0,
    percent: 0,
  },
};

const RobotStatusWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const { status: wsStatus, isConnected, connect, disconnect, sendMessage } = useWebSocket(`/ws/${selectedRobotId}` as any, {
    autoConnect: false,
    onMessage: (data) => handleWSMessage(data)
  });

  // State cho dữ liệu
  const [robotStatus, setRobotStatus] = useState<RobotStatus>(defaultStatus);
  const [trajectoryData, setTrajectoryData] = useState<{x: number[], y: number[]}>({ x: [], y: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveUpdate, setLiveUpdate] = useState(false);
  const [rpmHistory, setRpmHistory] = useState<{time: number[], motor1: number[], motor2: number[], motor3: number[]}>({
    time: [],
    motor1: [],
    motor2: [],
    motor3: [],
  });

  // Add this new state for trajectory data that matches our new structure
  const [trajectory, setTrajectory] = useState<Trajectory>({
    currentPosition: { x: 0, y: 0, theta: 0 },
    points: { x: [0], y: [0], theta: [0] },
    status: 'unknown',
    progress_percent: 0
  });

  // Xử lý tin nhắn WebSocket
  const handleWSMessage = (data: any) => {
    if (data.type === 'robot_status' || data.type === 'initial_data') {
      setRobotStatus(prev => ({
        ...prev,
        connected: true,
        lastUpdate: new Date(),
        ...(data.status || {})
      }));

      // If status includes trajectory data, update our trajectory state
      if (data.status?.trajectory) {
        setTrajectory(data.status.trajectory);
      }

      // Cập nhật lịch sử RPM nếu có dữ liệu encoder
      if (data.status?.encoders?.rpm) {
        const now = Date.now();
        setRpmHistory(prev => {
          const newTime = [...prev.time, now];
          const newMotor1 = [...prev.motor1, data.status.encoders.rpm[0]];
          const newMotor2 = [...prev.motor2, data.status.encoders.rpm[1]];
          const newMotor3 = [...prev.motor3, data.status.encoders.rpm[2]];
          
          // Giới hạn số lượng điểm để hiệu suất tốt hơn
          const maxPoints = 100;
          if (newTime.length > maxPoints) {
            return {
              time: newTime.slice(-maxPoints),
              motor1: newMotor1.slice(-maxPoints),
              motor2: newMotor2.slice(-maxPoints),
              motor3: newMotor3.slice(-maxPoints),
            };
          }
          
          return {
            time: newTime,
            motor1: newMotor1,
            motor2: newMotor2,
            motor3: newMotor3,
          };
        });
      }

      setError(null);
    } else if (data.type === 'trajectory_data' || data.type === 'trajectory_update') {
      // Chuyển đổi dữ liệu cho phù hợp với định dạng mới
      const trajectory: Trajectory = {
        currentPosition: {
          x: data.current_x || 0,
          y: data.current_y || 0,
          theta: data.current_theta || 0
        },
        points: data.points || { x: [], y: [], theta: [] },
        status: data.status || 'unknown',
        progress_percent: data.progress_percent || 0
      };
      
      setTrajectory(trajectory);
      
      setLoading(false);
    } else if (data.type === 'error') {
      setError(data.message || 'Đã xảy ra lỗi không xác định');
      setLoading(false);
    }
  };

  // Yêu cầu dữ liệu trạng thái robot
  const requestRobotStatus = () => {
    if (!isConnected) return;
    
    setLoading(true);
    sendMessage({
      type: 'get_robot_status'
    });
  };

  // Yêu cầu dữ liệu quỹ đạo
  const requestTrajectoryData = () => {
    if (!isConnected) return;
    
    setLoading(true);
    sendMessage({
      type: 'get_trajectory'
    });
  };

  // Xóa dữ liệu quỹ đạo hiện tại
  const clearTrajectory = () => {
    setTrajectoryData({ x: [], y: [] });
  };

  // Bật/tắt cập nhật trực tiếp
  const toggleLiveUpdate = () => {
    const newLiveUpdate = !liveUpdate;
    setLiveUpdate(newLiveUpdate);
    
    if (isConnected) {
      sendMessage({
        type: newLiveUpdate ? 'subscribe_trajectory' : 'unsubscribe_trajectory'
      });
    }
  };

  // Đặt lại tất cả dữ liệu
  const resetData = () => {
    setRobotStatus(defaultStatus);
    setTrajectoryData({ x: [], y: [] });
    setRpmHistory({
      time: [],
      motor1: [],
      motor2: [],
      motor3: [],
    });
  };

  // Yêu cầu dữ liệu ban đầu khi kết nối thành công
  useEffect(() => {
    if (isConnected) {
      requestRobotStatus();
      requestTrajectoryData();
    }
  }, [isConnected]);

  // Định cấu hình biểu đồ RPM
  const rpmChartData = {
    labels: rpmHistory.time.map(t => new Date(t).toLocaleTimeString()),
    datasets: [
      {
        label: 'Motor 1',
        data: rpmHistory.motor1,
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        pointRadius: 0,
        borderWidth: 1,
      },
      {
        label: 'Motor 2',
        data: rpmHistory.motor2,
        borderColor: 'rgba(54, 162, 235, 1)', 
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        pointRadius: 0,
        borderWidth: 1,
      },
      {
        label: 'Motor 3',
        data: rpmHistory.motor3,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        pointRadius: 0,
        borderWidth: 1,
      },
    ],
  };

  // Định cấu hình biểu đồ quỹ đạo
  const trajectoryChartData = {
    datasets: [
      {
        label: 'Quỹ đạo',
        data: trajectory.points.x.map((x, i) => ({ 
          x, 
          y: trajectory.points.y[i] 
        })),
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        pointRadius: 2,
        showLine: true,
      },
      // Thêm điểm hiện tại của robot
      {
        label: 'Vị trí hiện tại',
        data: [{ 
          x: trajectory.currentPosition.x, 
          y: trajectory.currentPosition.y 
        }],
        borderColor: 'rgba(255, 0, 0, 1)',
        backgroundColor: 'rgba(255, 0, 0, 1)',
        pointRadius: 5,
        pointStyle: 'triangle',
        rotation: trajectory.currentPosition.theta * 180 / Math.PI, // Rotate triangle to match theta
      }
    ],
  };

  const trajectoryChartOptions = {
    scales: {
      x: {
        type: 'linear' as const,
        position: 'bottom' as const,
        title: {
          display: true,
          text: 'X (m)'
        }
      },
      y: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Y (m)'
        }
      }
    },
    aspectRatio: 1,
    plugins: {
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const point = context.raw;
            return `(X: ${point.x.toFixed(2)}, Y: ${point.y.toFixed(2)})`;
          }
        }
      }
    }
  };

  const rpmChartOptions = {
    scales: {
      x: {
        title: {
          display: true,
          text: 'Thời gian'
        },
        ticks: {
          maxTicksLimit: 5,
        }
      },
      y: {
        title: {
          display: true,
          text: 'RPM'
        },
        beginAtZero: true
      }
    },
    animation: false as const,
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
    },
    maintainAspectRatio: false
  };

  // Tải lại dữ liệu tự động nếu đang bật live update
  useEffect(() => {
    if (liveUpdate && isConnected) {
      const interval = setInterval(() => {
        requestRobotStatus();
      }, 500); // Cập nhật mỗi 500ms
      
      return () => clearInterval(interval);
    }
  }, [liveUpdate, isConnected]);

  // Tải xuống dữ liệu quỹ đạo dưới dạng CSV
  const downloadTrajectoryData = () => {
    if (!trajectoryData.x.length) return;

    const csvData = trajectoryData.x.map((x, i) => 
      `${x},${trajectoryData.y[i]}`
    ).join('\n');
    
    const blob = new Blob([`X,Y\n${csvData}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `trajectory_${selectedRobotId}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Add a function to reset the robot position
  const resetRobotPosition = () => {
    if (!isConnected) return;
    
    sendMessage({
      type: 'reset_position',
      robot_id: selectedRobotId
    });
    
    // Request updated trajectory data after reset
    setTimeout(() => {
      requestTrajectoryData();
    }, 500);
  };

  return (
    <div className="flex flex-col gap-4">
      <WidgetConnectionHeader 
        title="Trạng thái Robot" 
        status={wsStatus}
        isConnected={isConnected}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 rounded">
          <p className="font-medium">Lỗi</p>
          <p>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Thông tin Trạng Thái */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium">Thông tin Robot</h3>
            <button 
              onClick={requestRobotStatus}
              disabled={!isConnected || loading}
              className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">Kết nối:</span>
              <span className={`font-medium ${robotStatus.connected ? "text-green-600" : "text-red-600"}`}>
                {robotStatus.connected ? "Đã kết nối" : "Ngắt kết nối"}
              </span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-500">Cập nhật:</span>
              <span className="font-medium">
                {robotStatus.lastUpdate ? new Date(robotStatus.lastUpdate).toLocaleTimeString() : "N/A"}
              </span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-500">Pin:</span>
              <span className="font-medium">
                {robotStatus.battery.voltage.toFixed(1)}V ({robotStatus.battery.percent.toFixed(0)}%)
              </span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-500">Vị trí:</span>
              <span className="font-medium">
                X: {robotStatus.position.x.toFixed(2)}m, 
                Y: {robotStatus.position.y.toFixed(2)}m
              </span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-500">Hướng:</span>
              <span className="font-medium">
                {(robotStatus.position.theta * 180 / Math.PI).toFixed(1)}°
              </span>
            </div>
          </div>
        </div>

        {/* Thông tin Encoder và RPM */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium mb-4">RPM Bánh Xe</h3>
          
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="p-3 bg-blue-50 rounded-lg text-center">
              <div className="text-xs text-gray-500 mb-1">Motor 1</div>
              <div className="text-xl font-bold">{robotStatus.encoders.rpm[0]?.toFixed(0)}</div>
              <div className="text-xs text-gray-500">RPM</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg text-center">
              <div className="text-xs text-gray-500 mb-1">Motor 2</div>
              <div className="text-xl font-bold">{robotStatus.encoders.rpm[1]?.toFixed(0)}</div>
              <div className="text-xs text-gray-500">RPM</div>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg text-center">
              <div className="text-xs text-gray-500 mb-1">Motor 3</div>
              <div className="text-xl font-bold">{robotStatus.encoders.rpm[2]?.toFixed(0)}</div>
              <div className="text-xs text-gray-500">RPM</div>
            </div>
          </div>
        </div>
      </div>

      {/* Biểu đồ RPM */}
      <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Lịch sử RPM</h3>
          <div className="flex gap-2">
            <button
              onClick={toggleLiveUpdate}
              className={`p-2 rounded-full ${liveUpdate 
                ? "bg-green-100 text-green-600 hover:bg-green-200" 
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {liveUpdate ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => setRpmHistory({ time: [], motor1: [], motor2: [], motor3: [] })}
              className="p-2 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
        
        <div className="h-60">
          <Line data={rpmChartData} options={rpmChartOptions} />
        </div>
      </div>

      {/* Biểu đồ Quỹ Đạo */}
      <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Quỹ đạo Robot</h3>
          <div className="flex gap-2">
            <button
              onClick={requestTrajectoryData}
              disabled={!isConnected || loading}
              className="p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 disabled:opacity-50"
              title="Cập nhật quỹ đạo"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={resetRobotPosition}
              disabled={!isConnected}
              className="p-2 bg-yellow-100 text-yellow-600 rounded-full hover:bg-yellow-200 disabled:opacity-50"
              title="Đặt lại vị trí robot về (0,0,0)"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={downloadTrajectoryData}
              disabled={trajectory.points.x.length === 0}
              className="p-2 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 disabled:opacity-50"
              title="Tải xuống dữ liệu quỹ đạo dưới dạng CSV"
            >
              <Download size={16} />
            </button>
          </div>
        </div>
        
        <div className="flex flex-col">
          <div className="flex justify-between mb-2">
            <div className="text-sm space-x-4">
              <span>X: <strong>{trajectory.currentPosition.x.toFixed(2)} m</strong></span>
              <span>Y: <strong>{trajectory.currentPosition.y.toFixed(2)} m</strong></span>
              <span>θ: <strong>{trajectory.currentPosition.theta.toFixed(2)} rad</strong></span>
            </div>
            <div className="text-sm text-gray-500">
              {trajectory.points.x.length} điểm
            </div>
          </div>

          {trajectory.points.x.length ? (
            <div style={{ height: '300px', width: '100%' }}>
              <Line data={trajectoryChartData} options={trajectoryChartOptions} />
            </div>
          ) : (
            <div className="h-[300px] w-full flex items-center justify-center text-gray-400">
              Không có dữ liệu quỹ đạo
            </div>
          )}
        </div>
      </div>

      {/* Thông tin PID */}
      <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
        <h3 className="text-lg font-medium mb-4">Thông số PID</h3>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="border rounded-lg p-3">
            <div className="text-center font-medium mb-2">Motor 1</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Kp:</span>
                <span className="font-mono">{robotStatus.pid.motor1.kp.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ki:</span>
                <span className="font-mono">{robotStatus.pid.motor1.ki.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kd:</span>
                <span className="font-mono">{robotStatus.pid.motor1.kd.toFixed(4)}</span>
              </div>
            </div>
          </div>
          
          <div className="border rounded-lg p-3">
            <div className="text-center font-medium mb-2">Motor 2</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Kp:</span>
                <span className="font-mono">{robotStatus.pid.motor2.kp.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ki:</span>
                <span className="font-mono">{robotStatus.pid.motor2.ki.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kd:</span>
                <span className="font-mono">{robotStatus.pid.motor2.kd.toFixed(4)}</span>
              </div>
            </div>
          </div>
          
          <div className="border rounded-lg p-3">
            <div className="text-center font-medium mb-2">Motor 3</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Kp:</span>
                <span className="font-mono">{robotStatus.pid.motor3.kp.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ki:</span>
                <span className="font-mono">{robotStatus.pid.motor3.ki.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kd:</span>
                <span className="font-mono">{robotStatus.pid.motor3.kd.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RobotStatusWidget;