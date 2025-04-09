#include "kalman_filter.h"

// Khởi tạo Kalman Filter
void Kalman_Init(KalmanFilter *kf, float process_noise, float measurement_noise, float initial_speed)
{
    kf->process_noise = process_noise;
    kf->measurement_noise = measurement_noise;
    kf->estimated_speed = initial_speed;
    kf->estimation_uncertainty = 1.0; // Khởi tạo độ tin cậy thấp
}

// Cập nhật bộ lọc với dữ liệu mới từ encoder
float Kalman_Update(KalmanFilter *kf, float measured_speed)
{
    // Bước dự đoán: tăng độ không chắc chắn
    kf->estimation_uncertainty += kf->process_noise;

    // Tính Kalman Gain (độ tin cậy của dữ liệu đo)
    kf->kalman_gain = kf->estimation_uncertainty / (kf->estimation_uncertainty + kf->measurement_noise);

    // Cập nhật giá trị tốc độ ước lượng
    kf->estimated_speed += kf->kalman_gain * (measured_speed - kf->estimated_speed);

    // Cập nhật độ không chắc chắn
    kf->estimation_uncertainty *= (1 - kf->kalman_gain);

    return kf->estimated_speed;
}
