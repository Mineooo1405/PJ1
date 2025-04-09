#ifndef LPF_H
#define LPF_H

#define FILTER_ORDER 1 // Bậc của bộ lọc

typedef struct
{
    float x_prev;                     // Giá trị trước của x
    float y_prev;                     // Giá trị trước của y
    float a_coeffs[FILTER_ORDER];     // Hệ số a
    float b_coeffs[FILTER_ORDER + 1]; // Hệ số b
    float time_interval;              // Thời gian lấy mẫu
} LPF;

void LPF_Init(LPF *filter, float *a, float *b, float time_interval);
float LPF_Apply(LPF *filter, float x);
void LPF_Clear(LPF *filter, float rpm);

#endif // LPF_H