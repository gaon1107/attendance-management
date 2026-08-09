// [근로기록 3년 자동 파기] 보관기간이 지난 근태 근로기록을 지운다.
//
// 왜 필요한가:
//   · 근로기준법 제42조 — 근로시간 산정 서류는 3년 보존(시행령 제22조: 기산일 = 그 서류를 "완결한 날").
//   · 개인정보보호법 제21조 — 보유기간이 지난 개인정보는 **지체 없이 파기**. 즉 무기한 보관은 그 자체가 위반이다.
//   지금까지 자동 파기가 있던 것은 PC-OFF 사건기록·출퇴근 사진·접속기록 3가지뿐이고, 정작 본체인
//   근태 기록에는 파기 장치가 없었다(홈화면 "3년 보관" 문구에 근거가 없던 이유).
//
// 무엇을 지우나 — 세 갈래 (사장님 확정 2026-08-09: "근로기록 전부")
//   ① 출퇴근 계열 : Attendance + 딸린 Break(외출)·ClockPhoto(얼굴사진 기록+파일)
//   ② 신청·결재 계열 : 휴가·정정·외출/외근·재택·야근·출장 신청 + 딸린 ApprovalStep(결재단계)·RequestAttachment(첨부+파일)
//   ③ 교대 계열 : ShiftAssignment(조 배정)·ShiftChangeLog(조 변경 이력)
//   ※ 결재선 서식(ApprovalLineTemplate)·부서·직급은 "기록"이 아니라 **설정값**이라 대상이 아니다.
//   ※ 3년 전 날짜를 대상으로 **최근에** 만든 정정 신청(AttendanceCorrection)과, 그 정정 승인이 그날짜로
//      새로 만든 출퇴근 기록은 둘 다 createdAt 보호로 **남는다**(app/actions/corrections.ts가 만든다).
//      원래부터 있던 그날의 출퇴근 기록만 지워진다.
//
// ⚠️ 반드시 지켜야 하는 것 4가지 (하나라도 어기면 조용히 망가진다)
//   ① **자식부터 지운다.** 이 DB에는 연쇄 삭제(onDelete: Cascade)가 한 군데도 없다. 출퇴근 기록을 먼저
//      지우려 하면 딸린 외출·사진 때문에 DB가 거부한다(기존 코드도 이를 알고 "방금 만든 것이라 딸린
//      자료가 없다"는 단서를 달아 두었다 — app/actions/attendance.ts).
//   ② **디스크 파일도 지운다.** 얼굴사진·첨부파일은 DB 밖 storage/ 폴더의 진짜 파일이다. 행만 지우면
//      주인 없는 개인정보 파일이 디스크에 영원히 남는다. 그건 파기가 아니다.
//      → 파일을 **지우지 못한 기록은 이번 회차에 건너뛴다**(다음 회차 재시도). 행만 먼저 지우지 않는다.
//   ③ **두 날짜가 모두 지나야 지운다.** 대상 날짜(출근시각·휴가일 등)는 사람이 고칠 수 있고(정정 승인이
//      과거 clockIn을 가진 기록을 지금 새로 만든다 — app/actions/corrections.ts), createdAt은 서버가 찍는다.
//      한쪽만 보면 조기 파기 또는 과다 보관이 생긴다.
//   ④ **한 묶음은 통째로 성공하거나 통째로 실패해야 한다.** 중간에 끊기면 남는 상태가 위험하다:
//      · 외출만 지워진 출퇴근 기록 → 그날 실근무시간이 실제보다 길게 계산된다(외출 차감이 사라짐).
//      · 결재단계가 0건이 된 대기 신청 → 결재 엔진이 "결재선 안 쓰는 회사"로 보고 관리자 단독 승인을 허용한다
//        (lib/request-cancel.ts가 같은 이유로 트랜잭션을 쓴다).
//      → 출퇴근·신청은 묶음마다 prisma.$transaction으로 감싼다. 교대는 딸린 짝이 없어 감싸지 않는다.
//      ⚠️ 파일 삭제는 트랜잭션 **밖**이다(DB가 파일을 되돌려 주지 못한다). 그래서 파일을 먼저 지우고
//         DB를 나중에 지운다 — 반대로 하면 "파기했다고 기록해 놓고 얼굴 파일은 디스크에 남는" 더 나쁜
//         상태가 된다(lib/clock-photo.ts가 같은 이유로 같은 순서를 쓴다).
import { prisma } from "@/lib/db";
import { toISODate } from "@/lib/period";
import { deleteClockPhotoFiles } from "@/lib/clock-photo";
import { deleteAttachmentFile } from "@/lib/request-attachment";
import { REQUEST_TYPES, type RequestType } from "@/lib/approval-server";

