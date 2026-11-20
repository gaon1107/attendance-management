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

REM ── 이미 켜져 있는 서버 끄기 (2026-11-20 추가) ───────────────────────────────
REM  왜 필요한가: 예전엔 이 단계가 없어서, 서버를 켜 둔 채로 이 파일을 다시 실행하면
REM   ① 아래 .next 삭제가 **실패**한다(돌고 있는 서버가 그 폴더를 잡고 있다 - 2>nul 이라
REM      조용히 넘어가서 눈치채기 어렵다). 그래서 옛 화면이 그대로 뜬다.
REM   ② 3000 포트가 차 있으니 새 서버가 3001로 밀린다. 두 서버가 같은 .next 를 공유해
REM      캐시가 깨지고, 아래 브라우저 열기는 3000(옛 서버)을 가리킨다.
REM  → 그래서 캐시를 지우기 전에 먼저 끈다. 3000/3001 에서 듣고 있는 node 만 고른다
REM    (다른 프로그램이 그 포트를 쓰고 있어도 건드리지 않는다). 끈 뒤 2초 쉬어 포트를 비운다.
echo [4.5] 이미 켜져 있는 서버가 있으면 먼저 끕니다... (포트 3000, 3001)
powershell -NoProfile -Command "$n=0; Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $pr = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($pr -and $pr.ProcessName -eq 'node') { Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue; $n++ } }; if ($n -gt 0) { Start-Sleep -Seconds 2 }"
echo.

echo [4.6] 이전 화면 찌꺼기(캐시) 정리 중... (404 예방)
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
