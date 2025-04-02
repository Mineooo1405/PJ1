import React, { useEffect, useState } from "react";

interface ConnectionStatus {
  status: string;
  active_connections: {
    robot1: number;
    robot2: number;
    robot3: number;
    robot4: number;
    server: number;
  }
}

const ConnectionStatusWidget: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchStatus = async () => {
    try {
      const host = window.location.hostname;
      const response = await fetch(`http://${host}:8000/api/connection-status`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const data = await response.json();
      setStatus(data);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      console.error("Error fetching connection status:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 bg-white rounded-2xl shadow-lg">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-lg">Connection Status</h3>
        <button 
          onClick={fetchStatus}
          className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
        >
          Refresh
        </button>
      </div>
      
      {error ? (
        <div className="bg-red-100 text-red-700 p-3 rounded-md mb-3">
          Error connecting to backend: {error}
        </div>
      ) : status ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-3 h-3 rounded-full ${status.status === "running" ? "bg-green-500" : "bg-red-500"}`}></div>
            <span className="font-medium">Backend Status: {status.status}</span>
            <span className="text-xs text-gray-500 ml-auto">Last updated: {lastUpdated}</span>
          </div>
          
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Endpoint</th>
                <th className="p-2 text-left">Active Connections</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(status.active_connections).map(([endpoint, count]) => (
                <tr key={endpoint} className="border-t">
                  <td className="p-2 font-mono">/ws{endpoint === "general" ? "" : "/" + endpoint}</td>
                  <td className="p-2">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <div className="text-center p-4">Loading connection status...</div>
      )}
      
      <div className="mt-3 text-sm text-gray-500">
        <p>This widget helps diagnose WebSocket connection issues between your frontend and backend.</p>
      </div>
    </div>
  );
};

export default ConnectionStatusWidget;