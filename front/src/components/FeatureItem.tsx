import React, { useRef, useState } from "react";
import { useDrag } from "react-dnd";

interface FeatureItemProps {
  widgetType: string;
  children?: React.ReactNode;
}

interface DragItem {
  type: string;
  onDrop: () => void;
}

const FeatureItem: React.FC<FeatureItemProps> = ({ widgetType, children }) => {
  const motionRef = useRef<HTMLDivElement | null>(null);
  const [isDropped, setIsDropped] = useState<boolean>(false);
  
  const [{ isDragging }, dragRef] = useDrag<DragItem, unknown, { isDragging: boolean }>(() => ({
    type: "WIDGET",
    item: { 
      type: widgetType, 
      onDrop: () => setIsDropped(true) 
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  const combinedRef = (node: HTMLDivElement | null) => {
    if (node) {
      motionRef.current = node;
      dragRef(node);
    }
  };

  return (
    <div
      ref={combinedRef}
      className={`bg-blue-600 text-white p-4 rounded-lg shadow-lg cursor-pointer text-center font-semibold transition-transform duration-200 hover:bg-blue-500 ${
        isDropped ? "flex flex-col flex-grow min-w-[500px] min-h-[250px]" : "scale-100"
      }`}
    >
      {widgetType}
      {children}
    </div>
  );
};

export default FeatureItem;
