# Research: BlockedIpClient eslint(set-state-in-effect) 정리 (2026-07-23)

## 배경
2026-07-21 페이징 작업 중 발견돼 "다음날 처리"로 예약된 **기존 이슈**(페이징과 무관). 실제로 아직 남아 있음을 확인.

```
webapp/app/security/blocked/BlockedIpClient.tsx:55
  error  Avoid calling setState() directly within an effect  react-hooks/set-state-in-effect
✖ 1 problem (1 error, 0 warnings)
```
※ 이 규칙은 경고가 아니라 **error**다. 지금은 이 1건 때문에 해당 파일 lint가 실패한다(다른 작업의 "eslint 0" 확인을 방해).

## 관련 파일과 역할
- **[BlockedIpClient.tsx](webapp/app/security/blocked/BlockedIpClient.tsx)** — 관리자 [보안 → 차단 IP] 화면의 클라이언트 컴포넌트. 차단 추가 폼(IP·사유) + 차단 후보 표 + 차단 중인 IP 표.
- [page.tsx](webapp/app/security/blocked/page.tsx):98 — 이 컴포넌트를 쓰는 **유일한 곳**(서버 컴포넌트가 rows·candidates·myIp 등을 넘김).
- [app/actions/ip-block.ts](webapp/app/actions/ip-block.ts):33 `addBlockedIp` — 서버 액션. 성공 시 `{ ok: true }`, 실패 시 `{ error: "..." }` **새 객체**를 매번 반환.

## 문제 코드 (53~58줄)
```tsx
const [state, formAction, pending] = useActionState(addBlockedIp, {});
const [pattern, setPattern] = useState("");
const [reason, setReason] = useState("");

useEffect(() => {
  if (state.ok) { setPattern(""); setReason(""); }
}, [state]);
```
- 하는 일: **차단 추가에 성공하면 입력칸 2개를 비운다.**
- 왜 필요: 안 비우면 [차단 추가]를 연타할 때 같은 IP가 그대로 남아 **"이미 차단 목록에 있는 IP"** 에러가 뜬다. → **이 동작은 반드시 보존.**
- 왜 error: React 19 / eslint-config-next 16 규칙상 "effect 안에서 setState"는 렌더 → effect → 재렌더의 **연쇄 렌더**를 유발하는 안티패턴.

## 🔴 영향 범위 (전수 검색 결과)
| 대상 | 사용처 | 결론 |
|---|---|---|
| `BlockedIpClient` | `app/security/blocked/page.tsx` **1곳뿐** | 공통 모듈 아님 |
| `pattern`/`reason` 상태 | **이 파일 안에서만** 사용(폼 input value, "폼에 채우기" 버튼, IPv6 안내 조건) | 외부 영향 0 |
| `addBlockedIp`/`removeBlockedIp` | 서버 액션 — **수정 대상 아님** | 무접촉 |

→ **공통 모듈 아님. 파일 1개 안에서 끝난다. safe-coding-skill 대상 아님.**

## DB·API·스키마 변경
**없음.** UI 상태 처리 방식만 바꾼다. 마이그레이션 없음, 서버 액션 서명 무변경.

## 위험 요소
1. **입력칸 비우기 UX가 깨지는 것**(연타 시 "이미 차단된 IP" 에러 재현) — 가장 큰 위험. 실화면 확인 필요.
2. "폼에 채우기" 버튼으로 채운 값이 곧바로 지워지면 안 됨(성공 상태가 유지된 채 값을 채우는 경우).
3. 그 외 보안 로직(자기 IP 차단 방어·사내망 우선)은 **서버 담당** → 이 수정과 무관.

## 결론 (계획 시 고려사항)
- 이 프로젝트엔 이미 같은 문제를 푼 **검증된 패턴**이 있다: [usePagination.ts](webapp/app/components/usePagination.ts):27 — "이전값을 상태로 들고 있다가 **렌더 중에 비교해서 리셋**"(effect 없이). 07-21 페이징 작업에서 code-reviewer 검수를 통과한 방식.
- 같은 패턴을 쓰면 ①규칙 준수 ②연쇄 렌더 제거 ③프로젝트 관례 일치 ④변경 범위 최소(파일 1개, 약 6줄).
