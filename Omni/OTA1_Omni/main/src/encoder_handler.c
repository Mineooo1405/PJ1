#include "encoder_handler.h"
#include "gpio_handler.h"
#include "kalman_filter.h"
#include "LPF.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "driver/pulse_cnt.h"
#include "esp_log.h"
#include "lwip/sockets.h"
#include "sys_config.h"

#define LIMIT 32767
#define FILTER 10000 // 10us vi 1 xung CPR co do dai bang 150 800 ns

#if NON_PID == 1
#define TIME_INTERVAL 20
#else
#define TIME_INTERVAL 20
#endif

static const char *TAG = "Encoder";

volatile float encoder_rpm[NUM_MOTORS] = {0};

pcnt_unit_handle_t encoder_unit[NUM_MOTORS] = {NULL};

KalmanFilter encoder_kalman[NUM_MOTORS];

LPF encoder_lpf[NUM_MOTORS];

float a_coeffs_enc[FILTER_ORDER] = {0.904204};
float b_coeffs_enc[FILTER_ORDER + 1] = {0.04789, 0.04789};

void setup_pcnt_encoder(int unit_index, gpio_num_t pinA, gpio_num_t pinB)
{
    pcnt_unit_config_t unit_config = {
        .high_limit = LIMIT,
        .low_limit = -LIMIT,
    };
    ESP_ERROR_CHECK(pcnt_new_unit(&unit_config, &encoder_unit[unit_index]));

    pcnt_chan_config_t chan_a_config = {
        .edge_gpio_num = pinA,
        .level_gpio_num = pinB};
    pcnt_channel_handle_t pcnt_chan_a;
    ESP_ERROR_CHECK(pcnt_new_channel(encoder_unit[unit_index], &chan_a_config, &pcnt_chan_a));

    pcnt_chan_config_t chan_b_config = {
        .edge_gpio_num = pinB,
        .level_gpio_num = pinA};
    pcnt_channel_handle_t pcnt_chan_b;
    ESP_ERROR_CHECK(pcnt_new_channel(encoder_unit[unit_index], &chan_b_config, &pcnt_chan_b));

    ESP_ERROR_CHECK(pcnt_channel_set_edge_action(pcnt_chan_a, PCNT_CHANNEL_EDGE_ACTION_DECREASE, PCNT_CHANNEL_EDGE_ACTION_INCREASE));
    ESP_ERROR_CHECK(pcnt_channel_set_level_action(pcnt_chan_a, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE));
    ESP_ERROR_CHECK(pcnt_channel_set_edge_action(pcnt_chan_b, PCNT_CHANNEL_EDGE_ACTION_INCREASE, PCNT_CHANNEL_EDGE_ACTION_DECREASE));
    ESP_ERROR_CHECK(pcnt_channel_set_level_action(pcnt_chan_b, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE));

    pcnt_glitch_filter_config_t filter_config = {
        .max_glitch_ns = FILTER};
    ESP_ERROR_CHECK(pcnt_unit_set_glitch_filter(encoder_unit[unit_index], &filter_config));

    ESP_ERROR_CHECK(pcnt_unit_enable(encoder_unit[unit_index]));
    ESP_ERROR_CHECK(pcnt_unit_clear_count(encoder_unit[unit_index]));
    ESP_ERROR_CHECK(pcnt_unit_start(encoder_unit[unit_index]));
}

void setup_encoders()
{
    ESP_LOGI(TAG, "Setting up encoders");
    setup_pcnt_encoder(0, ENCODER_1_A, ENCODER_1_B);
    setup_pcnt_encoder(1, ENCODER_2_A, ENCODER_2_B);
    setup_pcnt_encoder(2, ENCODER_3_A, ENCODER_3_B);
    ESP_LOGI(TAG, "Setting up Kalman Filter");
    Kalman_Init(&encoder_kalman[0], 0.4, 5.0, 0.0); // (Q, R, Giá trị ban đầu)
    Kalman_Init(&encoder_kalman[1], 0.4, 5.0, 0.0); // (Q, R, Giá trị ban đầu)
    Kalman_Init(&encoder_kalman[2], 0.4, 5.0, 0.0); // (Q, R, Giá trị ban đầu)
    ESP_LOGI(TAG, "Setting up Low Pass Filter");
    LPF_Init(&encoder_lpf[0], a_coeffs_enc, b_coeffs_enc, TIME_INTERVAL);
    LPF_Init(&encoder_lpf[1], a_coeffs_enc, b_coeffs_enc, TIME_INTERVAL);
    LPF_Init(&encoder_lpf[2], a_coeffs_enc, b_coeffs_enc, TIME_INTERVAL);
}

void read_rpm(int time)
{
    int count;
    float float_count;
    float prev_count[3] = {0};
    float alpha = 0.7;
    for (int i = 0; i < NUM_MOTORS; i++)
    {
        pcnt_unit_get_count(encoder_unit[i], &count);
        pcnt_unit_clear_count(encoder_unit[i]);
        // float_count = Kalman_Update(&encoder_kalman[i], count);
        // float_count = LPF_Apply(&encoder_lpf[i], (float)count);
        float_count = alpha * count + (1 - alpha) * prev_count[i];
        prev_count[i] = float_count;
        encoder_rpm[i] = 1.0 * (count * 60 * 1000) / (PULSE_PER_ROUND * time); // 1000 because TIME_INTERVAL is ms
        encoder_rpm[i] = LPF_Apply(&encoder_lpf[i], encoder_rpm[i]);
    }
}

void read_encoders(int *encoder_count)
{
    for (int i = 0; i < NUM_MOTORS; i++)
    {
        pcnt_unit_get_count(encoder_unit[i], &encoder_count[i]);
        // pcnt_unit_clear_count(encoder_unit[i]);
    }
}

void task_send_encoder(void *pvParameters)
{
    int sock = *(int *)pvParameters;
    ESP_LOGI(TAG, "Start Encoder Task");

    char message[256];
    int message_len = 0;

    TickType_t last_wake_time = xTaskGetTickCount();

    int encoder_count[3] = {0};
    while (1)
    {

#if NON_PID == 1
        read_rpm(TIME_INTERVAL);
        // read_encoders(encoder_count);
#endif
        // snprintf(message, sizeof(message), "1:%.2f;2:%.2f;3:%.2f\n", encoder_rpm[0], encoder_rpm[1], encoder_rpm[2]);
        // snprintf(message, sizeof(message), "1:%d;2:%d;3:%d\n", encoder_count[0], encoder_count[1], encoder_count[2]);
        message_len = snprintf(message, sizeof(message),
                               "{\"id\":%d,\"type\":\"encoder\",\"data\":[%.2f,%.2f,%.2f]}\n",
                               ID_ROBOT, encoder_rpm[0], encoder_rpm[1], encoder_rpm[2]);
        if (send(sock, message, strlen(message), 0) < 0)
        {
            ESP_LOGE(TAG, "Failed to send encoder data");
        }
        // else
        // {
        //     printf("Sent: %s\n", message);
        // }
        vTaskDelayUntil(&last_wake_time, pdMS_TO_TICKS(TIME_INTERVAL));
    }
}