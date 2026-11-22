// 서버 안에서 정해진 간격으로 도는 작업 — instrumentation.ts가 서버를 켤 때 한 번 시작시킨다(2026-11-19 운영 준비 5단계).
//
// 출퇴근 사진 90일 자동 삭제(lib/clock-photo.ts purgeExpiredPhotos)
//   · 예전엔 얼굴 출퇴근·사진 열람·[출퇴근 기록] 화면이 열릴 때만 돌았다. 그래서 퇴사자 사진처럼 아무도 열지 않는 사진은
//     90일이 지나도 남을 수 있었다 — 동의 화면 약속("90일이 지나면 자동 삭제")을 어기게 된다(5-2 검수 범위 밖 지적, 사장님 승인).
//   · 1시간마다 깨어나 부르기만 한다. "하루 1회만 실제로 지움"·"많으면 나눠서 이어 지움"·"실패하면 10분 뒤 재시도"는
//     그 함수가 스스로 관리하므로 여기서 다시 계산하지 않는다(규칙을 두 곳에 두면 어긋난다).
//   · 켜진 직후가 아니라 5분 뒤 처음 돈다 — 배포 직후 DB 구조 갱신·첫 접속 부하와 겹치지 않게.
//   · 화면 열림 때 도는 기존 호출은 그대로 둔다(겹쳐 돌아도 이미 지운 사진은 다시 집지 않아 무해 — 지운 표시 fileDeletedAt).
//   · 타이머는 프로세스 종료를 붙잡지 않는다(unref) — 배포 때 상자를 끄는 것이 늦어지지 않게.
import { purgeExpiredPhotos } from "@/lib/clock-photo";
import { purgeExpiredSmsLogs } from "@/lib/sms-retention";
import { runCompanyPurgeIfDue } from "@/lib/company-purge";

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

// 개발 모드는 코드가 바뀔 때마다 다시 불릴 수 있다 → 타이머가 여러 개 생기지 않게 전역 표시로 한 번만 시작한다.
const g = globalThis as typeof globalThis & { __attendanceJobsStarted?: boolean };

export function startScheduledJobs(): void {
  if (g.__attendanceJobsStarted) return;
  g.__attendanceJobsStarted = true;

  const runPhotoPurge = () => {
    // purgeExpiredPhotos는 오류를 스스로 삼키지만, 혹시 새는 예외가 서버를 멈추지 않도록 한 번 더 막는다.
    purgeExpiredPhotos().catch((e) => console.error("[scheduled-jobs] 출퇴근 사진 자동 삭제 실패:", e));
  };
  setTimeout(runPhotoPurge, FIRST_RUN_DELAY_MS).unref();
  setInterval(runPhotoPurge, TICK_MS).unref();

  // 문자 발송 기록 1년 자동 파기(2026-11-22, 메시지 관리 3-2a).
  //  · 🔴 [검수 중간 3] 처음엔 [문자 관리] 화면이 열릴 때만 돌게 했는데, 그러면 관리자가 몇 달 안 들어오는
  //    회사의 기록이 1년을 넘겨 남는다 — 화면이 "1년간 보관한 뒤 자동으로 지워집니다"라고 해 놓고 어기게 된다.
  //    **출퇴근 사진 90일에서 이미 겪은 실수**라 같은 처방을 쓴다(이 파일 머리말 참고).
  //  · "하루 1회만 실제로 지움"·"많으면 나눠서"·"실패하면 뒤로 물림"은 그 함수가 스스로 관리한다.
  const runSmsLogPurge = () => {
    purgeExpiredSmsLogs().catch((e) => console.error("[scheduled-jobs] 문자 기록 자동 파기 실패:", e));
  };
  setTimeout(runSmsLogPurge, FIRST_RUN_DELAY_MS).unref();
  setInterval(runSmsLogPurge, TICK_MS).unref();

  // 해지 회사 30일 뒤 자동 파기(2026-11-22 해지 2단계, 이용약관 제14조 ④).
  //  · 1시간마다 부르기만 한다. "새벽 1~3시에만 실제로 지움"·"한 번에 3곳"·"보류 회사 20시간 대기"는
  //    그 함수(lib/company-purge.ts)가 스스로 판단한다.
  const runCompanyPurge = () => {
    runCompanyPurgeIfDue().catch((e) => console.error("[scheduled-jobs] 해지 회사 자동 파기 실패:", e));
  };
  setTimeout(runCompanyPurge, FIRST_RUN_DELAY_MS).unref();
  setInterval(runCompanyPurge, TICK_MS).unref();

  console.log("[scheduled-jobs] 출퇴근 사진 90일·문자 기록 1년 자동 삭제 + 해지 회사 30일 뒤 파기(새벽 1~3시) 예약 시작(1시간마다 확인)");
}
