import math
import numpy as np
from typing import Dict, List, Tuple, Optional
from datetime import datetime

class TrajectoryCalculator:
    """
    Tính toán quỹ đạo dựa trên dữ liệu encoder và IMU
    """
    
    def __init__(self):
        # Khoảng cách từ tâm robot đến bánh xe (m)
        self.R = 0.085
        
        # Ma trận chuyển đổi động học thuận
        self.forward_matrix = np.array([
            [-math.sin(math.pi/6), -math.sin(5*math.pi/6), -math.sin(3*math.pi/2)],
            [math.cos(math.pi/6), math.cos(5*math.pi/6), math.cos(3*math.pi/2)],
            [1/(3*self.R), 1/(3*self.R), 1/(3*self.R)]
        ])
        
        # Ma trận chuyển đổi động học ngược (inverse kinematics)
        self.inverse_matrix = np.linalg.inv(self.forward_matrix)
        
        # Bán kính bánh xe (m)
        self.wheel_radius = 0.030
        
        # Tỷ số truyền encoder-bánh
        self.gear_ratio = 10.0
        
        # Số xung encoder trên mỗi vòng quay đầu ra
        self.encoder_ticks_per_rev = 1000.0
    
    def encoder_to_velocity(self, encoder_values: List[float], dt: float) -> Tuple[float, float, float]:
        """
        Chuyển đổi giá trị encoder sang vận tốc tuyến tính và góc
        
        Args:
            encoder_values: Danh sách 3 giá trị encoder (ticks/s)
            dt: Thời gian giữa các lần đọc (s)
            
        Returns:
            Tuple (vx, vy, omega) - vận tốc tuyến tính (m/s) và góc (rad/s)
        """
        if dt <= 0:
            return 0.0, 0.0, 0.0
            
        # Chuyển đổi encoder ticks/s sang vận tốc góc của bánh xe (rad/s)
        wheel_angular_velocity = []
        for ticks in encoder_values:
            # Công thức: (ticks/s) * (2π rad/tick_per_rev) / gear_ratio
            wheel_velocity = (ticks / self.encoder_ticks_per_rev) * (2 * math.pi) / self.gear_ratio
            wheel_angular_velocity.append(wheel_velocity)
            
        # Chuyển đổi vận tốc góc bánh xe sang vận tốc tuyến tính bánh xe
        wheel_linear_velocity = [w * self.wheel_radius for w in wheel_angular_velocity]
        
        # Áp dụng động học thuận để tính vận tốc robot
        velocity = np.dot(self.forward_matrix, wheel_linear_velocity)
        
        return velocity[0], velocity[1], velocity[2]
    
    def update_pose(self, current_pose: Dict[str, float], 
                   encoder_values: List[float], 
                   dt: float,
                   orientation: Optional[Dict[str, float]] = None) -> Dict[str, float]:
        """
        Cập nhật tư thế robot dựa trên dữ liệu encoder và IMU (nếu có)
        
        Args:
            current_pose: Dict chứa {'x': x, 'y': y, 'theta': theta}
            encoder_values: Danh sách 3 giá trị encoder
            dt: Thời gian giữa các lần đọc
            orientation: Dict chứa {'roll', 'pitch', 'yaw'} từ IMU (tùy chọn)
            
        Returns:
            Dict chứa tư thế mới {'x': x, 'y': y, 'theta': theta}
        """
        # Trích xuất tư thế hiện tại
        x = current_pose['x']
        y = current_pose['y']
        theta = current_pose['theta']
        
        # Tính vận tốc từ encoder
        vx, vy, omega = self.encoder_to_velocity(encoder_values, dt)
        
        # Nếu có dữ liệu IMU, sử dụng yaw từ IMU
        if orientation and 'yaw' in orientation:
            # Sử dụng góc yaw từ IMU để đảm bảo độ chính xác cao hơn
            # Nhưng vẫn tính toán góc mới dựa trên encoder để đối chiếu
            theta_from_imu = orientation['yaw']
            theta_from_encoder = theta + omega * dt
            
            # Kết hợp cả hai nguồn dữ liệu (có thể sử dụng bộ lọc Kalman ở đây)
            # Hiện tại ưu tiên dữ liệu IMU hơn
            theta = theta_from_imu
        else:
            # Không có dữ liệu IMU, chỉ dùng encoder
            theta = theta + omega * dt
        
        # Chuẩn hóa góc theta về khoảng [-π, π]
        theta = ((theta + math.pi) % (2 * math.pi)) - math.pi
        
        # Cập nhật vị trí dựa trên mô hình động học
        x = x + (vx * math.cos(theta) - vy * math.sin(theta)) * dt
        y = y + (vx * math.sin(theta) + vy * math.cos(theta)) * dt
        
        return {'x': x, 'y': y, 'theta': theta}