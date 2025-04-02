import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../services/WebSocketManager';
import { RefreshCw, Download, Calendar, ChevronDown, List, MapPin, Clock } from 'lucide-react';
import { useRobotContext } from './RobotContext';
import { Line } from 'react-chartjs-2';

interface TrajectoryRecord {
  id: number;
  timestamp: string;
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
}

const TrajectoryWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const { status, isConnected, connect, disconnect, sendMessage } = useWebSocket(`/ws/${selectedRobotId}` as any, {
    autoConnect: false,
    onMessage: (data) => handleWSMessage(data)
  });

  // State for trajectory data
  const [trajectoryHistory, setTrajectoryHistory] = useState<TrajectoryRecord[]>([]);
  const [selectedTrajectory, setSelectedTrajectory] = useState<TrajectoryRecord | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [timeFilter, setTimeFilter] = useState('24h'); // '24h', '7d', '30d', 'all'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Request trajectory history on component mount
  useEffect(() => {
    if (isConnected) {
      requestTrajectoryHistory();
    }
  }, [isConnected, timeFilter]);

  // Handle WebSocket messages
  const handleWSMessage = (data: any) => {
    if (data.type === 'trajectory_history') {
      if (data.trajectories && Array.isArray(data.trajectories)) {
        setTrajectoryHistory(data.trajectories);
        
        // Select the most recent trajectory if none is selected
        if (!selectedTrajectory && data.trajectories.length > 0) {
          setSelectedTrajectory(data.trajectories[0]);
        }
      }
      setLoading(false);
    } else if (data.type === 'error') {
      setError(data.message || 'Unknown error occurred');
      setLoading(false);
    }
  };

  // Request trajectory history
  const requestTrajectoryHistory = () => {
    if (!isConnected) return;
    
    setLoading(true);
    sendMessage({
      type: 'get_trajectory_history',
      robot_id: selectedRobotId,
      time_filter: timeFilter
    });
  };

  // Download the selected trajectory as CSV
  const downloadTrajectory = () => {
    if (!selectedTrajectory) return;

    // Create CSV content
    let csvContent = "X,Y,Theta\n";
    const { points } = selectedTrajectory;
    
    for (let i = 0; i < points.x.length; i++) {
      csvContent += `${points.x[i]},${points.y[i]},${points.theta[i]}\n`;
    }
    
    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date(selectedTrajectory.timestamp).toISOString().replace(/[:.]/g, '-');
    a.download = `trajectory_${selectedRobotId}_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  // For chart display
  const trajectoryChartData = {
    datasets: selectedTrajectory ? [
      {
        label: 'Quỹ đạo',
        data: selectedTrajectory.points.x.map((x, i) => ({ 
          x, 
          y: selectedTrajectory.points.y[i] 
        })),
        borderColor: 'rgba(54, 162, 235, 1)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        pointRadius: 1,
        showLine: true,
        borderWidth: 2,
      },
      // End point
      {
        label: 'Điểm cuối',
        data: [{ 
          x: selectedTrajectory.currentPosition.x, 
          y: selectedTrajectory.currentPosition.y 
        }],
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: 'rgba(255, 99, 132, 1)',
        pointRadius: 6,
        pointStyle: 'triangle',
        rotation: selectedTrajectory.currentPosition.theta * 180 / Math.PI,
      }
    ] : [],
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
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: function(context: any) {
            const point = context.raw;
            return `(X: ${point.x.toFixed(2)}, Y: ${point.y.toFixed(2)})`;
          }
        }
      },
      legend: {
        position: 'top' as const,
      },
    }
  };

  // Time filter options
  const timeFilterOptions = [
    { value: '24h', label: '24 giờ qua' },
    { value: '7d', label: '7 ngày qua' },
    { value: '30d', label: '30 ngày qua' },
    { value: 'all', label: 'Tất cả' }
  ];

  // Get trajectory stats
  const getTrajectoryStats = () => {
    if (!selectedTrajectory) return { distance: 0, duration: 0, points: 0 };
    
    // Calculate total distance
    let distance = 0;
    const { x, y } = selectedTrajectory.points;
    for (let i = 1; i < x.length; i++) {
      const dx = x[i] - x[i-1];
      const dy = y[i] - y[i-1];
      distance += Math.sqrt(dx*dx + dy*dy);
    }
    
    // Number of points
    const points = x.length;
    
    return { 
      distance: distance.toFixed(2),
      points
    };
  };

  const stats = getTrajectoryStats();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            status === 'connected' ? 'bg-green-500' : 
            status === 'connecting' ? 'bg-yellow-500' : 
            'bg-gray-400'
          }`}></div>
          <h3 className="text-lg font-medium">Lịch sử Quỹ Đạo</h3>
        </div>
        
        <div className="flex items-center gap-2">
          {!isConnected ? (
            <button 
              onClick={connect}
              disabled={status === 'connecting'}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-blue-300"
            >
              {status === 'connecting' ? 'Đang kết nối...' : 'Kết nối'}
            </button>
          ) : (
            <button 
              onClick={disconnect}
              className="px-3 py-1 bg-gray-200 text-gray-800 text-sm rounded hover:bg-gray-300"
            >
              Ngắt kết nối
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <button 
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 flex items-center gap-1"
          >
            <List size={16} />
            <span>Danh sách quỹ đạo</span>
            <ChevronDown size={16} className={isHistoryOpen ? "transform rotate-180" : ""} />
          </button>
          {isHistoryOpen && (
            <div className="absolute top-full left-0 mt-1 w-80 max-h-80 overflow-y-auto z-10 bg-white shadow-lg border rounded-md">
              {trajectoryHistory.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {trajectoryHistory.map((trajectory) => (
                    <div 
                      key={trajectory.id} 
                      className={`p-3 hover:bg-gray-50 cursor-pointer flex justify-between ${
                        selectedTrajectory?.id === trajectory.id ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => {
                        setSelectedTrajectory(trajectory);
                        setIsHistoryOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-gray-500" />
                        <span>{formatDate(trajectory.timestamp)}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {trajectory.points.x.length} điểm
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">Không có dữ liệu quỹ đạo</div>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-50 text-gray-800 rounded-md border border-gray-200 appearance-none pr-8"
          >
            {timeFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Calendar size={16} className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>

        <button
          onClick={requestTrajectoryHistory}
          disabled={!isConnected || loading}
          className="px-3 py-1.5 bg-blue-100 text-blue-600 rounded-md hover:bg-blue-200 disabled:opacity-50 flex items-center gap-1"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span>Làm mới</span>
        </button>

        {selectedTrajectory && (
          <button
            onClick={downloadTrajectory}
            className="px-3 py-1.5 bg-green-100 text-green-600 rounded-md hover:bg-green-200 ml-auto flex items-center gap-1"
          >
            <Download size={16} />
            <span>Tải xuống CSV</span>
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 mb-4 rounded-md">
          <p>{error}</p>
        </div>
      )}

      {/* Selected Trajectory Information */}
      {selectedTrajectory && (
        <div className="mb-4 bg-gray-50 p-3 rounded-md">
          <div className="flex flex-wrap justify-between items-center">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-gray-600">
                <Clock size={14} />
                <span className="text-sm">Thời gian: {formatDate(selectedTrajectory.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-600">
                <MapPin size={14} />
                <span className="text-sm">Điểm cuối: 
                  ({selectedTrajectory.currentPosition.x.toFixed(2)}, 
                  {selectedTrajectory.currentPosition.y.toFixed(2)}, 
                  {selectedTrajectory.currentPosition.theta.toFixed(2)} rad)
                </span>
              </div>
            </div>
            <div className="flex gap-4 text-center">
              <div>
                <div className="text-sm text-gray-500">Khoảng cách</div>
                <div className="font-semibold">{stats.distance} m</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Số điểm</div>
                <div className="font-semibold">{stats.points}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart Display */}
      <div className="flex-grow" style={{ minHeight: '300px' }}>
        {selectedTrajectory ? (
          <Line data={trajectoryChartData} options={trajectoryChartOptions} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <MapPin size={32} strokeWidth={1} />
            <p>Chọn một quỹ đạo để xem</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrajectoryWidget;