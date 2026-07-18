# Plan: A-2 문자(아이원24) 발송 — 초대·임시비번 (2026-07-18) — 상태: 검토 대기

## 확정 전제(사장님 결정)
문자(아이원24) / 초대·임시비번만 / 시스템 공용 계정(.env) / **버튼 수동 발송 + 1회 제한**(비용 통제).

## 1. 접근 방식
- 원본(Java) **코드가 아니라 아이원24 API 규격만 재사용** → `lib/sms.ts`에 TypeScript로 재구현.
- 문자는 **부가 수단**: 초대하면 링크는 지금처럼 화면에 뜸(무료). 관리자가 **"문자로 보내기"를 눌러야** 발송(유료) → 비용을 사람이 직접 통제.
- **1회 제한 + 발송 로그**: 새 `SmsLog` 테이블로 ①같은 초대/요청 중복발송 차단 ②나중에 회사별 발송량·비용 확인 근거.

## 2. 수정/생성 파일
| # | 파일 | 변경 |
|---|---|---|
| 1 | `package.json` | `iconv-lite` 추가(EUC-KR 인코딩, 순수 JS 표준) |
| 2 | `lib/sms.ts` (신규) | 아이원24 발송: `smsByteLength`(EUC-KR)·`sendSms({to,text,subject})`·성공판정·SMS/LMS 자동구분. env에서 계정 읽기(없으면 안전 실패) |
| 3 | `prisma/schema.prisma` (+마이그레이션) | `SmsLog`(companyId·userId?·kind·refId·toNumber·result·detail?·createdAt). ⚠️서버 끄기 |
| 4 | `app/actions/sms.ts` (신규) | `sendInviteSms(inviteId,url,to)`·`sendTempPasswordSms(requestId,temp,to?)` — admin+회사격리+1회+로그 |
| 5 | `app/employees/InviteLink.tsx` | 전화번호 입력 + "문자로 보내기" 버튼(발송 후 '발송됨' 표시) |
| 6 | `app/employees/PendingResetRequests.tsx` | 임시비번 발급 후 "문자로 보내기"(직원 phone, 없으면 비활성+안내) |

## 3. 아이원24 발송 로직(lib/sms.ts 핵심)
```
sendSms({to, text, subject?}):
  계정 = env(IONE_SMS_ID/PW/SENDER); 하나라도 없으면 {ok:false, detail:"발송계정 미설정"} (throw 안 함)
  pslma = smsByteLength(text) <= 90 ? "0"(SMS) : "1"(LMS)
  params = {pslma,pid,ppwd,pdestphone:to(하이픈제거),psendphone:SENDER,psubject,pmsg:text, 나머지 ""}
  body = EUC-KR로 form-urlencode (iconv-lite)
  POST send-url, Content-Type: ...charset=euc-kr
  응답 body(EUC-KR) 비어있으면 성공 → {ok:true}, 아니면 {ok:false, detail:응답}
  네트워크 예외 → {ok:false, detail} (본기능 안 막음)
```
- 메시지 문구(짧게): 초대="[{회사}] 근태관리 초대입니다. {url} (7일 이내 가입)" / 임시비번="[{회사}] 임시 비밀번호: {temp} — 로그인 후 변경해 주세요."

## 4. 🛡️ 사이드 이펙트 방어
- **문자는 부가기능**: 발송 실패·계정 미설정이어도 **초대 생성·임시비번 발급 본기능은 그대로**(독립). 화면에만 실패 안내.
- **회사격리**: 두 발송 액션 모두 admin + `companyId` 재검증. 초대는 미사용·미만료도 확인.
- **1회 제한**: `SmsLog`에 (kind,refId,result=success) 있으면 재발송 차단(버튼 비활성/안내).
- **전화번호**: 하이픈 제거·숫자만·최소 자릿수 검증. 임시비번은 직원 phone 없으면 발송 불가 안내.
- **비밀정보**: 계정·발신번호는 .env(하드코딩 금지). SmsLog에 **임시비밀번호 본문 저장 안 함**(발송 사실·수신번호·성공여부만).
- **구현 후 테스트할 기존 기능**: ①초대 생성/취소/가입 ②비번 재설정 요청/발급 ③직원관리 화면 렌더 ④일반 흐름 회귀.

## 5. 작업분해 TODO
- [ ] 1. `iconv-lite` 추가 + `lib/sms.ts`(발송·바이트계산·성공판정) + **단위테스트**(EUC-KR 바이트수, 90byte SMS/LMS 경계, 파라미터 구성, 성공/실패 판정 모킹, 계정미설정 안전실패)
- [ ] 2. `SmsLog` 스키마 + 마이그레이션(서버 끄고 generate)
- [ ] 3. `app/actions/sms.ts`(sendInviteSms·sendTempPasswordSms — 회사격리·1회·로그·안전실패)
- [ ] 4. UI: InviteLink 문자발송(번호입력+버튼), PendingResetRequests 문자발송
- [ ] 5. 검증: 빌드·tsc·eslint / EUC-KR 바이트 실측 / HTTP 모킹 실행 / 실화면 버튼 렌더·1회제한 동작 + **사장님 실발송 안내서**
- [ ] 6. code-reviewer 검수 + project-status.md 갱신

## 6. 구현하지 않을 것(범위 제외)
- 관리자 자유 문자 발송(공지·안내) — LMS식, 파일럿 이후.
- 이메일(SMTP/SES) — 이번 채널은 문자만.
- 회사별 월 발송 한도·잔액조회 화면 — 지금은 버튼수동+1회로 통제, 한도는 향후(SmsLog가 근거 됨).
- 알림톡·템플릿·MMS·예약발송.

## ⚠️ 검증 한계(중요)
- **이 환경에선 실제 문자를 못 보냅니다**(계정·실비용 필요). 개발 검증 = EUC-KR 바이트·파라미터·모킹·빌드·UI까지. **실제 1건 발송 최종확인은 사장님이 아이원24 계정 넣고** 직접(‑ 발송비 발생). 발신번호는 아이원24에 사전등록된 번호여야 함.

## 📌 사용자 메모 공간
- (예: SmsLog 대신 경량 플래그로? / 메시지 문구 수정 / 회사별 월 한도 지금 넣을지 / 발신번호·계정ID)
-
