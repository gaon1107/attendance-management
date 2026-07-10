@echo off
title 라이브니스 데모 서버 (이 창을 닫으면 데모가 꺼집니다)
cd /d "%~dp0"

echo.
echo  ==============================================
echo   라이브니스 데모를 시작합니다.
echo   잠시 후 브라우저가 자동으로 열립니다.
echo   (이 검은 창은 서버입니다 - 닫지 마세요)
echo  ==============================================
echo.

rem 5초 뒤 브라우저 자동 열기 (서버 준비 시간)
start "" /min cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3100"

rem 데모 서버 실행 (포트 3100)
node node_modules\next\dist\bin\next dev --port 3100

echo.
echo 서버가 종료되었습니다. 창을 닫아도 됩니다.
pause
