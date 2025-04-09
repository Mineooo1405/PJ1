#ifndef KALMAN_FILTER_H
#define KALMAN_FILTER_H

typedef struct
{
    float estimated_speed;        // Giá trị tốc độ đã lọc
    float estimation_uncertainty; // Hiệp phương sai (độ tin cậy của ước lượng)
    float process_noise;          // Nhiễu quá trình (thay đổi tốc độ động cơ)
    float measurement_noise;      // Nhiễu đo lường (từ encoder)
    float kalman_gain;            // Hệ số Kalman
} KalmanFilter;

// Khởi tạo Kalman Filter
void Kalman_Init(KalmanFilter *kf, float process_noise, float measurement_noise, float initial_speed);

// Cập nhật Kalman Filter với dữ liệu từ encoder
float Kalman_Update(KalmanFilter *kf, float measured_speed);

#endif
