#include "motor_handler.h"
#include "gpio_handler.h"

#include "driver/ledc.h"
#include "esp_log.h"

static const char *TAG = "Motor";

#define MAX_PWM 700

int rpm_to_pulse(float rpm)
{
    return rpm * 5.115; // 1023/200 = 5.115
}

void setup_pwm()
{
    // Configure LEDC timer
    ledc_timer_config_t ledc_timer = {
        .speed_mode = LEDC_MODE,
        .timer_num = LEDC_TIMER,
        .duty_resolution = LEDC_DUTY_RES,
        .freq_hz = LEDC_FREQUENCY,
        .clk_cfg = LEDC_AUTO_CLK};
    ledc_timer_config(&ledc_timer);

    // Configure LEDC channels
    ledc_channel_config_t ledc_channel[] = {
        {.channel = LEDC_CHANNEL_0, .duty = 0, .gpio_num = PWM_L1, .speed_mode = LEDC_MODE, .hpoint = 0, .timer_sel = LEDC_TIMER},
        {.channel = LEDC_CHANNEL_1, .duty = 0, .gpio_num = PWM_R1, .speed_mode = LEDC_MODE, .hpoint = 0, .timer_sel = LEDC_TIMER},
        {.channel = LEDC_CHANNEL_2, .duty = 0, .gpio_num = PWM_L2, .speed_mode = LEDC_MODE, .hpoint = 0, .timer_sel = LEDC_TIMER},
        {.channel = LEDC_CHANNEL_3, .duty = 0, .gpio_num = PWM_R2, .speed_mode = LEDC_MODE, .hpoint = 0, .timer_sel = LEDC_TIMER},
        {.channel = LEDC_CHANNEL_4, .duty = 0, .gpio_num = PWM_L3, .speed_mode = LEDC_MODE, .hpoint = 0, .timer_sel = LEDC_TIMER},
        {.channel = LEDC_CHANNEL_5, .duty = 0, .gpio_num = PWM_R3, .speed_mode = LEDC_MODE, .hpoint = 0, .timer_sel = LEDC_TIMER}};

    for (int ch = 0; ch < 6; ch++)
    {
        ledc_channel_config(&ledc_channel[ch]);
    }
    ESP_LOGW(TAG, "Setup Motor Done");
}
// direction = 1: forward, direction = 0: reverse
void set_motor_speed(int motor_id, int direction, int duty)
{
    if (duty < 0)
        duty = 0;
    if (duty > MAX_PWM)
        duty = MAX_PWM;

    switch (motor_id)
    {
    case 1:
        if (direction)
        {
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_0, duty);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_1, 0);
        }
        else
        {
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_0, 0);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_1, duty);
        }
        ledc_update_duty(LEDC_MODE, LEDC_CHANNEL_0);
        ledc_update_duty(LEDC_MODE, LEDC_CHANNEL_1);
        break;
    case 2:
        if (direction)
        {
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_2, duty);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_3, 0);
        }
        else
        {
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_2, 0);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_3, duty);
        }
        ledc_update_duty(LEDC_MODE, LEDC_CHANNEL_2);
        ledc_update_duty(LEDC_MODE, LEDC_CHANNEL_3);
        break;
    case 3:
        if (direction)
        {
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_4, duty);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_5, 0);
        }
        else
        {
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_4, 0);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL_5, duty);
        }
        ledc_update_duty(LEDC_MODE, LEDC_CHANNEL_4);
        ledc_update_duty(LEDC_MODE, LEDC_CHANNEL_5);
        break;
    default:
        ESP_LOGE(TAG, "Invalid motor ID");
        break;
    }
}