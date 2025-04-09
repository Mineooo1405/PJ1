#ifndef MOTOR_HANDLER_H
#define MOTOR_HANDLER_H

/**
 * @file motor_handler.h
 * @brief Header file for motor handler functions.
 */

// LEDC (PWM) configuration
#define LEDC_TIMER LEDC_TIMER_0
#define LEDC_MODE LEDC_LOW_SPEED_MODE
#define LEDC_DUTY_RES LEDC_TIMER_10_BIT
#define LEDC_FREQUENCY 1000

#define NUM_MOTORS 3

void setup_pwm();

int rpm_to_pulse(float rpm);

void set_motor_speed(int motor_id, int direction, int duty);

#endif // MOTOR_HANDLER_H