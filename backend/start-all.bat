@echo off
echo ========================================
echo Starting All Microservices
echo ========================================
echo.

echo Starting API Gateway (Port 5000)...
start cmd /k "cd api-gateway && npm start"

timeout /t 2 /nobreak > nul

echo Starting Auth Service (Port 5001)...
start cmd /k "cd auth-service && npm start"

timeout /t 2 /nobreak > nul

echo Starting User Service (Port 5002)...
start cmd /k "cd user-service && npm start"

timeout /t 2 /nobreak > nul

echo Starting Interview Service (Port 5003)...
start cmd /k "cd interview-service && npm start"

echo.
echo ========================================
echo All services are starting...
echo Check the opened terminal windows
echo ========================================
echo.
echo Press any key to exit this window...
pause > nul
