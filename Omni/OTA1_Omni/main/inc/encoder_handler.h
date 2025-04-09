#ifndef ENCODER_HANDLER_H
#define ENCODER_HANDLER_H

/**
 * @file encoder_handler.h
 * @brief Header file for the encoder handler module.
 */

#define PULSE_PER_ROUND 1980

#define NUM_MOTORS 3

void setup_encoders();
void read_rpm(int time);

void task_send_encoder(void *pvParameters);

#endif // ENCODER_HANDLER_H