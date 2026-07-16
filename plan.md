# Plan: 얼굴 출퇴근 "3장 동일" 오탐 수정(A안) — 2026-07-17 — 상태: **구현 중(승인됨)**

> 사장님 승인: A안 = 근본 원인(촬영 방식) 개선. 서버 부정방지 장치는 그대로, 촬영이 **진짜로 다른 3장**을 보내게만.
> 원인(확정): 카메라 예열 전 같은 프레임이 3번 찍혀 서버 "동일 3장 = 정지영상/가상카메라 의심"에 걸림(진짜 사람 오탐).

## 1. 무엇을 (쉬운 말)
카메라가 켜지자마자 같은 화면 3장을 찍던 걸, **①깨어난 뒤 ②실제로 화면이 바뀔 때마다** 3장 찍게 바꾼다.
그래도 3장이 같으면(정말 멈춘 카메라) **몇 번 다시** 찍어 서로 다른 장 확보. 끝까지 같으면 그대로 보냄(서버가 판단).

## 2. 수정 파일 — `webapp/app/attendance/FaceClockPanel.tsx` 촬영부만
- 모듈 헬퍼 추가: `waitForFreshFrame(video)` — `requestVideoFrameCallback`(rVFC)로 "새 프레임 도착" 1회 대기(폴백=타임아웃).
  `findDuplicateIndex(blobs)` — 바이트 동일 쌍 탐지(크기 같을 때만 바이트 비교로 비용 절약).
- `captureAndSubmit`의 3장 루프(현재 0.3초 고정)를 **예열 → 프레임 동기 3장 → 동일 안전망**으로 교체.
- `captureOneBlob`·submit·FormData·fallback·카메라 정리 = **무변경**(재사용).

### 변경 없음 (🚧)
- 서버 `actions/face.ts`·`lib/liveness.ts`(동일감지·모델 판정·밝기) · 얼굴 등록(FaceCapture=1장) · 스키마 · 1280×720·품질0.9·재압축.

## 3. 🛡️ 사이드 이펙트 방어
| 위험 | 대응 |
|---|---|
| **rVFC 미지원**(Firefox·구형) | `typeof video.requestVideoFrameCallback === "function"` 분기, 없으면 **기존 setTimeout(0.3초) 폴백** = 회귀 0 |
| **예열·재캡처 무한 대기** | 전부 타임아웃·유한 횟수(추가 최대 3회). 최악이어도 3장 떠서 전송(출퇴근 안 막음) |
| **바이트 비교 비용** | 크기 다르면 비교 스킵(대부분). 같을 때만 바이트 비교 |
| **정말 멈춘 카메라(주입 공격)** | 재캡처해도 계속 동일 → **그대로 서버가 걸러야 정상**(안전장치 유지). 클라 재시도는 유한 |
| **submit 이중잠금·fallback·카메라 정리** | 촬영 루프 내부만 교체, 나머지 유지 |
| **no any / lint** | rVFC는 타입 확장으로 처리(any 금지) |

### 구현 후 테스트
- [ ] 코드: tsc·eslint 통과, 폴백 경로(rVFC 없을 때) 논리 확인
- [ ] 정상 얼굴 출퇴근 여전히 동작(서버 무수정이라 회귀 없음)
- [ ] **[사장님 웹캠]** 진짜 얼굴 출근이 이제 "정상"으로(오탐 사라짐) + 폰/정지영상은 여전히 "위조 의심"

## 4. 핵심 로직 (계획 스니펫)
```js
function waitForFreshFrame(video, timeoutMs = 600) {
  return new Promise((resolve) => {
    const rvfc = video.requestVideoFrameCallback;
    if (typeof rvfc !== "function") return void setTimeout(resolve, timeoutMs);
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(); } }, timeoutMs);
    rvfc.call(video, () => { if (!done) { done = true; clearTimeout(t); resolve(); } });
  });
}
// 예열 + 프레임 동기 3장
await waitForFreshFrame(video);                 // 예열
for (let i = 0; i < 3; i++) { await waitForFreshFrame(video); push(captureOneBlob()); }
// 동일 안전망(유한 재캡처)
for (let e = 0, d; e < 3 && (d = await findDuplicateIndex(blobs)) >= 0; e++) {
  await waitForFreshFrame(video); blobs[d] = captureOneBlob();  // 중복 한 장 교체
}
```

## 5. 작업분해
- [ ] 1: `FaceClockPanel.tsx` 촬영부 교체(헬퍼+루프) — 커밋
- [ ] 2: tsc·eslint·회귀 확인 → code-reviewer → 문서 갱신 (진짜 오탐 해소는 사장님 웹캠 최종확인)

## 6. 구현 안 함
- 서버 동일감지 완화(안전장치 유지) · 얼굴 등록 촬영 변경(1장이라 무관) · B/C안(미채택).
