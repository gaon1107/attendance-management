// 문자 발송 기록(SmsLog) 자동 파기 — 2026-11-22 사장님 결정: **1년**.
//
// 왜 1년인가
//  · 법으로 정해진 보관 의무가 없다(근로기준법 3년은 **근로시간 기록**이고, 우리는 통신사가 아니다).
//    문자 기록에는 전화번호가 들어 있으므로 개인정보 최소보관 원칙에 따라 짧게 둔다.
//  · 우리가 이 기록을 쓰는 세 가지 용도가 모두 1년 안에 끝난다 — ①요금 확인 ②"보냈다/못 받았다" 분쟁
//    ③악용 추적(발송 상한은 최근 1시간·하루만 본다).
//
// ⚠️ 지우면 `@@unique([companyId, kind, refId])`의 "같은 문자 1회만" 잠금도 함께 풀린다.
//    확인 결과 실제로 재발송이 열리는 것은 초대 문자뿐이고, 초대 자체에 만료가 있어(app/actions/sms.ts
//    "만료된 초대입니다") 1년 뒤에는 어차피 보낼 수 없다. 보관기간을 **더 줄이려면 이 점을 다시 확인할 것.**
//
// 구조는 접속기록 파기(lib/access-log.ts)와 똑같이 맞췄다 — 하루 1회, 작게 끊어 삭제, 실패해도 화면은 멀쩡.
import { prisma } from "./db";

/** 보관 기간(일). 화면 안내 문구도 이 값을 쓴다 — 숫자를 두 곳에 적지 않는다. */
export const SMS_RETENTION_DAYS = 365;

// 한 번에 지우는 건수. 단일 DELETE로 크게 지우면 SQLite 쓰기 락이 길어져 그 사이 출퇴근 기록 저장이 밀린다.
const PURGE_BATCH = 5000;
// 한 번의 실행에서 도는 최대 배치 수(안전 상한). 남으면 다음 날 이어서 지운다.
const PURGE_MAX_BATCHES = 20;

let lastSmsPurgeAt = 0;

/**
 * 보관기간이 지난 문자 기록을 지운다.
 *  · 관리자가 [문자 관리] 화면을 열 때 **화면을 먼저 보여준 뒤**(after) 불린다 → 조회 속도에 영향 없다.
 *  · 하루 1회만 실제로 동작한다. 회사별이 아니라 **전체**를 지운다(기간이 모든 회사에 같다).
 */
export async function purgeExpiredSmsLogs(): Promise<void> {
  const now = Date.now();
  if (now - lastSmsPurgeAt < 24 * 60 * 60 * 1000) return; // 하루 1회
  lastSmsPurgeAt = now;

  try {
    const cutoff = new Date(now - SMS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;

    // id만 먼저 뽑아(색인 @@index([companyId, createdAt]) 사용) 그 id들만 지우는 2단계 방식 —
    // deleteMany에는 "몇 건만"이 없어서 이렇게 표현한다.
    for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
      const batch = await prisma.smsLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: PURGE_BATCH,
      });
      if (batch.length === 0) break;

      const r = await prisma.smsLog.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
      deleted += r.count;

      if (batch.length < PURGE_BATCH) break; // 마지막 배치였음
    }

    if (deleted > 0) {
      console.log(`[sms-log] 보관기간(${SMS_RETENTION_DAYS}일) 지난 문자 기록 ${deleted}건 파기 완료`);
    }
  } catch (e) {
    // 파기 실패가 화면 조회를 막으면 안 된다 — 로그만 남기고 나중에 재시도.
    // ⚠️ 0으로 되돌리지 않는다: DB 잠금 같은 장애 중이면 화면을 열 때마다 무거운 DELETE를 다시 던지게 된다.
    //    1시간 뒤 재시도하도록 뒤로 물린다(백오프). 접속기록 파기와 같은 처리다.
    lastSmsPurgeAt = now - 23 * 60 * 60 * 1000;
    console.error("[sms-log] 자동 파기 실패(1시간 뒤 재시도):", e);
  }
}