/** 보관기간(년). 근로기준법 제42조. ⚠️ 줄이면 법 위반이 될 수 있다 — 변경 전 법무 확인. */
export const WORK_RECORD_RETENTION_YEARS = 3;
/**
 * 사람에게 보여줄 표기. 위 숫자에서 계산하지 않고 글자로 고정한다
 * (365로 나눠 반올림하면 값이 바뀌었을 때 화면·로그가 실제와 어긋난다 — lib/pcoff.ts와 같은 관례).
 * 현재 사용처: 아래 파기 로그. 홈화면의 "3년"은 아직 하드코딩이다(app/page.tsx).
 */
export const WORK_RECORD_RETENTION_LABEL = "3년";

/**
 * 한 번 실행에서 처리할 최대 "부모 기록" 수.
 *  · 예전엔 이 값을 "넘으면 전부 중단"하는 브레이크로 썼는데, 그러면 한 번 걸린 뒤 **스스로 빠져나올 길이 없다**
 *    (다음 날은 대상이 더 늘어난다). 그래서 지금은 **1회 처리량**이다 — 남으면 잠시 뒤 이어서 지운다.
 *    접속기록 파기(lib/access-log.ts)·사진 파기(lib/clock-photo.ts)가 쓰는 방식과 같다.
 */
export const MAX_PER_RUN = 5000;
/**
 * 완충 — 한 번 실행에서 파기 기준선을 지난 실행보다 최대 이만큼만 앞으로 옮긴다.
 *  · 건수 상한은 완충이 될 수 없다: 5인 사업장은 3년치가 4천 건도 안 돼, 서버 시계가 1년 튀어도
 *    상한에 안 걸리고 전 기록이 조용히 삭제된다. 기간을 제한하는 것만이 규모와 무관하게 작동한다.
 *  · 90일로 잡은 이유: 평상시 기준선은 하루에 하루씩만 나아가므로 평상시엔 절대 걸리지 않는다.
 *    90일이나 벌어졌다면 서버가 몇 달 꺼져 있었거나 시계가 틀어진 것이다.
 */
export const MAX_CUTOFF_JUMP_DAYS = 90;

/** SQLite는 파일 하나에 쓰기가 하나뿐이라, 큰 삭제를 한 번에 하면 그 사이 출퇴근 요청이 대기한다. 잘라서 지운다. */
const CHUNK = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 상한까지 채웠을 때 "이어서" 도는 간격. 0이면 화면을 열 때마다 큰 삭제가 붙어 화면이 느려진다. */
const RESUME_COOLDOWN_MS = 60 * 1000;
/** 실패했을 때 다시 시도하는 간격. 즉시 재시도는 바쁜 DB를 더 바쁘게 만든다(lib/access-log.ts의 교훈). */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * 파기 기준 시각 = 지금으로부터 3년 전. **달력 기준**으로 뺀다(365×3일이 아니다).
 *  · 365×3 = 1095일인데 3년 안에는 보통 윤일이 하나 껴 1096일이다. 즉 하루 일찍 지워 버린다.
 *    보존 의무 기간 안에 지우는 것이라 방향이 나쁘다.
 *  · 2월 29일에 3년을 빼면 JS가 3월 1일로 넘긴다. 기준선이 뒤로 밀리므로 **하루 덜 보관**하는 셈인데,
 *    그 기록은 이미 3년하고도 하루가 지난 것이라 보존 의무 위반은 아니다.
 */
export function retentionCutoff(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - WORK_RECORD_RETENTION_YEARS);
  return d;
}

