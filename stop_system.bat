@echo off
REM Script to stop all components of the WebDashboard system

title WebDashboard Shutdown

echo [91mStopping WebDashboard system...[0m
echo.

echo [93mClosing connections on port 9002 (TCP WebSocket)...[0m
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :9002') do (
  echo Sending terminate signal to process ID %%p
  taskkill /F /PID %%p >nul 2>nul
)

echo [93mClosing connections on port 9003 (WebSocket Bridge)...[0m
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :9003') do (
  echo Sending terminate signal to process ID %%p
  taskkill /F /PID %%p >nul 2>nul
)

echo [93mClosing connections on port 9000 (TCP Server)...[0m
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :9000') do (
  echo Sending terminate signal to process ID %%p
  taskkill /F /PID %%p >nul 2>nul
)

REM Đợi để đóng kết nối
timeout /t 2 >nul

echo [93mStopping React Frontend...[0m
taskkill /F /FI "WINDOWTITLE eq React Frontend*" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo [92mReact Frontend stopped.[0m
) else (
  echo [91mNo React Frontend process found.[0m
)

echo [93mStopping FastAPI Backend...[0m
taskkill /F /FI "WINDOWTITLE eq FastAPI Backend*" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo [92mFastAPI Backend stopped.[0m
) else (
  echo [91mNo FastAPI Backend process found.[0m
)

echo [93mStopping WebSocket Bridge...[0m
taskkill /F /FI "WINDOWTITLE eq WebSocket Bridge*" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo [92mWebSocket Bridge stopped.[0m
) else (
  echo [91mNo WebSocket Bridge process found.[0m
)

echo [93mStopping TCP Server...[0m
taskkill /F /FI "WINDOWTITLE eq TCP Server*" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo [92mTCP Server stopped.[0m
) else (
  echo [91mNo TCP Server process found.[0m
)

echo.
echo [92mAll components stopped![0m
echo [92mAll network connections closed![0m

timeout /t 3

exit /b 0