# Plan: BlockedIpClient eslint(set-state-in-effect) 정리 — 2026-07-23 — 상태: 검토 대기

> 목표: 차단 IP 화면의 eslint error 1건 제거. **눈에 보이는 동작은 전혀 바뀌지 않는다**(입력칸 비우기 UX 그대로).

## 1. 접근 방식 (+이유)

**채택: ③ 렌더 중 이전값 비교 패턴** (usePagination과 동일)

`useEffect`로 "나중에" 지우는 대신, **렌더하는 순간 "저장 결과가 새로 왔고 성공이면" 입력칸을 비운다.** React가 화면을 그리기 전에 정리되므로 화면 깜빡임·연쇄 렌더가 없고, eslint 규칙도 통과한다.

| 후보 | 판단 |
|---|---|
| ① form key 리마운트 | ❌ 입력칸이 React 상태(`pattern`)로 제어되므로 폼만 다시 그려도 값이 안 지워짐 |
| ② 비제어 입력 + ref.reset() | ❌ "폼에 채우기" 버튼이 값을 넣어야 해서 구조를 더 크게 뜯어야 함(위험↑) |
| **③ 렌더 중 이전값 비교** | ✅ **채택** — 6줄 수정, 프로젝트에 이미 검증된 관례, 동작 동일 |

## 2. 수정/생성 파일 목록
- **수정 1개**: `webapp/app/security/blocked/BlockedIpClient.tsx` (53~58줄 교체 + 5줄 import에서 `useEffect` 제거)
- 생성·삭제 파일 없음. DB·서버액션·공통부품 **무수정**.

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능**: 차단 IP 추가 폼의 입력칸 비우기, "폼에 채우기" 버튼, IPv6 안내 문구(`pattern.includes(":")`), 성공/실패 배너.
  - 대응: `pattern`·`reason` 상태의 **이름·타입·용도를 그대로 유지**한다. 바뀌는 건 "언제 비우는가"의 실행 시점뿐.
- **다른 화면 영향**: 없음(이 컴포넌트를 쓰는 곳이 blocked/page.tsx 1곳). 페이징 부품(`usePagination`·`TablePagination`)은 **읽기만** 하고 수정하지 않는다.
- **구현 후 반드시 테스트할 기존 기능**:
  1. 차단 IP 추가 → 성공 배너 + **입력칸 2개가 비워짐**
  2. 같은 IP 연타 → "이미 차단 목록에 있는 IP" 에러가 **안 뜨는지**(빈 칸이므로 "IP를 입력해주세요"가 떠야 정상)
  3. 실패(잘못된 IP 형식) → **입력값이 남아 있어야** 함(고쳐서 다시 낼 수 있게)
  4. "폼에 채우기" 버튼 → 후보 IP·사유가 폼에 들어가고 **지워지지 않음**
  5. 차단 명단 [해제], 두 표의 페이징 ◀▶ 정상

## 4. 작업분해 TODO
- [ ] 1단계: BlockedIpClient.tsx 53~58줄을 렌더 중 비교 패턴으로 교체 + `useEffect` import 제거
- [ ] 2단계: `npx tsc --noEmit` + `npx eslint app/security/blocked/BlockedIpClient.tsx` → **0건** 확인
- [ ] 3단계: 3001 검증서버에서 실제 화면 동작 확인(위 5개 항목)
- [ ] 4단계: code-reviewer 서브에이전트 검수
- [ ] 5단계: git 커밋 + project-status.md 갱신

## 5. 핵심 로직 샘플 (계획용 — 실제 구현 아님)
```tsx
// 저장에 성공하면 입력칸을 비운다 — 안 비우면 연타 시 "이미 차단 목록에 있는 IP" 에러가 뜬다.
// effect 대신 "이전 결과와 비교"(렌더 중 리셋) — 연쇄 렌더 회피, usePagination과 같은 패턴.
const [prevState, setPrevState] = useState(state);
if (state !== prevState) {
  setPrevState(state);
  if (state.ok) { setPattern(""); setReason(""); }
}
```

## 6. 구현하지 않을 것 (범위 제외)
- 서버 액션(`ip-block.ts`) 로직·검증·보안 방어 — 무접촉.
- 차단 IP 화면의 디자인·문구·페이징 — 무접촉.
- 다른 파일의 eslint 정리 — **이 파일만**(요청 범위).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
