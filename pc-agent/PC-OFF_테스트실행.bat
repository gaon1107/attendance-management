@echo off
title PC-OFF 테스트 실행 (60초 자동 해제)
cd /d "%~dp0"

echo ================================================
echo  PC-OFF 테스트 모드 (실제로 잠기는지 확인용)
echo ================================================
echo.
echo  안전장치가 켜집니다:
echo    - 잠금화면은 60초 뒤 스스로 풀립니다.
echo    - 그 뒤로는 저절로 잠기지 않습니다 (실행당 1회만).
echo    - 트레이 메뉴에 [테스트] 잠금화면 미리보기 항목이 생깁니다.
echo      (원할 때마다 잠금화면을 다시 볼 수 있습니다)
echo.
echo  평소 사용은 PC-OFF_실행.bat 을 써주세요.
echo.

rem 이미 켜져 있으면 실행 파일이 잠겨 빌드가 실패한다. 먼저 끈다.
taskkill /IM NewgaonPcOff.exe /F > nul 2> nul

echo [1/2] 프로그램 만들기(빌드) 중...
dotnet build src\NewgaonPcOff\NewgaonPcOff.csproj -v q --nologo
if errorlevel 1 goto fail

echo [2/2] 테스트 모드로 실행합니다...
start "" "src\NewgaonPcOff\bin\Debug\net10.0-windows\NewgaonPcOff.exe" --test-mode
echo.
echo 완료. 트레이(오른쪽 아래) 아이콘을 확인해주세요.
exit /b 0

:fail
echo.
echo [오류] 빌드에 실패했습니다. 위 메시지를 캡처해 알려주세요.
pause
exit /b 1
