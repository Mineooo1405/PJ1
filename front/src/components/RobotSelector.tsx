import React from "react";
import { useRobotContext } from "./RobotContext";

// Component selector
const RobotSelector: React.FC = () => {
  const { selectedRobotId, setSelectedRobotId } = useRobotContext();
  
  const robots = [
    { id: "robot1", name: "Robot 1" },
    { id: "robot2", name: "Robot 2" },
    { id: "robot3", name: "Robot 3" },
    { id: "robot4", name: "Robot 4" }
  ];
  
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Selected Robot:
      </label>
      <select
        value={selectedRobotId}
        onChange={(e) => setSelectedRobotId(e.target.value)}
        className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
      >
        {robots.map(robot => (
          <option key={robot.id} value={robot.id}>
            {robot.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default RobotSelector;