export type WorkPurgeResult = {
  attendance: number; // 지운 출퇴근 기록 수(딸린 외출·사진기록 제외한 부모 건수)
  request: number;    // 지운 신청 수(딸린 결재단계·첨부 제외한 부모 건수)
  shift: number;      // 지운 교대 배정·변경 기록 수
  file: number;       // **실제로 지운** 디스크 파일 수(이미 없던 파일은 세지 않는다)
  // 실행 중 예외로 **중간에 끊겼음**. 위 건수는 끊기기 전까지 실제로 지운 수다(0이 아닐 수 있다).
  aborted: boolean;
  more: boolean;      // 1회 상한까지 채웠고 실제로 진행도 있었음 → 잠시 뒤 이어서 지운다
  note?: string;
};

const pickIds = async (find: () => Promise<{ id: string }[]>): Promise<string[]> =>
  (await find()).map((r) => r.id);

/** ids를 CHUNK씩 잘라 넘긴다. 반환값은 각 회차 결과의 합. */
async function inChunks(ids: string[], run: (chunk: string[]) => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < ids.length; i += CHUNK) total += await run(ids.slice(i, i + CHUNK));
  return total;
}

/** 신청 종류별 삭제 명령(아직 실행 전). $transaction 배열에 넣기 위해 await하지 않고 돌려준다. */
function deleteRequestOp(type: RequestType, ids: string[]) {
  const where = { id: { in: ids } };
  switch (type) {
    case "leave": return prisma.leaveRequest.deleteMany({ where });
    case "correction": return prisma.attendanceCorrection.deleteMany({ where });
    case "outing": return prisma.outingRequest.deleteMany({ where });
    case "remote": return prisma.remoteWorkRequest.deleteMany({ where });
    case "overtime": return prisma.overtimeRequest.deleteMany({ where });
    case "trip": return prisma.businessTripRequest.deleteMany({ where });
  }
}

/**
 * 보관기간이 지난 근로기록을 실제로 삭제한다.
 *  · 기준 시각을 인자로 받는 이유: 임시 라우트로 검증할 때 "3년 뒤"를 흉내 낼 수 있어야 하기 때문.
 *    ⚠️ 이 값을 외부 입력(요청 본문·쿼리스트링)에서 받아 넘기는 라우트를 만들지 말 것.
 */
