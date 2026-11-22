# Plan: 회사 해지 2단계 — 해지 30일 뒤 자동 파기 (2026-11-22) — 상태: **승인됨(추천대로), 구현 중**

> 1단계(`a0ceb6c`·`4229f0f`, 11-22 22:58 운영 반영)는 **표시·차단·되살리기**만 했다. 데이터는 그대로 남아 있다.
> 약관 제14조 ④ "이용계약이 끝나면 30일 동안 보관한 뒤 파기" · 처리방침 제2조 "회사명·대표자·관리자 정보 = 계약 종료 후 30일"
> 을 지키려면, 해지 30일이 지난 회사의 데이터를 **사람 손 없이** 지우는 장치가 필요하다.
> 🔴 **되돌릴 수 없는 삭제**다(백업 14일 안에서만 복구 가능). 등급 = 무거움(HIGH), 단계별 보고.

## ✅ 사장님 결정 (2026-11-22, "추천대로 진행")
- ① 해지 회사의 **접속기록(AccessEvent)은 지우지 않는다** — 처리방침에 "2년"으로 따로 공개, 기존 2년 자동 파기에 맡긴다.
- ② 처리방침에 **"파기한 정보는 백업에서 최대 14일 뒤 함께 지워집니다"** 한 줄을 넣는다(원본 문서 `docs/13_legal`도 함께).

---

## 1. 리서치 — 회사 데이터가 있는 곳 (전수)

### 가. DB 표 (전체 43개 중 회사 데이터 38개)
| 묶음 | 표 | 비고 |
|---|---|---|
| 출퇴근 | Attendance · Break · ClockPhoto | Break는 회사 칸 없음 → 출퇴근 id로 |
| 신청·결재 | LeaveRequest · AttendanceCorrection · OutingRequest · RemoteWorkRequest · OvertimeRequest · BusinessTripRequest · ApprovalStep · RequestAttachment · ApprovalLineTemplate | 결재단계·첨부는 외래키 없이 글자로 연결 |
| 교대 | Shift · ShiftGroup · ShiftPattern · RotationRule · ShiftAssignment · ShiftChangeLog | |
| PC 프로그램 | AgentDevice · AgentEvent · AgentPairCode | AgentPairCode는 회사 칸 없음 → 직원 id로 |
| 계정·인증 | User · Session · Invite · PasswordResetRequest · PasswordResetCode · PhoneVerifyCode · BlockedIp | Session은 회사 칸 없음 → 직원 id로 |
| 회사 설정·게시 | Company · Department · JobGrade · CompanyHoliday · CompanyEvent · Announcement · CompanyDocument | |
| 문자 | SmsLog · SmsTemplate | 외래키 없이 회사 id만 |
| **남기는 것** | **AccessEvent(접속기록)** | 결정 ① |
| 회사와 무관 | Holiday · Operator · OperatorSession · AgentPurgeLog · WorkRecordPurgeLog | 건드리지 않는다 |

### 나. 디스크 파일
- `storage/clock-photos/` — 출퇴근 얼굴사진(암호화, 회사 폴더 없음 → ClockPhoto 행의 파일명으로)
- `storage/request-attachments/{회사id}/` — 신청 첨부
- `storage/company-docs/{회사id}/` — 회사 문서 + 로고

### 다. 얼굴인식 서버(GaonFR) — `lib/face-purge.ts` 재사용. 실패하면 그 회사 파기 전체 **보류**(다음 날 재시도).

### 라. 재사용 장치 — `lib/work-record-retention.ts`(파일 먼저→DB, 잘라 지우기, 대장) · `lib/scheduled-jobs.ts`(1시간 예약) · 백업 03:30·14일

---

## 2. 접근 방식
- **언제**: 매일 새벽 1~3시(한국시간)만. **누구**: 해지 30일이 꽉 지난 회사, 하루 최대 3곳.
- **순서**: ① `purgeStartedAt` 표시(되살리기 불가) → ② 얼굴서버 → ③ 파일 → ④ DB 자식부터 500건씩 → ⑤ 직원·부서·회사 → ⑥ `CompanyPurgeLog`.
- **대장**: 회사 id·해지일·파기일·건수·결과·사유. 이름은 남기지 않는다(해지 때의 운영자 기록 "회사이름 (ID 앞 8자리)"로 대조).

## 3. 🛡️ 사고 방지 5겹
1. 회사 id 검사 함수 하나 — 비거나 이상하면 즉시 예외(`where: { companyId: undefined }` = 표 전체 삭제)
2. 지우기 직전 회사마다 "해지 + 30일 경과 + 미래 아님" 재확인
3. 하루 3곳 + 새벽 시간대
4. 파기 시작 표시 → 되살리기 거부(반쯤 지워진 회사가 되살아나지 않게)
5. 검증 시 다른 회사 38개 표 건수 변화 0

## 4. 작업분해
- [ ] **A. 준비** — Company `purgeStartedAt` + `CompanyPurgeLog`(add-only) · 30일 지나면 되살리기 거부 · 파기 예정일 표시
- [ ] **B. 파기 엔진** `lib/company-purge.ts` — 아직 자동으로 안 돈다. 시험 회사로 검증
- [ ] **C. 자동 실행 + 운영자 파기 현황**
- [ ] **D. 처리방침 백업 문구**(결정 ②)
- [ ] **E. code-reviewer 검수 + 문서 갱신**
- [ ] **F. 운영 반영** — 근무시간 밖, 사장님 확인 후

## 6. 구현하지 않을 것
- 파기 전 고객사 알림(보낼 통로 없음) · 운영자 [지금 바로 파기] 버튼(실수 통로) · 백업에서 골라 지우기 · 학원관리 쪽

## 📌 사장님 메모 공간
