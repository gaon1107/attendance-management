// PC-OFF 순수 규칙(설정 한계·알림 시점 해석). **DB·서버 전용 모듈을 import하지 않는다.**
//  · 왜 파일을 나누나: 설정 화면(브라우저에서 도는 코드)과 정책 조립(서버)이 같은 규칙을 써야 하는데,
//    서버 파일(pcoff-policy.ts)은 prisma·holiday-server를 import하므로 브라우저 번들에 들어가면 안 된다.
//    저장소 관례(shift.ts=순수 / shift-server.ts=로더)와 같은 분리다.
//  · 규칙을 바꾸려면 이 파일만 고친다(화면·서버가 어긋나지 않는 단일 출처).

// 설정 입력 한계 — 저장 액션(검증)과 설정 화면(안내문)이 같은 값을 쓴다.
export const PCOFF_LIMITS = {
  delayMin: { min: 0, max: 240 },      // 퇴근 후 유예(분). 최대 4시간.
  tempUseMin: { min: 5, max: 240 },    // 일시사용 1회 길이(분)
  tempUsePerDay: { min: 0, max: 10 },  // 하루 허용 횟수. 0 = 일시사용 안 씀.
} as const;

export const MAX_NOTIFY_MINS = 5; // 미리 알림은 최대 5개까지(알림 폭탄 방지)

// 알림 시점 CSV("10,5") → [10,5]. 잘못된 값은 조용히 버리고, 큰 수부터 정렬한다.
//  · 0 이하·240분(4시간) 초과·숫자 아님은 제외. 중복 제거.
export function parseNotifyMins(csv: string | null | undefined): number[] {
  const list = String(csv ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 240);
  return Array.from(new Set(list)).sort((a, b) => b - a).slice(0, MAX_NOTIFY_MINS);
}

export function formatNotifyMins(mins: number[]): string {
  return mins.join(",");
}
