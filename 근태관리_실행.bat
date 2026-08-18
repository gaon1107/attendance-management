@echo off
title 근태관리 실행
cd /d "%~dp0webapp"

echo ============================================================
echo    근태관리 프로그램을 시작합니다
echo    (프론트 + API + 백엔드 + DB 가 한 프로그램에 들어 있어요)
echo ============================================================
echo.

if not exist "node_modules" (
  echo [1/4] 최초 설치 중입니다. 처음 한 번은 몇 분 걸려요...
  call npm install
  echo.
)

echo [2/4] 데이터베이스 준비 중...
call npx prisma migrate deploy
echo.

echo [3/4] DB 연결 코드 갱신 중...
call npx prisma generate
echo.

echo [4/4] 서버를 켭니다. 준비가 끝나면 브라우저 두 개가 자동으로 열립니다.
echo.
echo    직원/관리자 화면:  http://localhost:3000
echo    운영자 화면(본사): http://localhost:3000/operator/login
echo.
echo    로그인 계정은 별도로 안내받은 것을 사용하세요.
echo.
echo    * 끄려면 이 검은 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo ============================================================
echo.

echo [4.5] 이전 화면 찌꺼기(캐시) 정리 중... (404 예방)
rd /s /q ".next" 2>nul
echo.

REM ── 서버가 "실제로 응답할 때까지" 기다렸다가 화면 두 개를 연다 ──────────────
REM  왜 이렇게 하나: 예전에는 4초만 세고 열었는데, 바로 아래 npm run dev 가 그 뒤에
REM  시작되므로 브라우저가 항상 서버보다 먼저 열려 "연결할 수 없음"이 떴다(새로고침 필요).
REM  이 줄은 별도 창에서 조용히 돌면서 2초마다 서버를 두드려 보고, 응답이 오면 그때 연다.
REM  최대 5분(150회)까지만 기다리고 스스로 끝난다. 이 창에서 도는 것이 아니라 아래 서버 실행을 막지 않는다.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0; $i -lt 150; $i++){ try { $null = Invoke-WebRequest -Uri 'http://localhost:3000/' -TimeoutSec 3 -UseBasicParsing; Start-Process 'http://localhost:3000/'; Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:3000/operator/login'; break } catch { Start-Sleep -Seconds 2 } }"

call npm run dev

echo.
echo 서버가 종료되었습니다. 창을 닫아도 됩니다.
pause
