// User-Agent(브라우저가 보내는 기기·프로그램 문자열) → 사람이 읽을 표시용 기기 라벨.
// 정밀 분석이 아니라 "무슨 기기로 접속했나"를 한눈에 보기 위한 간단 분류다.
// 판정은 위(구체적인 것)에서 아래(일반) 순서로 — 예: iPad는 Mac보다 먼저 본다.

export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "알 수 없음";
  const ua = userAgent.toLowerCase();

  // 모바일·태블릿(구체적인 것 먼저)
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return ua.includes("mobile") ? "Android 폰" : "Android 태블릿";

  // 데스크톱
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("macintosh") || ua.includes("mac os")) return "Mac";
  if (ua.includes("cros")) return "Chromebook";
  if (ua.includes("linux")) return "Linux PC";

  return "기타 기기";
}
