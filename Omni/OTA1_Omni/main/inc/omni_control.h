#ifndef OMNI_CONTROL_H
#define OMNI_CONTROL_H

/**
 * @file omni_control.h
 * @brief Header file for omni control functionality.
 */

#define RECALCULATION_PERIOD_MS 500
typedef struct
{
    float dot_x;        // Vận tốc theo trục x (m/s)
    float dot_y;        // Vận tốc theo trục y (m/s)
    float dot_theta;    // Vận tốc góc quay của robot (rad/s)
    float theta;        // Góc hiện tại của robot (rad)
    float wheel_radius; // Bán kính bánh xe (m)
    float robot_radius; // Khoảng cách từ tâm robot đến bánh xe (m)
} RobotParams;

void omni_control(float v_rpm, float theta, float omega_rpm);

#endif // OMNI_CONTROL_H