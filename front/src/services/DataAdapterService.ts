// Service để chuyển đổi giữa các định dạng dữ liệu khác nhau
import { convertBNO055ToIMU, convertEncoderValues } from './Adapters';

class DataAdapterService {
  
  /**
   * Chuẩn hóa dữ liệu nhận được từ WebSocket/API trước khi sử dụng trong UI
   */
  normalizeWebSocketData(data: any): any {
    if (!data || typeof data !== 'object') return data;
    
    // Xác định loại dữ liệu
    if (data.type === 'encoder_data' || data.type === 'encoder') {
      return this.normalizeEncoderData(data);
    }
    else if (data.type === 'imu_data' || data.type === 'bno055' || data.type === 'bno055_data') {
      return this.normalizeIMUData(data);
    }
    else if (data.type === 'trajectory_data') {
      return this.normalizeTrajectoryData(data);
    }
    else if (data.type === 'pid_config') {
      return this.normalizePIDConfig(data);
    }
    else if (data.type === 'log_data' || data.type === 'log') {
      return this.normalizeLogData(data);
    }
    
    // Trả về nguyên dạng nếu không thuộc các loại trên
    return data;
  }
  
  /**
   * Chuẩn hóa dữ liệu encoder
   */
  normalizeEncoderData(data: any): any {
    const normalizedData = convertEncoderValues(data);
    
    // Cập nhật type để frontend xử lý nhất quán
    return {
      ...normalizedData,
      type: 'encoder_data'
    };
  }
  
  /**
   * Chuẩn hóa dữ liệu IMU
   */
  normalizeIMUData(data: any): any {
    const normalizedData = convertBNO055ToIMU(data);
    
    // Cập nhật type để frontend xử lý nhất quán
    return {
      ...normalizedData,
      type: 'imu_data'
    };
  }
  
  /**
   * Chuẩn hóa dữ liệu quỹ đạo
   */
  normalizeTrajectoryData(data: any): any {
    // Đảm bảo có trường current_position
    if (!data.current_position && (data.current_x !== undefined || data.current_y !== undefined)) {
      data.current_position = {
        x: data.current_x || 0,
        y: data.current_y || 0,
        theta: data.current_theta || 0
      };
    }
    
    return {
      ...data,
      type: 'trajectory_data',
      timestamp: data.timestamp || data.created_at || new Date().toISOString()
    };
  }
  
  /**
   * Chuẩn hóa cấu hình PID
   */
  normalizePIDConfig(data: any): any {
    return {
      ...data,
      type: 'pid_config',
      timestamp: data.updated_at || data.created_at || new Date().toISOString()
    };
  }
  
  /**
   * Chuẩn hóa dữ liệu log
   */
  normalizeLogData(data: any): any {
    return {
      ...data,
      type: 'log_data',
      timestamp: data.created_at || data.timestamp || new Date().toISOString()
    };
  }
}

// Export singleton instance
export default new DataAdapterService();