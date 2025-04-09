idf_component_register(SRCS "main.c" "src/encoder_handler.c" "src/log_handler.c" "src/motor_handler.c" "src/wifi_handler.c" "src/omni_control.c" "src/pid_handler.c" "src/kalman_filter.c" "src/LPF.c" "src/bno055_handler.c" "BNO055/bno055.c" "BNO055/nvs_handler.c"
                    INCLUDE_DIRS "." "./inc" "./BNO055/include" )
