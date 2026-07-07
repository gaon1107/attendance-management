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

echo [4/4] 서버를 켭니다. 잠시 후 브라우저가 자동으로 열립니다.
echo.
echo    주소:  http://localhost:3000
echo    로그인: admin@skytech.co.kr / test1234  (관리자)
echo           kim@skytech.co.kr / emp12345    (직원)
echo.
echo    * 끄려면 이 검은 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo ============================================================
echo.

timeout /t 4 /nobreak >nul
start "" http://localhost:3000

call npm run dev

echo.
echo 서버가 종료되었습니다. 창을 닫아도 됩니다.
pause