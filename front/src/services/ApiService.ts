// Thêm adapter cho API
import { convertBNO055ToIMU, convertEncoderValues } from './Adapters';

class ApiService {
  private baseUrl = '/api';
  
  // Lấy dữ liệu encoder
  async getEncoderData(robotId = 1, limit = 100) {
    try {
      const response = await fetch(`${this.baseUrl}/robots/${robotId}/encoder?limit=${limit}`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Chuyển đổi định dạng dữ liệu
      return {
        ...data,
        data: data.data.map((item: any) => convertEncoderValues(item))
      };
    } catch (error) {
      console.error('Error fetching encoder data:', error);
      throw error;
    }
  }
  
  // Lấy dữ liệu IMU
  async getIMUData(robotId = 1, limit = 100) {
    try {
      const response = await fetch(`${this.baseUrl}/robots/${robotId}/imu?limit=${limit}`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Chuyển đổi định dạng dữ liệu
      return {
        ...data,
        data: data.data.map((item: any) => convertBNO055ToIMU(item))
      };
    } catch (error) {
      console.error('Error fetching IMU data:', error);
      throw error;
    }
  }
  
  // Các API khác...
}

export default new ApiService();