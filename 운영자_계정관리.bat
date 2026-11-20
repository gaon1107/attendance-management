@echo off
REM  [중요] EnableDelayedExpansion + !변수! 를 쓴다. %변수% 는 **값을 문장에 글자로 끼워 넣은 뒤**
REM   해석하므로, 사장님이 입력칸에 따옴표(")·앰퍼샌드(&)·캐럿(^)·파이프(|)를 넣으면
REM   ① 문장이 깨져 창이 설명 없이 즉시 닫히거나 ② 화면에 보이는 값과 저장되는 값이 달라진다.
REM   둘 다 2026-11-20 검수에서 실측된 중간 등급이다. !변수! 는 해석이 끝난 뒤에 값을 넣으므로
REM   특수문자가 섞여도 글자 그대로 다뤄진다.
REM   [남은 한계] 이 방식에서는 입력에 느낌표(!)가 있으면 그 글자가 사라진다. 이메일·이름에
REM   느낌표를 쓰는 경우가 사실상 없고, 비밀번호는 아래 PowerShell 이 따로 받으므로 영향 없다.
setlocal EnableDelayedExpansion
title 운영자 계정 관리 (이 PC)
REM  cd 가 실패하면 cmd 가 영어 섞인 경고를 먼저 뱉어 비개발자를 놀라게 한다. 숨기고,
REM  바로 아래 검사에서 우리 안내문으로 설명한다.
cd /d "%~dp0webapp" 2>nul

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

REM  [함정] 괄호로 묶은 if 블록 안에서 echo 문구에 ")" 를 쓰면 **그 자리에서 블록이 끝난다.**
REM   2026-11-20 이걸로 사고가 났다: 안내문에 "(지금 위치: ...)" 를 넣었더니 그 뒤의
REM   pause/exit 가 조건과 상관없이 **항상** 실행돼, 더블클릭하면 창이 떴다가 엔터 한 번에
REM   닫히고 메뉴가 아예 나오지 않았다. 그래서 블록을 쓰지 않고 goto 로 분기한다.
REM   아래 :noprog 처럼 echo 문구에도 괄호를 넣지 않는다.
if not exist "scripts\create-operator.mjs" goto noprog

REM  [안전장치] 키보드가 아닌 곳에서 실행되면(자동화·작업 스케줄러·입력 리다이렉트)
REM   set /p 가 아무것도 못 받고 즉시 돌아와 :menu 가 **CPU를 태우며 영원히 반복**된다.
REM   2026-11-20 실측(검증 중 2분간 멈춤). 빈 입력이 연달아 20번이면 설명하고 끝낸다.
REM   사람이 엔터만 20번 연달아 누르는 일은 없으므로 손으로 쓸 때는 걸리지 않는다.
set "emptyhits=0"

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
if defined sel goto menupick
set /a emptyhits+=1
if !emptyhits! GEQ 20 goto stuck
goto menu

:menupick
set "emptyhits=0"
if "!sel!"=="1" goto list
if "!sel!"=="2" goto resetpw
if "!sel!"=="3" goto changeid
if "!sel!"=="4" goto unlock
if "!sel!"=="5" goto create
if "!sel!"=="6" goto onoff
if "!sel!"=="0" exit /b
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
if not defined email goto menu
echo.
echo    [확인] 이 계정의 비밀번호를 바꿉니다.
echo             !email!
echo.
REM  3번(아이디 바꾸기)과 같은 확인 단계. 운영자가 둘 이상이 되면 "엉뚱한 사람의 비밀번호가
REM  조용히 바뀌는" 사고가 나므로, 되돌릴 수 없는 작업 앞에는 전부 이 단계를 둔다.
set "ok="
set /p ok=이대로 바꿀까요? 바꾸려면 y 를 누르고 엔터:
if /i not "!ok!"=="y" goto menu
set "OP_EMAIL=!email!"
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
if not defined oldid goto menu
set "newid="
set /p newid=새 아이디:
if not defined newid goto menu
echo.
echo    [확인] !oldid!
echo             -^> !newid!
echo.
set "ok="
set /p ok=이대로 바꿀까요? 바꾸려면 y 를 누르고 엔터:
if /i not "!ok!"=="y" goto menu
set "OP_EMAIL=!oldid!"
set "OP_NEW_EMAIL=!newid!"
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
if not defined email goto menu
set "OP_EMAIL=!email!"
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
echo    * 이미 있는 아이디로는 만들 수 없습니다. 비밀번호를 바꾸려면 2번을 쓰세요.
echo.
REM  다른 메뉴처럼 --list 를 먼저 돌린다. 이유가 둘이다:
REM   ① "지금 보는 곳: 이 PC(개발용)" 이 찍혀, 운영 서버에 만든 것으로 착각하는 사고를 막는다.
REM   ② 이미 있는 아이디가 함께 보여 중복 입력을 미리 피한다.
REM  :create 첫 줄 cls 가 메뉴의 경고를 지우므로, 이 줄이 없으면 5번에만 안내가 사라진다.
node scripts/create-operator.mjs --list
echo.
set "email="
set /p email=새 아이디(이메일):
if not defined email goto menu
set "who="
set /p who=이름(화면과 기록에 표시됩니다):
if not defined who goto menu
set "OP_EMAIL=!email!"
set "OP_NAME=!who!"
echo.
echo    [확인] !email!  ·  !who!
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
echo    끄면 그 계정으로 로그인할 수 없게 됩니다. 지우는 것은 아닙니다.
echo.
node scripts/create-operator.mjs --list
echo.
set "email="
set /p email=대상 아이디:
if not defined email goto menu
set "onoffsel="
set /p onoffsel=끄려면 1, 켜려면 2 를 누르고 엔터:
set "OP_EMAIL=!email!"
echo.
if "!onoffsel!"=="1" node scripts/create-operator.mjs --off-env
if "!onoffsel!"=="2" node scripts/create-operator.mjs --on-env
if not "!onoffsel!"=="1" if not "!onoffsel!"=="2" echo    1 또는 2 가 아니어서 아무것도 하지 않았습니다.
set "OP_EMAIL="
echo.
pause
goto menu

:stuck
echo.
echo  [안내] 키보드 입력을 받을 수 없어 끝냅니다.
echo         이 창은 사람이 직접 눌러 쓰는 도구입니다.
echo.
exit /b 1

:noprog
echo.
echo  [오류] 프로그램 파일을 찾을 수 없습니다.
echo         이 파일은 근태관리 폴더 안에 든 채로 실행해야 합니다.
echo         지금 위치는 %CD% 입니다.
echo.
pause
exit /b 1
