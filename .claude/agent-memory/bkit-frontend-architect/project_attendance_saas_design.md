---
name: project-attendance-saas-design
description: 근태관리 SaaS UX/UI 설계 진행 상태 — 화면목록/와이어프레임/디자인토큰 완료, 다음은 사장님 검토 게이트
metadata:
  type: project
---

근태관리 SaaS(중소기업 사무직 대상, 얼굴인증 선택형+GPS 대체) 프로젝트의 UX/UI 설계(3단계) 산출물 현황.

- `docs/03_design/screen-inventory.md`: 화면 목록 39개(P0 30개), 2026-07-04 승인 완료.
- `docs/03_design/wireframes.md`: 핵심 흐름 와이어프레임(직원 출퇴근/조회/삭제, 관리자 온보딩/대시보드/직원관리/근태조회/리포트/생체정보관리, 공개 랜딩/가입/로그인) 작성 완료 (2026-07-04).
- `docs/03_design/design-tokens.md`: 색상/타이포/간격/모서리/버튼·입력 상태/접근성(44px 터치, 4.5:1 대비) 기본안 작성 완료, 값은 전부 "확정 아님" 표기.

**Why**: 실근무시간 산출 방식은 requirements.md §3에서 옵션 B(주기적 얼굴검출, 이미지 미저장)로 확정되었으나, 5단계 보안·법무 검토(security-architect)에서 재확인 필요 — 방식이 바뀌면 "근무 중 자리확인 안내" 화면의 문구·동작을 다시 손봐야 한다.

**How to apply**: 이후 대화에서 이 프로젝트의 UI 작업을 이어갈 때, 화면 개수·우선순위(P0/P1/P2)는 screen-inventory.md를 기준으로 삼고 임의로 화면을 추가하지 않는다. 결제/요금제 관련 화면은 P1(파일럿 이후)로 이미 조정되어 있으므로 별도 지시 없이는 만들지 않는다. 옵션 B가 5단계에서 조정될 경우 wireframes.md의 1-8 화면(자리확인 안내)을 함께 갱신해야 함을 기억할 것.

관련: [[feedback-project-report-format]]
