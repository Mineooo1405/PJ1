import React, { useState, useCallback, useRef, useEffect } from "react";
import WidgetConnectionHeader from "./WidgetConnectionHeader";
import { RotateCcw, AlertCircle, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCw, RotateCcw as RotateCounter } from 'lucide-react';
import tcpWebSocketService from '../services/TcpWebSocketService';
import { useRobotContext } from './RobotContext';

interface RPMData {
  [key: number]: number; // motor_id -> RPM value
}

// Định nghĩa kiểu dữ liệu cho messages WebSocket
type WebSocketMessage = {
  type: string;
  rpm?: RPMData | number[];
  status?: string;
  message?: string;
  [key: string]: any;
};

// Định nghĩa keys cho điều khiển bàn phím
type KeysPressed = {
  w: boolean; // Tiến
  a: boolean; // Rẽ trái
  s: boolean; // Lùi
  d: boolean; // Rẽ phải
  q: boolean; // Xoay trái
  e: boolean; // Xoay phải
};

const RobotControlWidget: React.FC = () => {
  const { selectedRobotId } = useRobotContext();
  const [motorSpeeds, setMotorSpeeds] = useState<number[]>([0, 0, 0]);
  const [rpmValues, setRpmValues] = useState<RPMData>({1: 0, 2: 0, 3: 0});
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'joystick' | 'motors' | 'keyboard'>('keyboard'); // Mặc định chọn keyboard
  const [velocities, setVelocities] = useState({ x: 0, y: 0, theta: 0 });
  const [maxSpeed, setMaxSpeed] = useState(1.0); // m/s
  const [maxAngular, setMaxAngular] = useState(2.0); // rad/s
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [keysPressed, setKeysPressed] = useState<KeysPressed>({ w: false, a: false, s: false, d: false, q: false, e: false });
  const [hasFocus, setHasFocus] = useState(false);
  
  // Refs for joystick control
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const rotationKnobRef = useRef<HTMLDivElement>(null);
  const keyboardControlRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isRotatingRef = useRef(false);
  const prevVelocitiesRef = useRef({ x: 0, y: 0, theta: 0 });
  
  // TCP WebSocket Connection
  useEffect(() => {
    // Handle connection status changes
    const handleConnectionChange = (connected: boolean) => {
      setIsConnected(connected);
      setStatus(connected ? 'connected' : 'disconnected');
      
      if (connected) {
        // Request initial data when first connected
        tcpWebSocketService.sendMessage({
          type: "get_motor_data",
          robot_id: selectedRobotId,
          frontend: true,
          timestamp: Date.now() / 1000
        });
      }
    };
    
    // Register for connection status changes
    tcpWebSocketService.onConnectionChange(handleConnectionChange);
    
    // Handle incoming messages
    const handleMessage = (message: any) => {
      try {
        if (message.type === "motor_data" && message.rpm) {
          setRpmValues(typeof message.rpm === 'object' ? message.rpm : 
            Array.isArray(message.rpm) ? {1: message.rpm[0] || 0, 2: message.rpm[1] || 0, 3: message.rpm[2] || 0} : 
            rpmValues);
        } else if (message.type === "error") {
          setErrorMessage(message.message || "An error occurred");
          setTimeout(() => setErrorMessage(""), 5000);
        }
      } catch (e) {
        console.error("Error processing message", e);
      }
    };
    
    // Register for message events
    tcpWebSocketService.onMessage("motor_data", handleMessage);
    tcpWebSocketService.onMessage("error", handleMessage);
    
    // Connect to TCP server if not already connected
    if (!tcpWebSocketService.isConnected()) {
      connect();
    } else {
      setIsConnected(true);
      setStatus('connected');
    }
    
    // Cleanup on unmount
    return () => {
      tcpWebSocketService.offConnectionChange(handleConnectionChange);
      tcpWebSocketService.offMessage("motor_data", handleMessage);
      tcpWebSocketService.offMessage("error", handleMessage);
    };
  }, [selectedRobotId]);

  // Connection functions
  const connect = () => {
    setStatus('connecting');
    tcpWebSocketService.connect();
  };
  
  const disconnect = () => {
    tcpWebSocketService.disconnect();
    setStatus('disconnected');
  };

  // Cập nhật vận tốc và gửi lệnh điều khiển
  const updateVelocities = useCallback((x: number, y: number, theta: number) => {
    const newVelocities = {
      x: parseFloat(x.toFixed(2)),
      y: parseFloat(y.toFixed(2)),
      theta: parseFloat(theta.toFixed(2))
    };
    
    // Cập nhật state
    setVelocities(newVelocities);
    
    // Kiểm tra nếu giá trị đã thay đổi đáng kể
    const hasSignificantChange = 
      Math.abs(newVelocities.x - prevVelocitiesRef.current.x) > 0.05 ||
      Math.abs(newVelocities.y - prevVelocitiesRef.current.y) > 0.05 ||
      Math.abs(newVelocities.theta - prevVelocitiesRef.current.theta) > 0.05;
    
    if (hasSignificantChange && isConnected) {
      prevVelocitiesRef.current = newVelocities;
      
      // Gửi lệnh điều khiển qua TCP
      tcpWebSocketService.sendMessage({
        type: "motor_control", // Thay đổi thành motor_control để khớp với handler trên server
        robot_id: selectedRobotId,
        velocities: newVelocities,
        frontend: true, // Thêm trường frontend
        timestamp: Date.now() / 1000
      });
    }
  }, [isConnected, selectedRobotId]);

  // Xử lý joystick control
  useEffect(() => {
    const joystick = joystickRef.current;
    const knob = knobRef.current;
    const rotationKnob = rotationKnobRef.current;
    
    if (!joystick || !knob || !rotationKnob) return;
    
    const getVelocitiesFromPosition = (x: number, y: number) => {
      // Tính toán tọa độ tương đối so với tâm joystick
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const relX = (x - centerX) / centerX; // -1 to 1
      const relY = -(y - centerY) / centerY; // -1 to 1 (đảo ngược trục y)
      
      // Giới hạn trong vòng tròn đơn vị
      const magnitude = Math.sqrt(relX * relX + relY * relY);
      let normX = relX;
      let normY = relY;
      
      if (magnitude > 1) {
        normX = relX / magnitude;
        normY = relY / magnitude;
      }
      
      // Chuyển đổi sang vận tốc robot
      const vx = normY * maxSpeed; // Phương tiến-lùi
      const vy = -normX * maxSpeed; // Phương trái-phải
      
      return { x: vx, y: vy };
    };
    
    // Mouse events for joystick
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      
      // Cập nhật vị trí knob
      const x = e.clientX - joystick.getBoundingClientRect().left;
      const y = e.clientY - joystick.getBoundingClientRect().top;
      
      const velocities = getVelocitiesFromPosition(x, y);
      updateVelocities(velocities.x, velocities.y, prevVelocitiesRef.current.theta);
      
      knob.style.transform = `translate(${x - knob.offsetWidth / 2}px, ${y - knob.offsetHeight / 2}px)`;
    };
    
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      
      // Cập nhật vị trí knob
      const x = e.clientX - joystick.getBoundingClientRect().left;
      const y = e.clientY - joystick.getBoundingClientRect().top;
      
      // Giới hạn trong vòng tròn joystick
      const centerX = joystick.offsetWidth / 2;
      const centerY = joystick.offsetHeight / 2;
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      const maxDistance = Math.min(joystick.offsetWidth, joystick.offsetHeight) / 2 - knob.offsetWidth / 2;
      
      let finalX = x;
      let finalY = y;
      
      if (distance > maxDistance) {
        const angle = Math.atan2(y - centerY, x - centerX);
        finalX = centerX + Math.cos(angle) * maxDistance;
        finalY = centerY + Math.sin(angle) * maxDistance;
      }
      
      const velocities = getVelocitiesFromPosition(finalX, finalY);
      updateVelocities(velocities.x, velocities.y, prevVelocitiesRef.current.theta);
      
      knob.style.transform = `translate(${finalX - knob.offsetWidth / 2}px, ${finalY - knob.offsetHeight / 2}px)`;
    };
    
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      
      // Reset knob về trung tâm
      knob.style.transform = `translate(-50%, -50%)`;
      
      // Reset vận tốc x,y về 0
      updateVelocities(0, 0, prevVelocitiesRef.current.theta);
    };
    
    // Rotation control events
    const getRotationVelocityFromPosition = (x: number) => {
      const rotationControl = rotationKnobRef.current;
      if (!rotationControl) return 0;
      
      const rect = rotationControl.getBoundingClientRect();
      const centerX = rect.width / 2;
      const relX = (x - centerX) / centerX; // -1 to 1
      
      // Limit to range -1 to 1
      const limitedX = Math.max(-1, Math.min(1, relX));
      
      // Convert to angular velocity
      return limitedX * maxAngular;
    };
    
    const onRotationMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isRotatingRef.current = true;
      
      const x = e.clientX - rotationKnob.getBoundingClientRect().left;
      const theta = getRotationVelocityFromPosition(x);
      
      updateVelocities(prevVelocitiesRef.current.x, prevVelocitiesRef.current.y, theta);
      
      const thumbWidth = 24; // Adjust based on your UI
      rotationKnob.querySelector('.thumb')?.setAttribute('style', 
        `left: ${x - thumbWidth/2}px`);
    };
    
    const onRotationMouseMove = (e: MouseEvent) => {
      if (!isRotatingRef.current) return;
      
      const x = e.clientX - rotationKnob.getBoundingClientRect().left;
      const theta = getRotationVelocityFromPosition(x);
      
      updateVelocities(prevVelocitiesRef.current.x, prevVelocitiesRef.current.y, theta);
      
      const thumbWidth = 24;
      const maxX = rotationKnob.offsetWidth - thumbWidth;
      const limitedX = Math.max(0, Math.min(maxX, x - thumbWidth/2));
      
      rotationKnob.querySelector('.thumb')?.setAttribute('style', 
        `left: ${limitedX}px`);
    };
    
    const onRotationMouseUp = () => {
      if (!isRotatingRef.current) return;
      isRotatingRef.current = false;
      
      // Reset rotation control to middle
      const thumbWidth = 24;
      const centerX = rotationKnob.offsetWidth / 2 - thumbWidth / 2;
      
      rotationKnob.querySelector('.thumb')?.setAttribute('style', 
        `left: ${centerX}px`);
      
      // Reset theta velocity to 0
      updateVelocities(prevVelocitiesRef.current.x, prevVelocitiesRef.current.y, 0);
    };
    
    // Add event listeners
    joystick.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    
    rotationKnob.addEventListener('mousedown', onRotationMouseDown);
    document.addEventListener('mousemove', onRotationMouseMove);
    document.addEventListener('mouseup', onRotationMouseUp);
    
    // Touch events (simplified)
    joystick.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      onMouseDown({
        clientX: touch.clientX,
        clientY: touch.clientY,
        preventDefault: () => {}
      } as any);
    });
    
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      if (isDraggingRef.current) e.preventDefault();
      const touch = e.touches[0];
      onMouseMove({
        clientX: touch.clientX,
        clientY: touch.clientY
      } as any);
    }, { passive: false });
    
    document.addEventListener('touchend', () => {
      if (isDraggingRef.current) onMouseUp();
    });
    
    // Touch events for rotation control
    rotationKnob.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      onRotationMouseDown({
        clientX: touch.clientX,
        preventDefault: () => {}
      } as any);
    });
    
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1 || !isRotatingRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      onRotationMouseMove({
        clientX: touch.clientX
      } as any);
    }, { passive: false });
    
    document.addEventListener('touchend', () => {
      if (isRotatingRef.current) onRotationMouseUp();
    });
    
    // Cleanup
    return () => {
      joystick.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      rotationKnob.removeEventListener('mousedown', onRotationMouseDown);
      document.removeEventListener('mousemove', onRotationMouseMove);
      document.removeEventListener('mouseup', onRotationMouseUp);
      
      joystick.removeEventListener('touchstart', (e) => {});
      document.removeEventListener('touchmove', (e) => {});
      document.removeEventListener('touchend', () => {});
      
      rotationKnob.removeEventListener('touchstart', (e) => {});
      // Other touch event cleanup
    };
  }, [maxSpeed, maxAngular, updateVelocities]);

  // Xử lý điều khiển bàn phím
  useEffect(() => {
    const keyboardDiv = keyboardControlRef.current;
    if (!keyboardDiv) return;

    const handleFocus = () => setHasFocus(true);
    const handleBlur = () => {
      setHasFocus(false);
      // Reset các phím khi mất focus
      setKeysPressed({ w: false, a: false, s: false, d: false, q: false, e: false });
      updateVelocities(0, 0, 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hasFocus) return;
      
      e.preventDefault();
      const key = e.key.toLowerCase();
      
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
        setKeysPressed(prev => {
          const newKeys = { ...prev, [key]: true };
          updateVelocitiesFromKeys(newKeys);
          return newKeys;
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!hasFocus) return;
      
      e.preventDefault();
      const key = e.key.toLowerCase();
      
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) {
        setKeysPressed(prev => {
          const newKeys = { ...prev, [key]: false };
          updateVelocitiesFromKeys(newKeys);
          return newKeys;
        });
      }
    };

    // Thêm event listeners
    keyboardDiv.addEventListener('focus', handleFocus);
    keyboardDiv.addEventListener('blur', handleBlur);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Dọn dẹp khi unmount
    return () => {
      keyboardDiv.removeEventListener('focus', handleFocus);
      keyboardDiv.removeEventListener('blur', handleBlur);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [hasFocus, updateVelocities]);

  // Chuyển đổi từ các phím được nhấn sang vận tốc
  const updateVelocitiesFromKeys = useCallback((keys: KeysPressed) => {
    // Tính vận tốc X (tiến/lùi)
    let x = 0;
    if (keys.w) x += maxSpeed;
    if (keys.s) x -= maxSpeed;

    // Tính vận tốc Y (trái/phải)
    let y = 0;
    if (keys.a) y += maxSpeed;
    if (keys.d) y -= maxSpeed;

    // Tính vận tốc quay
    let theta = 0;
    if (keys.q) theta += maxAngular;
    if (keys.e) theta -= maxAngular;

    // Cập nhật vận tốc
    updateVelocities(x, y, theta);
  }, [maxSpeed, maxAngular, updateVelocities]);

  const setMotorSpeed = useCallback((motorId: number, speed: number): void => {
    if (!isConnected) {
      setErrorMessage("TCP service not connected!");
      setTimeout(() => setErrorMessage(""), 5000);
      return;
    }
    
    // Update local state
    const newSpeeds = [...motorSpeeds];
    newSpeeds[motorId-1] = speed;
    setMotorSpeeds(newSpeeds);
    
    // Send command to TCP server
    tcpWebSocketService.sendMessage({
      type: "motor_control",
      robot_id: selectedRobotId,
      motor_id: motorId,
      speed: speed,
      frontend: true, // Thêm trường frontend
      timestamp: Date.now() / 1000
    });
  }, [isConnected, motorSpeeds, selectedRobotId]);

  const emergencyStop = useCallback((): void => {
    if (!isConnected) {
      setErrorMessage("TCP service not connected!");
      setTimeout(() => setErrorMessage(""), 5000);
      return;
    }
    
    // Reset all speeds locally
    setMotorSpeeds([0, 0, 0]);
    setVelocities({ x: 0, y: 0, theta: 0 });
    prevVelocitiesRef.current = { x: 0, y: 0, theta: 0 };
    
    // Reset joystick position
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(-50%, -50%)`;
    }
    
    // Reset rotation control
    if (rotationKnobRef.current) {
      const thumbWidth = 24;
      const centerX = rotationKnobRef.current.offsetWidth / 2 - thumbWidth / 2;
      rotationKnobRef.current.querySelector('.thumb')?.setAttribute('style', `left: ${centerX}px`);
    }
    
    // Send emergency stop through TCP
    tcpWebSocketService.sendMessage({ 
      type: "emergency_stop",
      robot_id: selectedRobotId,
      frontend: true, // Thêm trường frontend
      timestamp: Date.now() / 1000
    });
  }, [isConnected, selectedRobotId]);

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <WidgetConnectionHeader
        title="Robot Control"
        status={status}
        isConnected={isConnected}
        onConnect={connect}
        onDisconnect={disconnect}
      />
      
      <div className="flex justify-between mb-4">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setActiveTab('keyboard')}
            className={`px-3 py-1 rounded-t-md ${activeTab === 'keyboard' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Keyboard
          </button>
          <button 
            onClick={() => setActiveTab('joystick')}
            className={`px-3 py-1 rounded-t-md ${activeTab === 'joystick' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Joystick
          </button>
          <button 
            onClick={() => setActiveTab('motors')}
            className={`px-3 py-1 rounded-t-md ${activeTab === 'motors' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Motors
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm mr-2">Robot: {selectedRobotId}</span>
        </div>
      </div>
      
      {errorMessage && (
        <div className="bg-red-100 text-red-700 p-2 rounded-md text-sm mb-4">
          {errorMessage}
        </div>
      )}
      
      {/* Điều khiển bàn phím */}
      {activeTab === 'keyboard' && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-2">Điều khiển bằng phím W A S D</h3>
          
          <div 
            ref={keyboardControlRef} 
            className={`p-6 border-2 rounded-lg mb-4 outline-none ${hasFocus ? 'border-blue-500' : 'border-gray-300'}`}
            tabIndex={0} // Cho phép focus
          >
            {!hasFocus && (
              <div className="text-center text-gray-500 mb-4">
                Click vào đây để kích hoạt điều khiển bàn phím
              </div>
            )}
            
            {/* Hiển thị phím W A S D */}
            <div className="grid grid-cols-3 gap-2 text-center w-48 mx-auto">
              <div></div>
              <button 
                className={`p-4 rounded-md ${keysPressed.w ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => keyboardControlRef.current?.focus()}
              >
                <ArrowUp size={24} className="mx-auto" />
                <div className="text-xs mt-1">W</div>
              </button>
              <div></div>
              
              <button 
                className={`p-4 rounded-md ${keysPressed.a ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => keyboardControlRef.current?.focus()}
              >
                <ArrowLeft size={24} className="mx-auto" />
                <div className="text-xs mt-1">A</div>
              </button>
              <button 
                className={`p-4 rounded-md ${keysPressed.s ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => keyboardControlRef.current?.focus()}
              >
                <ArrowDown size={24} className="mx-auto" />
                <div className="text-xs mt-1">S</div>
              </button>
              <button 
                className={`p-4 rounded-md ${keysPressed.d ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => keyboardControlRef.current?.focus()}
              >
                <ArrowRight size={24} className="mx-auto" />
                <div className="text-xs mt-1">D</div>
              </button>
            </div>
            
            {/* Hiển thị phím xoay Q E */}
            <div className="flex justify-center mt-4 gap-8">
              <button 
                className={`p-4 rounded-md ${keysPressed.q ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => keyboardControlRef.current?.focus()}
              >
                <RotateCounter size={24} className="mx-auto" />
                <div className="text-xs mt-1">Q</div>
              </button>
              <button 
                className={`p-4 rounded-md ${keysPressed.e ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                onClick={() => keyboardControlRef.current?.focus()}
              >
                <RotateCw size={24} className="mx-auto" />
                <div className="text-xs mt-1">E</div>
              </button>
            </div>
            
            <div className="text-center mt-6">
              <div className="text-sm font-medium">Hướng dẫn điều khiển:</div>
              <div className="text-xs text-gray-600 mt-1">
                <div>W - Tiến | S - Lùi | A - Trái | D - Phải</div>
                <div>Q - Xoay trái | E - Xoay phải</div>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-gray-100 rounded-md">
            <h4 className="font-medium mb-1">Lệnh Hiện Tại</h4>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-gray-500">Tiến/Lùi</div>
                <div className="font-mono">{velocities.x.toFixed(2)} m/s</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Trái/Phải</div>
                <div className="font-mono">{velocities.y.toFixed(2)} m/s</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Xoay</div>
                <div className="font-mono">{velocities.theta.toFixed(2)} rad/s</div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Giữ nguyên phần joystick và motors tab */}
      {activeTab === 'joystick' && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-2">Robot Motion Control</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Joystick Control */}
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">Position Control</h4>
              <div 
                ref={joystickRef}
                className="w-48 h-48 mx-auto bg-gray-200 rounded-full relative cursor-pointer"
                style={{ touchAction: 'none' }}
              >
                {/* Base circle with grid */}
                <div className="absolute inset-0 rounded-full flex items-center justify-center">
                  <div className="w-[2px] h-full bg-gray-400 opacity-50"></div>
                  <div className="h-[2px] w-full bg-gray-400 opacity-50 absolute"></div>
                  <div className="w-24 h-24 rounded-full border-2 border-gray-400 opacity-30"></div>
                </div>
                
                {/* Control knob */}
                <div 
                  ref={knobRef} 
                  className="absolute w-8 h-8 bg-blue-500 rounded-full left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 cursor-grab shadow-md"
                >
                  <div className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">
                    {velocities.x.toFixed(1)}
                    ,
                    {velocities.y.toFixed(1)}
                  </div>
                </div>
              </div>
              
              <div className="text-center mt-2 text-sm text-gray-600">
                Drag to control X/Y velocity
              </div>
            </div>
            
            {/* Rotation Control */}
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">Rotation Control</h4>
              <div 
                ref={rotationKnobRef}
                className="w-full h-12 bg-gray-200 rounded-full relative cursor-pointer my-8"
                style={{ touchAction: 'none' }}
              >
                {/* Scale markers */}
                <div className="absolute inset-x-0 top-1/2 transform -translate-y-1/2 flex justify-between px-6">
                  <div className="text-xs font-medium text-gray-500">-{maxAngular.toFixed(1)}</div>
                  <div className="text-xs font-medium text-gray-500">0</div>
                  <div className="text-xs font-medium text-gray-500">+{maxAngular.toFixed(1)}</div>
                </div>
                
                {/* Thumb control */}
                <div className="thumb absolute top-0 left-1/2 transform -translate-x-1/2 w-6 h-12 flex items-center justify-center cursor-grab">
                  <div className="w-6 h-6 bg-red-500 rounded-full shadow-md"></div>
                </div>
              </div>
              
              <div className="text-center mt-2 text-sm text-gray-600">
                Drag sideways to control angular velocity: {velocities.theta.toFixed(2)} rad/s
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-gray-100 rounded-md">
            <h4 className="font-medium mb-1">Current Command</h4>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-gray-500">Forward/Backward</div>
                <div className="font-mono">{velocities.x.toFixed(2)} m/s</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Left/Right</div>
                <div className="font-mono">{velocities.y.toFixed(2)} m/s</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Rotation</div>
                <div className="font-mono">{velocities.theta.toFixed(2)} rad/s</div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {activeTab === 'motors' && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-2">Individual Motor Control</h3>
          
          <div className="grid grid-cols-4 gap-2 text-sm font-bold border-b pb-2">
            <div>Motor</div>
            <div>Speed</div>
            <div>Action</div>
            <div>Current RPM</div>
          </div>
          
          {[1, 2, 3].map((motorId) => (
            <div key={motorId} className="grid grid-cols-4 gap-2 items-center py-2 border-b last:border-b-0">
              <div>Motor {motorId}</div>
              <input 
                type="number" 
                value={motorSpeeds[motorId-1]}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const newSpeeds = [...motorSpeeds];
                  newSpeeds[motorId-1] = parseInt(e.target.value) || 0;
                  setMotorSpeeds(newSpeeds);
                }}
                className="border rounded px-2 py-1 w-full"
                disabled={!isConnected}
              />
              <button
                onClick={() => setMotorSpeed(motorId, motorSpeeds[motorId-1])}
                disabled={!isConnected}
                className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded disabled:bg-gray-400 disabled:cursor-not-allowed">
                Set
              </button>
              <div>
                <span className="font-mono">
                  {rpmValues[motorId]?.toFixed(2) || "0.00"} RPM
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={emergencyStop}
        disabled={!isConnected}
        className="mt-4 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded font-bold disabled:bg-red-400 disabled:cursor-not-allowed w-full">
        EMERGENCY STOP
      </button>
      
      <div className="mt-4 text-xs text-gray-500">
        <p>Sử dụng phím W A S D để điều khiển robot, hoặc các giao diện điều khiển khác.</p>
        <p>Nhấn nút Emergency Stop để dừng robot ngay lập tức.</p>
      </div>
    </div>
  );
};

export default RobotControlWidget;