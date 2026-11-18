// Next.js 규칙 파일 — 서버가 켜질 때 한 번 불린다(node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// 2026-11-19 운영 준비 5단계: 서버 안 예약 작업(출퇴근 사진 90일 자동 삭제)을 시작하는 데만 쓴다. 내용은 lib/scheduled-jobs.ts.
//  · DB·파일을 다루므로 Node 실행 환경에서만 불러온다(문서 권장 방식 — 다른 실행 환경용 묶음에 섞이지 않게 조건 안에서 import).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduledJobs } = await import("./lib/scheduled-jobs");
    startScheduledJobs();
  }
}
