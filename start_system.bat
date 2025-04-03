@echo off
REM Script to start all components of the WebDashboard system

REM Set environment paths
SET PATH=%PATH%;C:\Python311;C:\Python311\Scripts;C:\Program Files\nodejs

REM Set environment variables for ports
set TCP_PORT=9000
set WS_BRIDGE_PORT=9003
set API_PORT=9004
set LOG_LEVEL=INFO
set LOG_HEARTBEATS=0
set LOG_DETAILED_MESSAGES=1

REM Kill running processes
echo Stopping any running services...
taskkill /F /FI "WINDOWTITLE eq DirectBridge*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq FastAPI Backend*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq React Frontend*" >nul 2>nul

REM Free up used ports
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :%TCP_PORT%') do (
  echo Killing process using port %TCP_PORT% (PID: %%p)
  taskkill /F /PID %%p >nul 2>nul
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :%WS_BRIDGE_PORT%') do (
  echo Killing process using port %WS_BRIDGE_PORT% (PID: %%p)
  taskkill /F /PID %%p >nul 2>nul
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :%API_PORT%') do (
  echo Killing process using port %API_PORT% (PID: %%p)
  taskkill /F /PID %%p >nul 2>nul
)

IF NOT EXIST ".\back\.env" (
  echo Warning: Backend .env file not found. Creating default...
  copy NUL ".\back\.env"
  echo # Backend environment variables >> ".\back\.env"
  echo API_HOST=0.0.0.0 >> ".\back\.env"
  echo API_PORT=%API_PORT% >> ".\back\.env"
  echo TCP_HOST=0.0.0.0 >> ".\back\.env"
  echo TCP_PORT=%TCP_PORT% >> ".\back\.env"
  echo WS_BRIDGE_HOST=0.0.0.0 >> ".\back\.env"
  echo WS_BRIDGE_PORT=%WS_BRIDGE_PORT% >> ".\back\.env"
  echo LOG_LEVEL=%LOG_LEVEL% >> ".\back\.env"
  echo LOG_HEARTBEATS=%LOG_HEARTBEATS% >> ".\back\.env"
  echo LOG_DETAILED_MESSAGES=%LOG_DETAILED_MESSAGES% >> ".\back\.env"
)

IF NOT EXIST ".\front\.env" (
  echo Warning: Frontend .env file not found. Creating default...
  copy NUL ".\front\.env"
  echo # Frontend environment variables >> ".\front\.env"
  echo REACT_APP_API_URL=http://localhost:%API_PORT% >> ".\front\.env"
  echo REACT_APP_WS_URL=ws://localhost:%API_PORT%/ws >> ".\front\.env"
  echo REACT_APP_WS_BRIDGE_URL=ws://localhost:%WS_BRIDGE_PORT% >> ".\front\.env"
)

REM Create temporary config file
echo LOG_LEVEL=%LOG_LEVEL%> ".\back\env_config.txt"
echo LOG_HEARTBEATS=%LOG_HEARTBEATS%>> ".\back\env_config.txt"
echo LOG_DETAILED_MESSAGES=%LOG_DETAILED_MESSAGES%>> ".\back\env_config.txt"
echo TCP_PORT=%TCP_PORT%>> ".\back\env_config.txt"
echo WS_BRIDGE_PORT=%WS_BRIDGE_PORT%>> ".\back\env_config.txt"
echo API_PORT=%API_PORT%>> ".\back\env_config.txt"

REM Display starting message
echo Starting WebDashboard system...
echo.
echo This will start:
echo 1. DirectBridge (TCP port %TCP_PORT%, WebSocket port %WS_BRIDGE_PORT%, API port %API_PORT%)
echo 2. FastAPI Backend (port %API_PORT%)
echo 3. React Frontend (port 3000)
echo.
echo Press Ctrl+C in any window to stop that component
echo.

REM Create logs directory if it doesn't exist
if not exist ".\back\logs" mkdir ".\back\logs"

REM Start DirectBridge with environment variables
echo Starting DirectBridge...
start cmd /k "title DirectBridge && cd /d .\back && set LOG_LEVEL=%LOG_LEVEL% && set LOG_HEARTBEATS=%LOG_HEARTBEATS% && set LOG_DETAILED_MESSAGES=%LOG_DETAILED_MESSAGES% && set TCP_PORT=%TCP_PORT% && set WS_BRIDGE_PORT=%WS_BRIDGE_PORT% && set API_PORT=%API_PORT% && python direct_bridge.py --tcp-port %TCP_PORT% --ws-port %WS_BRIDGE_PORT% --api-port %API_PORT% --log-level %LOG_LEVEL%"
timeout /t 5

REM Start FastAPI Backend
echo Starting FastAPI Backend...
start cmd /k "title FastAPI Backend && cd /d .\back && set LOG_LEVEL=%LOG_LEVEL% && python main.py"
timeout /t 5

REM Start React Frontend (React automatically loads .env)
echo Starting React Frontend...
start cmd /k "title React Frontend && cd /d .\front && npm start"

echo.
echo All components started!
echo.
echo System running at:
echo - DirectBridge TCP Server: localhost:%TCP_PORT%
echo - DirectBridge WebSocket: ws://localhost:%WS_BRIDGE_PORT%
echo - FastAPI: http://localhost:%API_PORT%
echo - Frontend: http://localhost:3000
echo.
echo To stop all services, press any key to close this window, then run stop_system.bat
pause > nul