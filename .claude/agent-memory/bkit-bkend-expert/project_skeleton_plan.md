---
name: project-skeleton-plan
description: 근태관리 SaaS의 bkend.ai walking skeleton 계획 상태와 미확정 기술 이슈
metadata:
  type: project
---

근태관리 SaaS(1차 MVP)의 backend를 bkend.ai(BaaS)로 구현하기로 하고, 2026-07-04에 `docs/05_backend/skeleton-plan.md`(walking skeleton 계획서)를 작성해 사장님 승인 대기 중이다.

**스켈레톤 범위**: 회사가입 → 로그인 → 직원등록/목록 → GPS 출퇴근 → 오늘 근태 대시보드. 얼굴인증·옵션B·리포트·결제는 이번엔 제외.

**미확정/재확인 필요 사항 (구현 착수 시 다시 볼 것)**:
1. bkend.ai가 커스텀 서버 함수(서버리스 로직)를 지원하는지 문서상 확인 안 됨 → 계획서는 "Next.js API Route로 GPS 거리계산을 얇게 중계"하는 B안을 권장안으로 채택. 착수 시 `search_docs`로 A안(bkend 자체 지원) 가능 여부 재확인 필요.
2. bkend.ai의 "초대(invitation)" 기능은 조직/프로젝트 팀원 초대용이지 우리 앱의 "회사가 직원을 등록"하는 기능과 다름 → 스켈레톤에서는 관리자가 직접 직원 Auth 계정을 생성하는 방식으로 간소화함.
3. RLS `rowFilters` 문법은 공개 문서 기준 추정치. 실제 콘솔/MCP에서 정확한 설정 방법 재확인 필요.

**Why**: 사장님은 비개발자이며 CLAUDE.md 규칙상 "중요한 결정(기능 범위·비용/법적 트레이드오프)"에서만 승인 게이트를 거는 반자동 모드로 진행 중. 이 프로젝트는 [[attendance-saas-scope]]에서 정의한 1차 MVP 로드맵의 [6] 개발 단계에 해당.

**How to apply**: 이 프로젝트의 bkend.ai 관련 작업을 이어갈 때는 항상 `docs/05_backend/skeleton-plan.md`를 먼저 확인하고, 위 미확정 사항이 실제 구현 전 재검증됐는지 체크할 것. PROGRESS.md의 "현재 단계"도 함께 확인.
