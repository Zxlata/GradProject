@echo off
echo ========================================
echo Starting All Microservices (DEV MODE)
echo ========================================
echo.
echo Auto-reload enabled with nodemon
echo.

echo Starting API Gateway (Port 5000)...
start cmd /k "cd api-gateway && npm run dev"

timeout /t 2 /nobreak > nul

echo Starting Auth Service (Port 5001)...
start cmd /k "cd auth-service && npm run dev"

timeout /t 2 /nobreak > nul

echo Starting User Service (Port 5002)...
start cmd /k "cd user-service && npm run dev"

timeout /t 2 /nobreak > nul

echo Starting Interview Service (Port 5003)...
start cmd /k "cd interview-service && npm run dev"

echo.
echo ========================================
echo All services are starting in DEV mode...
echo Files will auto-reload on changes
echo Check the opened terminal windows
echo ========================================
echo.
echo Press any key to exit this window...
pause > nul
