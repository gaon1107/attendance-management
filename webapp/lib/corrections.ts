// 근태 정정 요청 도구 — 시각 검증 + 날짜+시각 → Date 조립 + 상태 라벨.

// "HH:MM"(24시간) 형식이 맞는지 확인.
export function isValidHm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// 대상 날짜(자정 Date) + "HH:MM" → 그 날 그 시각의 Date.
export function hmToDate(date: Date, hm: string): Date {
  const [h, m] = hm.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
}

// ── [후속 검수] 이 정정 신청을 승인하면 실제로 반영할 수 있는가 ─────────────
// 승인 화면(미리 안내)과 승인 처리(진행 차단)가 **같은 함수**를 써야 판단이 어긋나지 않는다.
// 반영 가능하면 null, 불가하면 관리자에게 보여줄 사유 문자열을 돌려준다.
export function checkApplicable(
  existing: { clockIn: Date; clockOut: Date | null } | null,
  newIn: Date | null,
  newOut: Date | null
): string | null {
  if (existing) {
    // 기존 값 + 요청 값을 합친 최종 결과가 "퇴근이 출근보다 빠른" 모순이면 안 된다.
    const finalIn = newIn ?? existing.clockIn;
    const finalOut = newOut ?? existing.clockOut;
    if (finalOut && finalOut <= finalIn) {
      return "고치면 퇴근이 출근보다 빨라집니다. 출근·퇴근 시각을 함께 확인해주세요.";
    }
    return null;
  }
  // 그날 기록이 아예 없으면 새로 만들어야 하는데, 출근·퇴근이 모두 있어야 한다.
  //  (퇴근 없는 기록을 만들면 그 직원이 계속 "근무 중"이 되어 나중에 수십 시간짜리 근무로 닫힌다)
  if (!newIn || !newOut) {
    return "그날 출퇴근 기록이 없어 새로 만들어야 하는데, 출근·퇴근 시각 중 하나가 비어 있습니다.";
  }
  return null;
}

export function correctionStatusLabel(status: string): string {
  if (status === "approved") return "승인·반영됨";
  if (status === "rejected") return "반려";
  return "대기";
}
