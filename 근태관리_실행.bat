@echo off
chcp 65001 >nul
title 근태관리 실행
cd /d "%~dp0webapp"

echo ============================================================
echo    근태관리 프로그램을 시작합니다
echo    (프론트 + API + 백엔드 + DB 가 한 프로그램에 들어 있어요)
echo ============================================================
echo.

REM ── 1) 최초 1회만: 필요한 부품 설치 (node_modules 폴더가 없을 때만) ──
if not exist "node_modules" (
  echo [1/4] 최초 설치 중입니다. 처음 한 번은 몇 분 걸려요...
  call npm install
  echo.
)

REM ── 2) 데이터베이스 최신화 (표가 바뀌었으면 반영) ──
echo [2/4] 데이터베이스 준비 중...
call npx prisma migrate deploy
echo.

REM ── 3) DB 연결 코드 새로 만들기 (실패해도 계속 진행) ──
echo [3/4] DB 연결 코드 갱신 중...
call npx prisma generate
echo.

REM ── 4) 서버 켜기 + 브라우저 자동 열기 ──
echo [4/4] 서버를 켭니다. 잠시 후 브라우저가 자동으로 열립니다.
echo.
echo    주소:  http://localhost:3000
echo    로그인: admin@skytech.co.kr / test1234  (관리자)
echo           kim@skytech.co.kr / emp12345    (직원)
echo.
echo    ※ 끄려면 이 검은 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo ============================================================
echo.

REM 서버가 뜰 시간을 잠깐 준 뒤 브라우저 열기
timeout /t 4 /nobreak >nul
start "" http://localhost:3000

call npm run dev

echo.
echo 서버가 종료되었습니다. 창을 닫아도 됩니다.
pause
