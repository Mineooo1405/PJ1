#ifndef BNO055_HANDLER_H
#define BNO055_HANDLER_H

#define REINIT_TIME 2500
// BNO polling period.
#define BNO_POLLING_MS 100

void ndof_task(void *pvParameters);
void reinit_sensor(void *pvParameters);

float get_heading();

void bno055_start(int *socket);

#endif // BNO055_HANDLER_H