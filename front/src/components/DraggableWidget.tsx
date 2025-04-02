import React, { useRef, useEffect } from "react";
import { useDrag } from "react-dnd";

// Interface phù hợp với WidgetOption từ App.tsx
interface WidgetOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: "control" | "monitoring" | "configuration";
}

interface DraggableWidgetProps {
  id: string;
  widget: WidgetOption;
  collapsed: boolean;
}

const DraggableWidget: React.FC<DraggableWidgetProps> = ({ id, widget, collapsed }) => {
  // Sử dụng hook useDrag từ react-dnd
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'WIDGET',
    item: { id: widget.id, type: widget.id },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }));

  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (nodeRef.current) {
      drag(nodeRef.current);
    }
  }, [drag]);

  return (
    <div 
      ref={nodeRef} // Sửa lỗi ở đây - sử dụng ref trực tiếp
      className={`bg-white border border-gray-200 rounded-md p-2 
                 hover:border-blue-400 hover:shadow-sm cursor-move transition-all 
                 select-none ${isDragging ? 'opacity-50' : 'opacity-100'}`}
      style={{
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isDragging ? '0 0 10px rgba(0, 0, 0, 0.2)' : 'none',
        transform: isDragging ? 'scale(1.05)' : 'scale(1)'
      }}
    >
      <div className="flex items-center gap-2">
        <div className="text-blue-600">
          {widget.icon}
        </div>
        {!collapsed && (
          <div>
            <h4 className="font-medium text-sm">{widget.name}</h4>
            <p className="text-xs text-gray-500 line-clamp-1">{widget.description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DraggableWidget;