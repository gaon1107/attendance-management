---
name: prd-face-detection-gate
description: PRD requirements.md에 명시된 "얼굴검출 실근무시간 산출 범위" 결정 대기 게이트 — 사장님 확정 전까지 UX/UI 설계 착수 금지
metadata:
  type: project
---

2026-07-04, PRD 1차 초안(docs/02_prd/PRD.md, requirements.md, user-flow.md) 작성 완료.
requirements.md §3에 "얼굴검출 기반 실근무시간 산출 범위" 3가지 옵션(A: 출퇴근+수동 이석 / B: 주기적 얼굴검출 샘플링(이미지 미저장) / C: 상시 모니터링)을 제시하고 기획 담당 추천안은 **옵션 B**로 명시했으나, 최종 확정은 사장님 결정 대기 상태.

**Why**: CLAUDE.md 법적 가드레일(얼굴=생체정보=민감정보, 얼굴인증 강제 금지) 및 인권위 판단(상시 감시형 근태관리 위법 소지) 때문에, 프라이버시 트레이드오프가 큰 이 결정을 AI가 임의로 내리지 않고 사장님께 넘기도록 명시적으로 설계함.

**How to apply**: 이후 세션에서 "UX/UI 설계(2단계)"나 "시스템 설계(3단계)"를 진행하려 할 때, 먼저 이 게이트(옵션 A/B/C)가 확정되었는지 확인한다. 확정 안 됐으면 진행 전에 사장님께 재확인. WORKFLOW.md의 [1] 기획(PRD) 단계 게이트("🚦 범위 확정 게이트")와 직접 연결됨 — [[attendance-saas-scope]].