export async function purgeExpiredWorkRecords(now: Date = new Date()): Promise<WorkPurgeResult> {
  const rawCutoff = retentionCutoff(now);


  // ── 브레이크 ───────────────────────────────────────────────────────
  // 예전엔 "기준선이 크게 뛰면 중단"이었는데, 두 가지가 잘못이었다(2차 검수).
  //   ① 중단됐다는 사실이 **아무에게도 안 보였다** — 접속기록 화면은 회사별로 걸러 보여주는데
  //      전사 작업이라 회사가 없어 어떤 관리자 화면에도 뜨지 않았다. 파기 대장을 보는 화면도 없다.
  //   ② 한 번 걸리면 **사람이 DB를 직접 고치기 전엔 풀 수 없었다.** 그동안 근로기록은 계속 쌓이고,
  //      "지체 없이 파기"(개인정보보호법 §21) 위반 상태가 조용히 무기한 이어진다.
  // → 중단하지 않고 **기준선을 잘라서(clamp) 조금씩만 나아가게** 바꿨다. 보이지 않는 알림도,
  //   사람이 풀어야 하는 잠금도 없앤다. 대신 한 번에 지울 수 있는 기간이 90일로 제한된다.
  //   · 서버가 반년 꺼져 있었다 → 하루 90일씩, 이틀이면 스스로 따라잡는다(예전엔 영구 정지).
  //   · 서버 시계가 1년 튀었다 → 한 번에 1년치가 날아가지 않고 하루 90일치로 제한된다(피해 축소).
  //     ⚠️ 시계가 계속 틀어져 있으면 며칠에 걸쳐 결국 지워진다. 이건 브레이크가 아니라 **완충**이다.
  //        시계 이상으로부터 완전히 지켜 주는 것은 백업뿐이다.
  const prev = await prisma.workRecordPurgeLog.findFirst({
    where: { cutoffAt: { not: null } },
    orderBy: { ranAt: "desc" },
    select: { cutoffAt: true },
  });

  // 첫 실행은 비교할 기준선이 없어 완충이 작동하지 않는다 — 그 상태로 삭제까지 하면
  // "가장 위험한 회차에 브레이크가 없는" 꼴이 된다. 그래서 첫 회차는 **기준선만 남기고 지우지 않는다.**
  // 하루 늦게 파기해도 법적으로 문제되지 않는다(3년 보존 의무 안쪽이다).
  if (!prev?.cutoffAt) {
    const first: WorkPurgeResult = {
      attendance: 0, request: 0, shift: 0, file: 0, aborted: false, more: false,
      note: "첫 실행 — 기준선만 기록하고 삭제는 다음 회차부터(비교할 지난 기준선이 없어 완충이 못 돈다).",
    };
    console.log(`[work-retention] ${first.note}`);
    await writeLog(first, rawCutoff);
    return first;
  }

  const maxCutoff = new Date(prev.cutoffAt.getTime() + MAX_CUTOFF_JUMP_DAYS * DAY_MS);
  const clamped = rawCutoff.getTime() > maxCutoff.getTime();
  const cutoff = clamped ? maxCutoff : rawCutoff;
  const cutoffDay = toISODate(cutoff); // 교대 표의 date는 "YYYY-MM-DD" 글자라 글자끼리 비교한다(ISO라 사전순=날짜순)
  if (clamped) {
    const behindDays = Math.floor((rawCutoff.getTime() - prev.cutoffAt.getTime()) / DAY_MS);
    console.warn(
      `[work-retention] 기준선이 지난 실행보다 ${behindDays}일 앞서 ${MAX_CUTOFF_JUMP_DAYS}일까지만 진행합니다` +
        ` (서버가 오래 꺼져 있었거나 서버 시각이 틀어졌을 수 있음). 나머지는 다음 회차에.`
    );
  }

  // ── 대상 고르기 ──────────────────────────────────────────────────
  // orderBy: 기한을 가장 많이 넘긴 것부터. 상한에 걸려 나눠 지우게 되므로 순서가 없으면
  //          DB가 계획을 바꿀 때 "아무 5000건"이 되어 오래된 기록이 계속 뒤로 밀릴 수 있다.
  const take = MAX_PER_RUN;

  const attendanceIds = await pickIds(() =>
    prisma.attendance.findMany({
      where: { clockIn: { lt: cutoff }, createdAt: { lt: cutoff } },
      select: { id: true }, orderBy: { clockIn: "asc" }, take,
    })
  );

  // 대상 날짜 필드가 모델마다 달라(끝나는 날 or 대상일) 하나씩 적는다. 공통 규칙: (대상날짜, createdAt) 둘 다 경과.
  // ⚠️ Record<RequestType, …>이라 신청 종류가 하나 늘면 **여기서 컴파일 에러**가 난다(빠뜨릴 수 없게).
  const requestIds: Record<RequestType, string[]> = {
    leave: await pickIds(() =>
      prisma.leaveRequest.findMany({
        where: { endDate: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true }, orderBy: { endDate: "asc" }, take,
      })
    ),
    correction: await pickIds(() =>
      prisma.attendanceCorrection.findMany({
        where: { targetDate: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true }, orderBy: { targetDate: "asc" }, take,
      })
    ),
    outing: await pickIds(() =>
      prisma.outingRequest.findMany({
        where: { targetDate: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true }, orderBy: { targetDate: "asc" }, take,
      })
    ),
    remote: await pickIds(() =>
      prisma.remoteWorkRequest.findMany({
        where: { endDate: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true }, orderBy: { endDate: "asc" }, take,
      })
    ),
    overtime: await pickIds(() =>
      prisma.overtimeRequest.findMany({
        where: { targetDate: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true }, orderBy: { targetDate: "asc" }, take,
      })
    ),
    trip: await pickIds(() =>
      prisma.businessTripRequest.findMany({
        where: { endDate: { lt: cutoff }, createdAt: { lt: cutoff } },
        select: { id: true }, orderBy: { endDate: "asc" }, take,
      })
    ),
  };

  const shiftAssignIds = await pickIds(() =>
    prisma.shiftAssignment.findMany({
      where: { date: { lt: cutoffDay }, createdAt: { lt: cutoff } },
      select: { id: true }, orderBy: { date: "asc" }, take,
    })
  );
  const shiftLogIds = await pickIds(() =>
    prisma.shiftChangeLog.findMany({
      where: { date: { lt: cutoffDay }, createdAt: { lt: cutoff } },
      select: { id: true }, orderBy: { date: "asc" }, take,
    })
  );

  // 어느 한 갈래라도 상한을 꽉 채웠으면 아직 남은 것이 있다는 뜻이다.
  const hitCap =
    attendanceIds.length === take ||
    shiftAssignIds.length === take ||
    shiftLogIds.length === take ||
    REQUEST_TYPES.some((t) => requestIds[t].length === take);

  let fileDeleted = 0;
  let attendanceDeleted = 0;
  let requestDeleted = 0;
  let shiftDeleted = 0;
  const skipped: string[] = []; // 파일을 못 지워 이번 회차에 건너뛴 것들(다음 회차 재시도)

  // 여기서부터가 실제 삭제다. 도중에 예외가 나도(SQLite 잠금 등) **그때까지 지운 건수는 반드시 대장에 남긴다** —
  // 파기 대장은 법적 증빙이라 "지웠는데 기록이 없는" 상태를 만들면 안 된다(2차 검수 중간 4).
  try {
  // ── 삭제 ① 출퇴근: 사진파일 → (사진행·외출·출퇴근을 한 트랜잭션으로) ──
  attendanceDeleted = await inChunks(attendanceIds, async (chunk) => {
    const photos = await prisma.clockPhoto.findMany({
      where: { attendanceId: { in: chunk } },
      select: { attendanceId: true, fileName: true },
    });
    // 3년 된 사진은 90일 파기로 파일이 이미 없는 것이 정상이다(그래도 남아 있으면 지운다).
    const res = await deleteClockPhotoFiles(photos.map((p) => p.fileName));
    fileDeleted += res.deleted;

    // 파일을 못 지운 사진이 있으면 그 출퇴근 기록은 이번에 건드리지 않는다(행만 지우면 고아 파일이 남는다).
    const failedNames = new Set(res.failed);
    const blocked = new Set(photos.filter((p) => failedNames.has(p.fileName)).map((p) => p.attendanceId));
    if (blocked.size > 0) skipped.push(`출퇴근 ${blocked.size}건(사진파일 삭제 실패)`);
    const target = chunk.filter((id) => !blocked.has(id));
    if (target.length === 0) return 0;

    const [, , att] = await prisma.$transaction([
      prisma.clockPhoto.deleteMany({ where: { attendanceId: { in: target } } }),
      prisma.break.deleteMany({ where: { attendanceId: { in: target } } }),
      prisma.attendance.deleteMany({ where: { id: { in: target } } }),
    ]);
    return att.count;
  });

  // ── 삭제 ② 신청: 첨부파일 → (신청·결재단계·첨부행을 한 트랜잭션으로) ──
  // ApprovalStep·RequestAttachment는 외래키가 아니라 (requestType, requestId) 글자로 부모를 가리킨다.
  // 즉 DB가 막아 주지 않으므로, 부모만 지우면 **주인 없는 결재이력·첨부파일이 조용히 남는다**.
  // ※ 첨부 정리 로직은 lib/request-attachment-server.ts의 deleteAttachmentsForRequest와 같은 일을 한다.
  //    저장 방식(폴더 구조 등)을 바꾸면 **양쪽 다** 고쳐야 한다. 여기는 id 묶음 처리라 그 함수를 그대로 쓰지 못한다.
  for (const type of REQUEST_TYPES) {
    const ids = requestIds[type];
    if (ids.length === 0) continue;

    requestDeleted += await inChunks(ids, async (chunk) => {
      const atts = await prisma.requestAttachment.findMany({
        where: { requestType: type, requestId: { in: chunk } },
        select: { companyId: true, storedName: true, requestId: true },
      });
      const blocked = new Set<string>();
      for (const a of atts) {
        const outcome = await deleteAttachmentFile(a.companyId, a.storedName);
        if (outcome === "deleted") fileDeleted++;
        else if (outcome === "failed") blocked.add(a.requestId);
      }
      if (blocked.size > 0) skipped.push(`${type} ${blocked.size}건(첨부파일 삭제 실패)`);
      const target = chunk.filter((id) => !blocked.has(id));
      if (target.length === 0) return 0;

      // 순서는 lib/request-cancel.ts와 같게(원본 → 단계 → 첨부). 트랜잭션이라 원자적이지만,
      // 같은 일을 하는 두 곳의 순서를 맞춰 두면 나중에 읽는 사람이 헷갈리지 않는다.
      const [reqRes] = await prisma.$transaction([
        deleteRequestOp(type, target),
        prisma.approvalStep.deleteMany({ where: { requestType: type, requestId: { in: target } } }),
        prisma.requestAttachment.deleteMany({ where: { requestType: type, requestId: { in: target } } }),
      ]);
      return reqRes.count;
    });
  }

  // ── 삭제 ③ 교대 ─────────────────────────────────────────────────
  // 여기만 트랜잭션이 없다 — 딸린 자식도, 디스크 파일도 없는 단독 표라 중간에 끊겨도 어긋날 짝이 없다.
  shiftDeleted =
    (await inChunks(shiftAssignIds, async (c) =>
      (await prisma.shiftAssignment.deleteMany({ where: { id: { in: c } } })).count)) +
    (await inChunks(shiftLogIds, async (c) =>
      (await prisma.shiftChangeLog.deleteMany({ where: { id: { in: c } } })).count));
  } catch (e) {
    const partial: WorkPurgeResult = {
      attendance: attendanceDeleted, request: requestDeleted, shift: shiftDeleted, file: fileDeleted,
      aborted: true, more: false,
      note: `실행 중 오류로 중단(위 건수는 중단 전까지 실제로 지운 수) — ${e instanceof Error ? e.message : "원인미상"}`.slice(0, 500),
    };
    // ⚠️ 기준선(cutoffAt)은 남기지 않는다. 이번 기간을 다 처리하지 못했으므로 다음 실행이 같은 기간을 다시 봐야 한다.
    await writeLog(partial, null);
    throw e; // 호출부(purgeWorkRecordsDaily)가 백오프를 걸도록 그대로 올린다
  }

  const result: WorkPurgeResult = {
    attendance: attendanceDeleted,
    request: requestDeleted,
    shift: shiftDeleted,
    file: fileDeleted,
    aborted: false,
    // 상한을 채웠더라도 **실제로 지운 게 없으면** 이어서 돌지 않는다. 파일 잠금 등으로 선두 묶음이 통째로
    // 건너뛰어지면, 진행 여부를 안 보는 순간 같은 목록을 60초마다 영원히 다시 집는다(사진 파기가 겪은 실수).
    // 기준선을 잘라낸 회차(clamped)도 이어 돌지 않는다 — 그러면 완충이 60초 만에 무의미해진다.
    more: hitCap && attendanceDeleted + requestDeleted + shiftDeleted > 0 && !clamped,
    note: [
      clamped ? `기준선을 ${MAX_CUTOFF_JUMP_DAYS}일까지만 진행(나머지는 다음 회차)` : "",
      skipped.length > 0 ? `파일 삭제 실패로 건너뜀 — ${skipped.join(", ")}` : "",
    ].filter(Boolean).join(" / ") || undefined,
  };
  // 0건이어도 남긴다 — 이 표의 마지막 실행 시각이 "하루 1회"의 기준이기 때문이다.
  // (앞으로 3년간은 만료 대상이 0건이라, 0건일 때 안 남기면 그 기준이 3년 내내 비어 있게 된다.)
  await writeLog(result, cutoff);
  return result;
}

