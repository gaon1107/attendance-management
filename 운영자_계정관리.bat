@echo off
title 운영자 계정 관리 (이 PC)
cd /d "%~dp0webapp"

REM == 운영자(본사) 계정 관리 도우미 (2026-11-20) ==============================
REM  왜 만들었나: 운영자 계정은 웹에 비밀번호 찾기 창구가 없다(일부러 그렇다 - 회원사
REM   전체를 보는 계정이라 그 통로가 곧 공격 표적이 된다). 그래서 잊으면 명령을 쳐야 하는데
REM   비개발자에게는 그 자체가 벽이다. 이 파일이 대신 쳐 준다.
REM
REM  [중요] 값은 **환경변수로** 넘긴다(--reset-env / --email-env ...). 명령 인자로 주면
REM   ① PowerShell이 따옴표를 먹어 **사장님이 친 것과 다른 비밀번호가 저장되고**
REM   ② 실행 중 프로세스 목록에 비밀번호가 그대로 보인다. 둘 다 2026-11-20 검수 치명이다.
REM   그래서 이 파일에는 node 인자로 값을 넘기는 줄이 하나도 없어야 한다.
REM  [중요] `call node` 를 쓰지 않는다 - call 이 캐럿(^)을 한 번 더 escape 해서 입력과
REM   다른 값이 들어간다(zz^a@x.com -> zz^^a@x.com).
REM  [주의] 실제 일은 전부 webapp\scripts\create-operator.mjs 가 한다. 규칙(길이·중복·형식)도 그쪽.

if not exist "scripts\create-operator.mjs" (
  echo.
  echo  [오류] 프로그램 파일을 찾을 수 없습니다.
  echo         이 파일은 근태관리 폴더 안에 둔 채로 실행해야 합니다.
  echo         (지금 위치: %CD%)
  echo.
  pause
  exit /b 1
)

:menu
cls
echo ============================================================
echo    운영자 계정 관리
echo ------------------------------------------------------------
echo    * 여기는 [이 PC(개발용)] 계정입니다.
echo      운영 서버(attend.newgaon.com) 계정은 그 서버에서 바꿉니다.
echo ============================================================
echo.
echo    1) 계정 목록 보기
echo    2) 비밀번호 바꾸기
echo    3) 아이디(이메일) 바꾸기
echo    4) 로그인 잠금 풀기
echo    5) 새 계정 만들기
echo    6) 계정 끄기 / 켜기
echo.
echo    0) 끝내기
echo.
set "sel="
set /p sel=번호를 누르고 엔터: 
if "%sel%"=="1" goto list
if "%sel%"=="2" goto resetpw
if "%sel%"=="3" goto changeid
if "%sel%"=="4" goto unlock
if "%sel%"=="5" goto create
if "%sel%"=="6" goto onoff
if "%sel%"=="0" exit /b
goto menu

:list
cls
echo [계정 목록]
echo.
node scripts/create-operator.mjs --list
echo.
pause
goto menu

:resetpw
cls
echo [비밀번호 바꾸기]
echo.
node scripts/create-operator.mjs --list
echo.
set "email="
set /p email=바꿀 계정의 아이디(이메일): 
if "%email%"=="" goto menu
set "OP_EMAIL=%email%"
echo.
echo    새 비밀번호를 두 번 입력합니다. 오타를 막기 위해서입니다.
echo    * 타이핑해도 화면에 아무것도 안 보입니다. 정상입니다.
echo    * 띄어쓰기를 넣은 짧은 문장이 외우기 쉽고 안전합니다.
echo.
powershell -NoProfile -Command "$a = Read-Host 'New password' -AsSecureString; $b = Read-Host 'Same again' -AsSecureString; $p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a)); $p2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b)); if (-not $p1) { Write-Host '[x] 입력이 비어 있습니다.'; exit 1 }; if ($p1 -ne $p2) { Write-Host '[x] 두 번 입력한 값이 서로 다릅니다. 다시 해주세요.'; exit 1 }; $env:OP_NEW_PW = $p1; node scripts/create-operator.mjs --reset-env"
set "OP_EMAIL="
echo.
pause
goto menu

