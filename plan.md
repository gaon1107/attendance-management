# Plan: 전 화면 폭 통일(PC=전체 폭, 모바일=반응형) — 2026-07-09 · 상태: 승인됨(사장님 "진행해줘")

## 1. 접근 방식
- 사장님 결정: **관리자·직원 모두 PC에서는 전체 폭, 좁은 화면에서는 반응형.** 기존 "폼=640px 중앙" 규칙 폐지.
- 폼 화면을 그냥 넓히면 입력칸이 모니터 끝까지 늘어나 흉함 → **2단 카드 배치**로 재구성:
  globals.css에 `.split-2`(2열, 920px 이하에서 1열로 접힘) 공통 클래스 추가 후 각 화면 재배치.
- 디자인 룰 스킬(webapp-design-rules)의 폭 규칙도 새 기준으로 갱신(다음 화면부터 새 규칙 적용).

## 2. 수정 파일 (11 + 문서)
| 파일 | 변경 |
|---|---|
| globals.css | `.split-2` 클래스 추가 (추가만 — 기존 클래스 무수정) |
| attendance/page.tsx | narrow 제거, 상태·버튼 카드 \| 오늘 기록 2단 |
| auth-method/page.tsx | narrow 제거 (선택 카드 2개는 이미 2열) |
| consent/page.tsx | narrow 제거, 안내 4박스 2×2 |
| face-enroll/page.tsx | narrow 제거, 안내+상태 \| 웹캠 2단 |
| account/page.tsx | narrow 제거, 내 정보 \| 비밀번호 변경 2단 |
| settings/page.tsx | narrow 제거, 근무제 \| 네트워크 2단 + 지도 전체 폭 |
| employees/[id]/page.tsx | narrow 제거, 정보 \| 관리 폼들 2단 |
| leave/page.tsx | narrow 제거, KPI 전체 + 신청 폼 \| 내역 2단 |
| corrections/page.tsx | narrow 제거, 요청 폼 \| 내역 2단 |
| notice/page.tsx | narrow 제거, (관리자) 작성 \| 목록 2단, (직원) 목록 전체 |
| .claude/skills/webapp-design-rules | 폭 규칙 문서 갱신 |

## 3. 🛡️ 사이드 이펙트 방어
- AppShell·`.narrow` CSS·`narrow` prop은 **삭제하지 않음**(사용만 제거) → 다른 화면 영향 없음.
- 폼 컴포넌트(WorkRulesForm 등) 내부는 무수정 — 배치만 변경.
- 구현 후 테스트: 대시보드 등 원래 넓던 화면 9개가 그대로인지 + 수정한 10개 화면 데스크톱/모바일(375px).

## 4. TODO
- [x] 1) globals.css `.split-2` ✅
- [x] 2) 직원 화면 (attendance·auth-method·consent·face-enroll·leave·corrections·notice) ✅
- [x] 3) 공통/관리자 화면 (account·settings·employees/[id]) ✅
- [x] 4) tsc 통과 + 브라우저 검증(데스크톱 2단·모바일 375px 1단·가로스크롤 없음·10개 화면 전부) ✅
- [x] 5) 디자인 룰 스킬 갱신 + PROGRESS/현황판 갱신 + git 커밋 ✅

## 5. 구현하지 않을 것
- 로그인 전 화면(랜딩·로그인·가입·초대·온보딩)은 별도 레이아웃 유지 — 이번 범위 아님.
- 표/목록 내용 자체의 재디자인 — 배치(폭)만 다룸.

## 📌 사용자 메모 공간
- 2026-07-09 사장님: "PC는 넓게, 모바일·태블릿은 반응형. UI/UX 잘 고민해서 진행" → 승인됨.