// 파기 이력 — 개인 식별정보 없이 "언제·어느 기간까지·몇 건"만 남긴다. 실패해도 파기 자체는 성공으로 둔다.
async function writeLog(r: WorkPurgeResult, cutoff: Date | null): Promise<void> {
  try {
    await prisma.workRecordPurgeLog.create({
      data: {
        cutoffAt: cutoff,
        more: r.more,
        attendanceDeleted: r.attendance,
        requestDeleted: r.request,
        shiftDeleted: r.shift,
        fileDeleted: r.file,
        aborted: r.aborted,
        note: r.note ?? null,
      },
    });
  } catch (e) {
    console.error("[work-retention] 파기 이력 기록 실패(파기 자체는 완료):", e);
  }
}

// 하루 1회만 도는 게으른 실행기 — 별도 스케줄러가 없는 구조라 관리자 화면 열기에 얹는다(기존 파기 3개와 같은 방식).
//  · 메모리 변수는 1차 차단용이고, 그 다음 기준은 DB의 마지막 실행 시각이다(인스턴스가 여러 개일 때의 완화책).
//    ⚠️ 조회 후 실행이라 원자적이지 않다 — 두 인스턴스가 동시에 통과할 수 있다. 같은 기록이 두 번
//    지워지지는 않지만(id로 집어 deleteMany), 대장에 두 줄이 남고 파일 삭제가 겹쳐 건수가 흔들릴 수 있다.
//  · 파기 실패가 본 기능(대시보드 조회)을 막으면 안 되므로 예외는 삼키고 나중에 재시도한다.
let lastPurgeAt = 0;
/** 다음 실행을 "지금부터 N밀리초 뒤"로 앞당긴다(하루 주기를 그만큼 당겨 놓는 방식 — lib/clock-photo.ts와 동일). */
function scheduleNextIn(from: number, ms: number): void {
  lastPurgeAt = from - (DAY_MS - ms);
}
export async function purgeWorkRecordsDaily(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < DAY_MS) return;
  lastPurgeAt = now;

  try {
    const last = await prisma.workRecordPurgeLog.findFirst({
      orderBy: { ranAt: "desc" },
      select: { ranAt: true, more: true },
    });
    if (last) {
      // 아직 남은 것이 있으면(more) 하루가 아니라 잠깐만 기다렸다 이어서 지운다.
      const wait = last.more ? RESUME_COOLDOWN_MS : DAY_MS;
      if (now - last.ranAt.getTime() < wait) {
        // ⚠️ 여기서 그냥 return하면 위에서 이미 써버린 메모리 예산(lastPurgeAt = now) 때문에
        //    **아무 일도 안 했는데 24시간이 잠긴다.** 이어서 지울 것이 남았는데도 재개가 하루 뒤로 밀리고,
        //    평상시에도 서버를 매일 껐다 켜면 주기가 이틀로 늘어난다. DB 기준으로 되돌려 놓는다.
        scheduleNextIn(last.ranAt.getTime(), wait);
        return;
      }
    }

    const r = await purgeExpiredWorkRecords();
    if (r.attendance + r.request + r.shift > 0) {
      console.log(
        `[work-retention] 보관기간(${WORK_RECORD_RETENTION_LABEL}) 지난 근로기록 파기 — ` +
          `출퇴근 ${r.attendance}건 · 신청 ${r.request}건 · 교대 ${r.shift}건 · 파일 ${r.file}개` +
          (r.more ? ` (1회 상한 ${MAX_PER_RUN}건 도달 — 나머지는 곧 이어서)` : "") +
          (r.note ? ` / ${r.note}` : "")
      );
    }
    // 아직 남았으면 잠시 뒤 이어서 지운다(다음 화면 열기 때 돈다).
    if (r.more && !r.aborted) scheduleNextIn(Date.now(), RESUME_COOLDOWN_MS);
  } catch (e) {
    // ⚠️ 0으로 되돌리지 않는다: DB 잠금·타임아웃 같은 장애 중이면 화면을 열 때마다 무거운 삭제를 다시 던져
    //    부하를 키운다(lib/access-log.ts가 같은 실수를 겪고 남긴 교훈). 10분 뒤 재시도하도록 뒤로 물린다.
    //    기준은 함수 진입 시각이 아니라 실패가 확정된 "지금"이다(오래 버티다 실패하면 즉시 재시도가 되어버린다).
    scheduleNextIn(Date.now(), RETRY_COOLDOWN_MS);
    console.error("[work-retention] 자동 파기 실패(10분 뒤 재시도):", e);
  }
}