:changeid
cls
echo [아이디(이메일) 바꾸기]
echo.
node scripts/create-operator.mjs --list
echo.
echo    * 비밀번호는 그대로 유지됩니다.
echo    * 열려 있던 로그인은 모두 끊기고, 새 아이디로 다시 로그인하게 됩니다.
echo.
set "oldid="
set /p oldid=지금 아이디: 
if "%oldid%"=="" goto menu
set "newid="
set /p newid=새 아이디: 
if "%newid%"=="" goto menu
echo.
echo    [확인] %oldid%
echo             -^> %newid%
echo.
set "ok="
set /p ok=이대로 바꿀까요? 바꾸려면 y 를 누르고 엔터: 
if /i not "%ok%"=="y" goto menu
set "OP_EMAIL=%oldid%"
set "OP_NEW_EMAIL=%newid%"
echo.
node scripts/create-operator.mjs --email-env
set "OP_EMAIL="
set "OP_NEW_EMAIL="
echo.
pause
goto menu

:unlock
cls
echo [로그인 잠금 풀기]
echo.
echo    비밀번호를 5번 틀리면 10분 동안 잠깁니다. 기다리지 않고 바로 풀 때 씁니다.
echo.
node scripts/create-operator.mjs --list
echo.
set "email="
set /p email=잠금을 풀 아이디: 
if "%email%"=="" goto menu
set "OP_EMAIL=%email%"
echo.
node scripts/create-operator.mjs --unlock-env
set "OP_EMAIL="
echo.
pause
goto menu

:create
cls
echo [새 계정 만들기]
echo.
echo    * 이미 있는 아이디로는 만들 수 없습니다(비밀번호를 바꾸려면 2번을 쓰세요).
echo.
set "email="
set /p email=새 아이디(이메일): 
if "%email%"=="" goto menu
set "who="
set /p who=이름(화면과 기록에 표시됩니다): 
if "%who%"=="" goto menu
set "OP_EMAIL=%email%"
set "OP_NAME=%who%"
echo.
echo    비밀번호를 두 번 입력합니다.
echo    * 타이핑해도 화면에 아무것도 안 보입니다. 정상입니다.
echo.
powershell -NoProfile -Command "$a = Read-Host 'New password' -AsSecureString; $b = Read-Host 'Same again' -AsSecureString; $p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a)); $p2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b)); if (-not $p1) { Write-Host '[x] 입력이 비어 있습니다.'; exit 1 }; if ($p1 -ne $p2) { Write-Host '[x] 두 번 입력한 값이 서로 다릅니다. 다시 해주세요.'; exit 1 }; $env:OP_NEW_PW = $p1; node scripts/create-operator.mjs --create-env"
set "OP_EMAIL="
set "OP_NAME="
echo.
pause
goto menu

:onoff
cls
echo [계정 끄기 / 켜기]
echo.
echo    끄면 그 계정으로 로그인할 수 없게 됩니다(지우는 것은 아닙니다).
echo.
node scripts/create-operator.mjs --list
echo.
set "email="
set /p email=대상 아이디: 
if "%email%"=="" goto menu
set "onoffsel="
set /p onoffsel=끄려면 1, 켜려면 2 를 누르고 엔터: 
set "OP_EMAIL=%email%"
echo.
if "%onoffsel%"=="1" node scripts/create-operator.mjs --off-env
if "%onoffsel%"=="2" node scripts/create-operator.mjs --on-env
if not "%onoffsel%"=="1" if not "%onoffsel%"=="2" echo    (1 또는 2 가 아니어서 아무것도 하지 않았습니다)
set "OP_EMAIL="
echo.
pause
goto menu
