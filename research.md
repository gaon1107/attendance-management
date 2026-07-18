# Research: A-2 문자(아이원24) 발송 연동 — 초대·임시비번 (2026-07-18)

## 사장님 결정(확정)
- 채널 = **문자(아이원24 iOne24)** / 범위 = **초대·임시비번만** / 계정 = **시스템 공용(뉴가온, .env)** / 방식 = **버튼 수동 발송 + 1회 제한**(비용 통제).

## 재사용 원천
- `C:\Users\주인님\Desktop\newgaon-LMS\SMS_연동_이식_가이드.md` — 아이원24 API 규격 완비(원본 GFKids/가온출결, Java·Spring).
- ⚠️ **원본은 Java/스프링/MySQL, 우리는 TS/Next.js/SQLite → 코드 복붙 불가. "API 규격만 재사용"해 TS로 재구현.**

## 아이원24 API 규격(가이드에서 확정)
- 발송: `POST http://smsmsgr.ione24.com/slma_action_gaon.ashx`, `Content-Type: application/x-www-form-urlencoded; charset=euc-kr`, **본문 EUC-KR 인코딩**.
- 파라미터: `pslma`(0=SMS/1=LMS), `pid`(계정ID), `ppwd`(비번), `pdestphone`(수신, ; 구분), `psendphone`(발신), `psubject`(LMS 제목), `pmsg`(본문), 나머지 빈값 가능.
- SMS/LMS 자동구분: 본문 **90바이트 이하=SMS, 초과=LMS**(한글 EUC-KR 2바이트).
- **성공판정: 응답 body가 비어있으면 성공**, 내용 있으면 오류메시지(EUC-KR).
- (선택) 잔액조회: GET, `pid`+`ppwd(MD5)`+`pkind=curramt` → `Y:금액`.

## 현재 코드 구조(영향/연결 지점)
- **초대**: `app/actions/invites.ts` `createInvite()` — 익명 토큰 링크만 생성(**수신 전화번호 없음** — 직원이 가입 때 본인정보 입력). UI=`app/employees/InviteLink.tsx`(링크+복사).
  → 문자 발송하려면 **관리자가 보낼 번호를 입력**해야 함. "1회"=**초대 링크 1건당 1회**.
- **임시비번**: `app/actions/password-reset.ts` `issueTempPassword()` — 대상 직원 정해짐, `req.user`에 `phone`(nullable) 있음. 반환 `tempPassword`+`name`. UI=`app/employees/PendingResetRequests.tsx`.
  → **그 직원 phone으로 발송**. phone 없으면 발송 불가(안내). "1회"=**요청 1건당 1회**.
- `User.phone String?`(nullable), `Invite`(token·expiresAt·usedAt), `PasswordResetRequest`(status·resolvedAt).

## 환경/의존성
- `.env` 키(대문자): 추가 예정 `IONE_SMS_ID`, `IONE_SMS_PW`, `IONE_SMS_SENDER`(발신번호), (선택)`IONE_SMS_SEND_URL`. **비밀값=git 제외, 하드코딩 금지**. 실제 계정값은 사장님이 채움.
- **`iconv-lite` 미설치** → EUC-KR 인코딩 위해 추가 필요(순수 JS, 표준). 없으면 한글 깨짐.
- 발송 인프라 0(기존 문자/메일 패키지 없음).

## 🔴 위험/제약
- **실발송 검증 불가(이 환경)**: 실제 문자 발송은 사장님의 아이원24 계정 필요 + **실비용 발생**. 개발 검증은 ①EUC-KR 바이트 정확성 ②파라미터 구성 ③HTTP 호출 모킹 ④빌드·UI까지. **실제 1건 발송 최종확인은 사장님 몫**.
- **비용**: 시스템 공용 계정이라 발송분은 뉴가온 부담 → 버튼 수동 + 1회 제한으로 통제. 발송 로그로 가시화 권장.
- **HTTP(비암호화) 엔드포인트**: 아이원24가 http라 전송구간 평문. 규격상 불가피(외부 API 사양).
- **발신번호 사전등록**: 통신사 정책상 발신번호는 사전 등록된 번호만 허용(아이원24 계정에 등록). 사장님 확인 필요.

## 결론(계획 고려사항)
1. `lib/sms.ts` 신설 — 아이원24 발송 순수/서버 함수(EUC-KR·90바이트 구분·성공판정). 공용 모듈.
2. 발송 이력/1회 제한: `SmsLog` 테이블(비용 가시화+감사+중복차단) 또는 경량 플래그(`smsSentAt`). → 계획에서 선택 제시.
3. 초대: `InviteLink` 옆 "문자로 보내기"(번호 입력+버튼), 링크 1건당 1회.
4. 임시비번: `PendingResetRequests`에서 발급 후 "문자로 보내기"(직원 phone), 요청 1건당 1회.
5. .env 설정 + iconv-lite 추가. 실발송은 사장님 계정으로 최종확인.
