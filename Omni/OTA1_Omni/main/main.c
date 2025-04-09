#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "lwip/sockets.h"
#include "esp_log.h"
#include <esp_wifi.h>
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include <nvs_flash.h>

#include "gpio_handler.h"
#include "encoder_handler.h"
#include "wifi_handler.h"
#include "motor_handler.h"
#include "log_handler.h"
#include "omni_control.h"
#include "pid_handler.h"
#include "sys_config.h"
#include "LPF.h"
#include "bno055_handler.h"

#define SERVER_PORT 12346

static const char *TAG_Socket = "Socket";
static const char *TAG_PID = "PID";

PID_t pid_motor[3];

extern LPF encoder_lpf[NUM_MOTORS];

int setup_socket()
{
    struct sockaddr_in dest_addr;
    dest_addr.sin_addr.s_addr = inet_addr(SERVER_IP);
    dest_addr.sin_family = AF_INET;
    dest_addr.sin_port = htons(SERVER_PORT);

    int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    if (sock < 0)
    {
        ESP_LOGE(TAG_Socket, "Unable to create socket");
        vTaskDelete(NULL);
    }

    if (connect(sock, (struct sockaddr *)&dest_addr, sizeof(dest_addr)) != 0)
    {
        ESP_LOGE(TAG_Socket, "Socket connection failed");
        close(sock);
        vTaskDelete(NULL);
    }
    ESP_LOGI(TAG_Socket, "Connected to server");
    return sock;
}

void task_socket(void *pvParameters)
{

    // char tx_buffer[128];
    int socket = *(int *)pvParameters;

    float dot_x, dot_y, dot_theta = 0;

    int motor_id, motor_speed = 0;

    float Kp, Ki, Kd = 0;

    char rx_buffer[128];
    while (1)
    {
        // Receive motor speed commands
        int len = recv(socket, rx_buffer, sizeof(rx_buffer) - 1, 0);
        if (len > 0)
        {
            rx_buffer[len] = '\0';
            ESP_LOGI(TAG_Socket, "Received: %s", rx_buffer);
            // Switch to Upgrade Mode
            if (strcmp(rx_buffer, "Upgrade") == 0)
            {
                static const esp_partition_t *update_partition = NULL;
                update_partition = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, NULL);
                ESP_LOGW(TAG_Socket, "----Switch to Upgrade----");
                vTaskDelay(2000 / portTICK_PERIOD_MS);
                esp_ota_set_boot_partition(update_partition);
                esp_restart();
            }
#if NON_PID == 0
            else if (strcmp(rx_buffer, "Set PID") == 0)
            {
                xTaskCreate(pid_task, "pid_task", 4096, NULL, 7, NULL);
            }
#endif
            // Manual Control
            else if (sscanf(rx_buffer, "dot_x:%f dot_y:%f dot_theta:%f", &dot_x, &dot_y, &dot_theta) == 3)
            {
                omni_control(dot_x, dot_y, dot_theta);
            }

            // Motor Set Speed
            else if (sscanf(rx_buffer, "MOTOR_%d_SPEED:%d;", &motor_id, &motor_speed) == 2)
            {
#if NON_PID == 1
                set_motor_speed(motor_id, motor_speed > 0 ? 1 : 0, abs((int)(motor_speed * 5.11)));
                LPF_Clear(&encoder_lpf[motor_id - 1], motor_speed);
                ESP_LOGW(TAG_PID, "Updated Motor %d speed to %d with direction %d", motor_id, abs((int)(motor_speed * 5.11)), motor_speed > 0 ? 1 : 0);
#else
                // Tính toán tốc độ RPM từ tốc độ PWM
                LPF_Clear(&encoder_lpf[motor_id - 1], motor_speed * 1.0);
                pid_set_setpoint(&pid_motor[motor_id - 1], motor_speed);
                printf("Updated Motor %d speed to %d\n", motor_id, motor_speed);
#endif
            }

            // PID Set Values
            else if (sscanf(rx_buffer, "MOTOR:%d Kp:%f Ki:%f Kd:%f", &motor_id, &Kp, &Ki, &Kd) == 4)
            {
                // Update PID values
                pid_init(&pid_motor[motor_id - 1], Kp, Ki, Kd);
                ESP_LOGW(TAG_PID, "Updated Motor %d PID values to Kp: %f Ki: %f Kd: %f", motor_id, Kp, Ki, Kd);
            }
            else
            {
                ESP_LOGI(TAG_Socket, "Invalid command");
            }
        }
        vTaskDelay(200 / portTICK_PERIOD_MS);
    }
    close(socket);
    vTaskDelete(NULL);
}

void app_main()
{
    connect_to_wifi();
    int socket = setup_socket();
#if LOG_SERVER == 1
    log_init(socket);
#endif
    ESP_LOGI(TAG_Socket, "Starting application");
    setup_encoders();
    setup_pwm();
    xTaskCreate(task_socket, "socket_task", 4096, (void *)&socket, 10, NULL);
    xTaskCreate(task_send_encoder, "send_encoder", 4096, (void *)&socket, 9, NULL);
#if USE_BNO055 == 1
    bno055_start(&socket);
#endif
}
