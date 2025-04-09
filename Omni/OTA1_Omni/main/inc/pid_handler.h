#ifndef PID_HANDLER_H
#define PID_HANDLER_H

/**
 * @file pid_handler.h
 * @brief Header file for PID handler functions.
 */

typedef struct PID_t
{
    float Kp;
    float Ki;
    float Kd;
    float setpoint;
    float prev_error;
    float integral;
    float last_time;
    float last_derivative;
    float beta_coeff;
} PID_t;

void pid_init(PID_t *pid, float Kp, float Ki, float Kd);

void pid_set_setpoint(PID_t *pid, float setpoint);

void pid_task(void *pvParameters);

#endif // PID_HANDLER_H