@echo off
title PC-OFF 프로그램 실행 (개발용)
cd /d "%~dp0"

echo ================================================
echo  PC-OFF 프로그램 (개발 중 버전)
echo ================================================
echo.
echo  이 창은 곧 저절로 닫힙니다.
echo  프로그램은 화면 오른쪽 아래 "숨겨진 아이콘"에
echo  파란 전원 아이콘으로 들어갑니다.
echo.
echo  아이콘을 오른쪽 클릭하면:
echo    연결 설정 / 서버 연결 확인 / 수집하는 정보 / 종료
echo.

echo [1/2] 프로그램 만들기(빌드) 중...
dotnet build src\NewgaonPcOff\NewgaonPcOff.csproj -v q --nologo
if errorlevel 1 goto fail

echo [2/2] 실행합니다...
start "" "src\NewgaonPcOff\bin\Debug\net10.0-windows\NewgaonPcOff.exe"
echo.
echo 완료. 트레이(오른쪽 아래) 아이콘을 확인하세요.
exit /b 0

:fail
echo.
echo [오류] 빌드에 실패했습니다. 위 메시지를 캡처해 알려주세요.
pause
exit /b 1