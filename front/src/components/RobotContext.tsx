import React, { createContext, useContext, useState } from "react";

interface RobotContextType {
  selectedRobotId: string;
  setSelectedRobotId: (id: string) => void;
}

const RobotContext = createContext<RobotContextType | null>(null);

export const useRobotContext = () => {
  const context = useContext(RobotContext);
  if (!context) {
    throw new Error("useRobotContext must be used within a RobotProvider");
  }
  return context;
};

export const RobotProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [selectedRobotId, setSelectedRobotId] = useState<string>("robot1");
  
  return (
    <RobotContext.Provider value={{ selectedRobotId, setSelectedRobotId }}>
      {children}
    </RobotContext.Provider>
  );
};