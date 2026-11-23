// [해지 회사 30일 뒤 자동 파기] — 2026-11-22 해지 2단계. 계획서: plan-해지2단계-자동파기.md
//
// 왜 필요한가
//   · 이용약관 제14조 ④ "이용계약이 끝나면 30일 동안 자료를 보관한 뒤 파기합니다."
//   · 처리방침 제2조 — 회사명·대표자·관리자 정보 = "이용계약 종료 후 30일". 개인정보보호법 제21조 "지체 없이 파기".
//   1단계(해지 표시·차단)는 데이터를 지우지 않았다. 이 파일이 실제로 지운다.
//
// 무엇을 지우나 — 그 회사의 **모든 것**(아래 TABLES 37개 표 + 회사 행 + 디스크 파일 + 얼굴서버)
//   ※ 남기는 것: AccessEvent(접속기록) — 처리방침에 "2년"으로 따로 공개(2026-11-22 사장님 결정 ①). 기존 2년 자동 파기가 지운다.
//               PgOrder(결제 주문) — 대금결제 기록 5년 보관(2026-11-23 결제 1단계).
//
// 순서(회사 1곳) — 순서 자체가 안전장치다. 바꾸지 말 것.
//   ① purgeStartedAt 표시 → 이때부터 [되살리기] 거부(lib/company-termination.ts). 반쯤 지운 회사가 되살아나지 않게.
//   ② 얼굴서버 삭제(직원마다) — 하나라도 실패하면 **여기서 멈추고 보류(held)**. 다음 회차에 처음부터 다시.
//      직원 행을 먼저 지우면 "누구 얼굴을 지울지"라는 단서가 사라져 얼굴이 영원히 남는다(lib/face-purge.ts 규칙과 같다).
//   ③ 디스크 파일(출퇴근 사진·신청 첨부 폴더·회사 문서 폴더) — 하나라도 실패하면 보류. 이유는 ②와 같다.
//   ④ DB 행 — 자식 표부터 500건씩 잘라서 지운다(SQLite는 쓰기가 하나뿐이라 크게 지우면 다른 회사 출퇴근 저장이 멈춘다).
//      중간에 끊겨도 괜찮다: 그 회사는 아무도 로그인할 수 없어 반쯤 지워진 상태를 볼 사람이 없고, 다음 회차가 이어서 지운다.
//   ⑤ 남은 행이 0건인지 전 표를 세어 확인한 뒤에만 회사 행을 지운다.
//   ⑥ 파기 대장(CompanyPurgeLog) — 건수만. 회사·사람 이름은 남기지 않는다(파기 대상 정보이므로).
//
// 🔴 사고 방지 — 이 기능의 최악의 사고는 "엉뚱한 회사(또는 전 회사) 데이터 삭제"다.
//   ① Prisma는 조건 값이 undefined면 **그 조건을 무시한다** → `where: { companyId: undefined }`는 표 전체가 된다.
//      그래서 회사 id는 assertCompanyId를 통과한 문자열만 쓰고, 모든 조회 조건은 그 값으로만 만든다.
//   ② 목록 조회 조건만 믿지 않는다 — 회사마다 "해지됨 + 30일 지남 + 미래 날짜 아님"을 코드로 다시 본다.
//   ③ 하루 최대 3곳(MAX_COMPANIES_PER_RUN — 최근 20시간 대장 기준). 버그·시계 이상이 있어도 하루 피해 범위를 줄인다.
//   ④ 표 목록 자동 대조(uncoveredModels): DB에 회사·직원 칸을 가진 표가 새로 생겼는데 여기 목록에 없으면
//      **아무것도 지우지 않고 멈춘다.** 빠뜨린 표가 있으면 회사 행 삭제가 외래키로 막히거나, 외래키 없는 표는 조용히 남는다.
//   ⑤ 회사 행 삭제는 "해지 표시 + 파기 시작 표시"가 둘 다 있는 행만 지운다(조건부 삭제).
//
// ⚠️ 운영자 [지금 바로 파기] 같은 수동 통로를 만들지 말 것 — 실수 한 번이 곧 되돌릴 수 없는 삭제다(계획서 6장).
// ⚠️ now·unenroll·onlyCompanyId 인자는 **검증 전용**이다. 외부 입력(요청 본문·쿼리스트링)에서 받아 넘기는 라우트를 만들지 말 것.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { unenrollFaceOutcome } from "@/lib/face-purge";
import { deleteClockPhotoFiles } from "@/lib/clock-photo";
import { deleteCompanyAttachmentDir } from "@/lib/request-attachment";
import { deleteCompanyDocDir } from "@/lib/company-doc";
import { isRetentionOver, purgeDueAt, TERMINATION_RETENTION_DAYS } from "@/lib/company-termination";

/** 하루(최근 20시간)에 손대는 최대 회사 수(완료·보류·중단 포함). */
export const MAX_COMPANIES_PER_RUN = 3;
/** 보류·중단된 회사는 이 시간 안에 다시 시도하지 않는다(얼굴서버가 꺼진 동안 매시간 두드리지 않게). */
const RETRY_AFTER_MS = 20 * 60 * 60 * 1000;
/** 한 번에 지우는 행 수 — lib/work-record-retention.ts와 같은 값. */
const CHUNK = 500;
/** 표 하나를 지우는 반복의 안전 상한(500 × 20만 = 1억 행). 진행이 없으면 그 전에 멈춘다. */
const MAX_LOOPS = 200_000;

// cuid 형식만 통과. 빈 문자열·undefined·공백·경로 문자는 전부 거부된다.
const COMPANY_ID_RE = /^c[a-z0-9]{20,32}$/;
function assertCompanyId(id: unknown): string {
  if (typeof id !== "string" || !COMPANY_ID_RE.test(id)) {
    throw new Error(`[company-purge] 파기 대상 회사 id가 올바르지 않아 멈춥니다: ${JSON.stringify(id)}`);
  }
  return id;
}

type Cat = "attendance" | "request" | "shift" | "agent" | "user" | "other";
type Table = {
  model: string; // Prisma 모델 이름 — 표 목록 자동 대조(uncoveredModels)에 쓴다
  cat: Cat;      // 파기 대장의 어느 칸에 셀지
  count: (cid: string) => Promise<number>;
  pick: (cid: string, take: number) => Promise<{ id: string }[]>;
  del: (ids: string[]) => Promise<{ count: number }>;
};

// ── 지우는 순서 = 이 배열 순서. 외래키가 가리키는 쪽(부모)이 항상 뒤에 온다. ──
//   (이 DB에는 연쇄 삭제가 없다 — 자식이 남아 있으면 부모 삭제를 DB가 거부한다.)
//   부모 관계: ClockPhoto·Break → Attendance → User / 신청들·결재선 서식 → User / ShiftPattern → User
//             AgentEvent → AgentDevice → User / Session·AgentPairCode·PasswordResetCode → User
//             User → Department·JobGrade·ShiftGroup·Company / 나머지 → Company
//   ※ 회사 칸이 없는 표 3개(Break·Session·AgentPairCode)는 부모(출퇴근·직원)의 회사로 찾는다.
const TABLES: Table[] = [
  // 출퇴근
  { model: "Break", cat: "attendance",
    count: (c) => prisma.break.count({ where: { attendance: { companyId: c } } }),
    pick: (c, take) => prisma.break.findMany({ where: { attendance: { companyId: c } }, select: { id: true }, take }),
    del: (ids) => prisma.break.deleteMany({ where: { id: { in: ids } } }) },
  { model: "ClockPhoto", cat: "attendance",
    count: (c) => prisma.clockPhoto.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.clockPhoto.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.clockPhoto.deleteMany({ where: { id: { in: ids } } }) },
  { model: "Attendance", cat: "attendance",
    count: (c) => prisma.attendance.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.attendance.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.attendance.deleteMany({ where: { id: { in: ids } } }) },
  // 신청·결재
  { model: "ApprovalStep", cat: "request",
    count: (c) => prisma.approvalStep.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.approvalStep.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.approvalStep.deleteMany({ where: { id: { in: ids } } }) },
  { model: "RequestAttachment", cat: "request",
    count: (c) => prisma.requestAttachment.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.requestAttachment.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.requestAttachment.deleteMany({ where: { id: { in: ids } } }) },
  { model: "LeaveRequest", cat: "request",
    count: (c) => prisma.leaveRequest.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.leaveRequest.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.leaveRequest.deleteMany({ where: { id: { in: ids } } }) },
  { model: "AttendanceCorrection", cat: "request",
    count: (c) => prisma.attendanceCorrection.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.attendanceCorrection.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.attendanceCorrection.deleteMany({ where: { id: { in: ids } } }) },
  { model: "OutingRequest", cat: "request",
    count: (c) => prisma.outingRequest.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.outingRequest.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.outingRequest.deleteMany({ where: { id: { in: ids } } }) },
  { model: "RemoteWorkRequest", cat: "request",
    count: (c) => prisma.remoteWorkRequest.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.remoteWorkRequest.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.remoteWorkRequest.deleteMany({ where: { id: { in: ids } } }) },
  { model: "OvertimeRequest", cat: "request",
    count: (c) => prisma.overtimeRequest.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.overtimeRequest.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.overtimeRequest.deleteMany({ where: { id: { in: ids } } }) },
  { model: "BusinessTripRequest", cat: "request",
    count: (c) => prisma.businessTripRequest.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.businessTripRequest.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.businessTripRequest.deleteMany({ where: { id: { in: ids } } }) },
  { model: "ApprovalLineTemplate", cat: "request",
    count: (c) => prisma.approvalLineTemplate.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.approvalLineTemplate.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.approvalLineTemplate.deleteMany({ where: { id: { in: ids } } }) },
  // 교대(ShiftGroup은 직원이 가리키므로 직원 뒤에서 지운다)
  { model: "ShiftAssignment", cat: "shift",
    count: (c) => prisma.shiftAssignment.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.shiftAssignment.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.shiftAssignment.deleteMany({ where: { id: { in: ids } } }) },
  { model: "ShiftChangeLog", cat: "shift",
    count: (c) => prisma.shiftChangeLog.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.shiftChangeLog.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.shiftChangeLog.deleteMany({ where: { id: { in: ids } } }) },
  { model: "ShiftPattern", cat: "shift",
    count: (c) => prisma.shiftPattern.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.shiftPattern.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.shiftPattern.deleteMany({ where: { id: { in: ids } } }) },
  // RotationRule은 기본 번호가 companyId 자체다(회사당 1행) — id 자리에 companyId를 돌려준다.
  { model: "RotationRule", cat: "shift",
    count: (c) => prisma.rotationRule.count({ where: { companyId: c } }),
    pick: async (c, take) => (await prisma.rotationRule.findMany({ where: { companyId: c }, select: { companyId: true }, take })).map((r) => ({ id: r.companyId })),
    del: (ids) => prisma.rotationRule.deleteMany({ where: { companyId: { in: ids } } }) },
  { model: "Shift", cat: "shift",
    count: (c) => prisma.shift.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.shift.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.shift.deleteMany({ where: { id: { in: ids } } }) },
  // PC 프로그램
  { model: "AgentEvent", cat: "agent",
    count: (c) => prisma.agentEvent.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.agentEvent.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.agentEvent.deleteMany({ where: { id: { in: ids } } }) },
  { model: "AgentPairCode", cat: "agent",
    count: (c) => prisma.agentPairCode.count({ where: { user: { companyId: c } } }),
    pick: (c, take) => prisma.agentPairCode.findMany({ where: { user: { companyId: c } }, select: { id: true }, take }),
    del: (ids) => prisma.agentPairCode.deleteMany({ where: { id: { in: ids } } }) },
  { model: "AgentDevice", cat: "agent",
    count: (c) => prisma.agentDevice.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.agentDevice.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.agentDevice.deleteMany({ where: { id: { in: ids } } }) },
  // 계정·인증·문자·게시
  { model: "Session", cat: "other",
    count: (c) => prisma.session.count({ where: { user: { companyId: c } } }),
    pick: (c, take) => prisma.session.findMany({ where: { user: { companyId: c } }, select: { id: true }, take }),
    del: (ids) => prisma.session.deleteMany({ where: { id: { in: ids } } }) },
  { model: "PasswordResetCode", cat: "other",
    count: (c) => prisma.passwordResetCode.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.passwordResetCode.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.passwordResetCode.deleteMany({ where: { id: { in: ids } } }) },
  { model: "PasswordResetRequest", cat: "other",
    count: (c) => prisma.passwordResetRequest.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.passwordResetRequest.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.passwordResetRequest.deleteMany({ where: { id: { in: ids } } }) },
  { model: "PhoneVerifyCode", cat: "other",
    count: (c) => prisma.phoneVerifyCode.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.phoneVerifyCode.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.phoneVerifyCode.deleteMany({ where: { id: { in: ids } } }) },
  { model: "Invite", cat: "other",
    count: (c) => prisma.invite.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.invite.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.invite.deleteMany({ where: { id: { in: ids } } }) },
  { model: "BlockedIp", cat: "other",
    count: (c) => prisma.blockedIp.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.blockedIp.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.blockedIp.deleteMany({ where: { id: { in: ids } } }) },
  { model: "SmsLog", cat: "other",
    count: (c) => prisma.smsLog.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.smsLog.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.smsLog.deleteMany({ where: { id: { in: ids } } }) },
  { model: "SmsTemplate", cat: "other",
    count: (c) => prisma.smsTemplate.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.smsTemplate.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.smsTemplate.deleteMany({ where: { id: { in: ids } } }) },
  { model: "Announcement", cat: "other",
    count: (c) => prisma.announcement.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.announcement.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.announcement.deleteMany({ where: { id: { in: ids } } }) },
  { model: "CompanyEvent", cat: "other",
    count: (c) => prisma.companyEvent.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.companyEvent.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.companyEvent.deleteMany({ where: { id: { in: ids } } }) },
  { model: "CompanyHoliday", cat: "other",
    count: (c) => prisma.companyHoliday.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.companyHoliday.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.companyHoliday.deleteMany({ where: { id: { in: ids } } }) },
  // 자동결제 카드(2026-11-23 결제 1단계). ⚠️ 이 행에 닿기 전에 purgeOne이 삭제가 안 끝난 카드가 있으면 기다린다(아래 ⓪).
  //   여기까지 왔다면 남은 행은 전부 bid가 지워지고 상태가 deleted·failed인 기록뿐이다.
  { model: "PgBillingKey", cat: "other",
    count: (c) => prisma.pgBillingKey.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.pgBillingKey.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.pgBillingKey.deleteMany({ where: { id: { in: ids } } }) },
  { model: "CompanyDocument", cat: "other",
    count: (c) => prisma.companyDocument.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.companyDocument.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.companyDocument.deleteMany({ where: { id: { in: ids } } }) },
  // 계정 — 위 표들이 전부 비워진 뒤에야 지울 수 있다
  { model: "User", cat: "user",
    count: (c) => prisma.user.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.user.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.user.deleteMany({ where: { id: { in: ids } } }) },
  // 직원이 가리키던 표 — 직원 뒤에
  { model: "ShiftGroup", cat: "shift",
    count: (c) => prisma.shiftGroup.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.shiftGroup.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.shiftGroup.deleteMany({ where: { id: { in: ids } } }) },
  { model: "Department", cat: "other",
    count: (c) => prisma.department.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.department.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.department.deleteMany({ where: { id: { in: ids } } }) },
  { model: "JobGrade", cat: "other",
    count: (c) => prisma.jobGrade.count({ where: { companyId: c } }),
    pick: (c, take) => prisma.jobGrade.findMany({ where: { companyId: c }, select: { id: true }, take }),
    del: (ids) => prisma.jobGrade.deleteMany({ where: { id: { in: ids } } }) },
];

/** 일부러 지우지 않는 표. 회사·직원 칸이 있지만 파기 대상이 아니다. */
const KEPT_MODELS = new Set<string>([
  "AccessEvent",     // 접속기록 — 처리방침 "2년" 별도 공개(사장님 결정 ①). 기존 2년 자동 파기가 지운다.
  "CompanyPurgeLog", // 이 파기의 대장 자체
  "PgOrder",         // 결제 주문(2026-11-23) — 대금결제 기록 5년 보관(전자상거래법 시행령 제6조·국세기본법). 이름·전화번호 없음.
                     //   ⏳ 5년 지난 결제 기록 파기는 결제 운영 시작 뒤 별도 과제(plan-근태결제-개발.md).
]);

/**
 * 표 목록 자동 대조 — 회사·직원·출퇴근을 가리키는 칸(companyId·userId·attendanceId)이 있는 표 중
 * 위 TABLES에도 KEPT_MODELS에도 없는 것. 비어 있지 않으면 파기를 시작하지 않는다.
 *  · 새 표를 만들고 여기 추가하는 것을 잊으면 → 이 함수가 그 이름을 돌려주고, 파기가 멈추고, 운영자 화면에 빨갛게 뜬다.
 */
// 이 표들을 가리키는 관계(외래키)가 있는 표도 "회사 데이터"로 본다 — 칸 이름이 companyId·userId가 아니어도 잡히게(검수 경미 5).
const OWNER_MODELS = new Set(["Company", "User", "Attendance", "AgentDevice"]);
const ID_FIELDS = new Set(["companyId", "userId", "attendanceId"]);

export function uncoveredModels(): string[] {
  const models = Prisma.dmmf.datamodel.models;
  // 모델 목록을 못 읽으면(빌드 방식 차이 등) 대조가 늘 0건이 되어 안전장치가 소리 없이 꺼진다 → 멈추는 쪽으로(검수 경미 5).
  if (!models.some((m) => m.name === "Company")) return ["(DB 표 목록을 읽지 못함)"];
  const handled = new Set(TABLES.map((t) => t.model));
  return models
    .filter((m) =>
      m.fields.some((f) => ID_FIELDS.has(f.name) || (f.kind === "object" && !f.isList && OWNER_MODELS.has(f.type) && (f.relationFromFields?.length ?? 0) > 0))
    )
    .map((m) => m.name)
    .filter((name) => !handled.has(name) && !KEPT_MODELS.has(name));
}

/** 그 회사에 남은 행 수(표별). 0이 아닌 표만 돌려준다. 파기 마지막 확인·검증에 쓴다. 회사 행 자체는 세지 않는다. */
export async function companyFootprint(companyId: string): Promise<Record<string, number>> {
  const cid = assertCompanyId(companyId);
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const n = await t.count(cid);
    if (n > 0) out[t.model] = n;
  }
  return out;
}

type Counts = { face: number; file: number } & Record<Cat, number>;
const zeroCounts = (): Counts => ({ face: 0, file: 0, attendance: 0, request: 0, shift: 0, agent: 0, user: 0, other: 0 });

export type CompanyPurgeOutcome = {
  companyId: string;
  status: "done" | "held" | "waiting" | "aborted" | "skipped";
  counts: Counts;
  note?: string;
};

type Deps = {
  now?: Date;
  /** 검증 전용 — 얼굴서버 실패를 흉내 낼 때만 바꾼다. */
  unenroll?: typeof unenrollFaceOutcome;
  /** 검증 전용 — 이 회사만 대상으로 삼는다(개발 PC에 다른 해지 회사가 있어도 건드리지 않게). */
  onlyCompanyId?: string;
  /** 이 시각(시)이 되면 다음 회사를 시작하지 않는다. 자동 실행이 PURGE_HOUR_TO를 넘긴다. */
  stopAtHour?: number;
};

/** 표 하나를 그 회사 몫이 0건이 될 때까지 잘라서 지운다. 진행이 없으면(지운 게 0건) 멈춘다 — 무한 반복 방지. */
async function drain(t: Table, cid: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_LOOPS; i++) {
    const rows = await t.pick(cid, CHUNK);
    if (rows.length === 0) return total;
    const r = await t.del(rows.map((x) => x.id));
    if (r.count === 0) throw new Error(`${t.model} 삭제가 진행되지 않음(0건)`);
    total += r.count;
  }
  throw new Error(`${t.model} 반복 상한 초과`);
}

async function writeLog(cid: string, terminatedAt: Date, status: "done" | "held" | "waiting" | "aborted", c: Counts, note?: string): Promise<void> {
  try {
    await prisma.companyPurgeLog.create({
      data: {
        companyId: cid, terminatedAt, status,
        faceDeleted: c.face, fileDeleted: c.file,
        attendanceDeleted: c.attendance, requestDeleted: c.request, shiftDeleted: c.shift,
        agentDeleted: c.agent, userDeleted: c.user, otherDeleted: c.other,
        note: note ? note.slice(0, 500) : null,
      },
    });
  } catch (e) {
    // 대장 기록 실패가 파기 결과를 바꾸지는 않는다. 다만 콘솔에는 반드시 남긴다(증빙이 빠진 사실을 알 수 있게).
    console.error(`[company-purge] 파기 대장 기록 실패(회사 ${cid.slice(0, 8)}, ${status}):`, e);
  }
}

/** 회사 1곳 파기. 호출 전에 대상 여부를 이미 확인했어도, 여기서 한 번 더 확인한다. */
async function purgeOne(companyId: string, now: Date, unenroll: typeof unenrollFaceOutcome): Promise<CompanyPurgeOutcome> {
  const cid = assertCompanyId(companyId);
  const counts = zeroCounts();

  // ── 재확인: 해지됨 + 30일 지남 + 미래 날짜 아님 ──
  const c = await prisma.company.findUnique({ where: { id: cid }, select: { id: true, terminatedAt: true, purgeStartedAt: true } });
  if (!c || !c.terminatedAt) return { companyId: cid, status: "skipped", counts, note: "해지 상태가 아님(되살림 등)" };
  const terminatedAt = c.terminatedAt;
  if (terminatedAt.getTime() > now.getTime() || !isRetentionOver(terminatedAt, now)) {
    return { companyId: cid, status: "skipped", counts, note: `보관 기간(${TERMINATION_RETENTION_DAYS}일)이 끝나지 않음` };
  }

  // ── ⓪ 자동결제 카드 — KIS에 카드가 남아 있을 수 있으면 **손대지 않고 기다린다**(2026-11-23 결제 1단계, 검수 M3·M4) ──
  //  · 우리 DB 행만 지우면 KIS에는 카드 대신 쓰는 결제용 번호(빌키)가 영원히 남는다. 그건 파기가 아니다.
  //  · bid가 있는 카드뿐 아니라 **등록 중(registering·reg_check)·삭제 중(deleting)** 카드도 기다린다 — 등록 응답이 끊겨
  //    우리 쪽은 bid가 비었는데 KIS에는 빌키가 생긴 경우가 있다(학원관리는 reg_check를 조회로 정리한다).
  //  · ① 파기 시작 표시 **앞에서** 본다: 아무것도 지우지 않았는데 [되살리기]가 막히면 안 된다.
  //  · 대장 상태는 "waiting" — 하루 3곳 상한에 세지 않는다(지운 게 없으므로). 그래야 카드 삭제가 늦는 회사 몇 곳이
  //    매일 몫을 차지해 다른 회사의 "30일 뒤 파기"가 밀리는 일이 없다. 20시간 재시도 대기는 똑같이 걸린다.
  //  · 해지할 때 카드를 지우는(deleting → KIS 삭제 → bid null → deleted) 처리 = lib/billing-auto.ts markCompanyCardsForDeletion(3단계).
  const pendingCards = await prisma.pgBillingKey.count({
    where: { companyId: cid, OR: [{ bid: { not: null } }, { status: { notIn: ["deleted", "failed"] } }] },
  });
  if (pendingCards > 0) {
    const note = `자동결제 카드 ${pendingCards}장의 KIS 삭제가 끝나지 않아 대기 — 삭제가 끝나면 다음 회차에 다시 시도(아직 아무것도 지우지 않음)`;
    await writeLog(cid, terminatedAt, "waiting", counts, note);
    return { companyId: cid, status: "waiting", counts, note };
  }

  // ── ① 파기 시작 표시 — 읽은 해지 시각 그대로일 때만(그사이 되살리거나 다시 해지했으면 0건 → 손대지 않음) ──
  const marked = await prisma.company.updateMany({
    where: { id: cid, terminatedAt },
    data: { purgeStartedAt: c.purgeStartedAt ?? now },
  });
  if (marked.count === 0) return { companyId: cid, status: "skipped", counts, note: "그사이 상태가 바뀜" };

  // ── ② 얼굴서버 — 직원 행이 남아 있는 동안에 한다 ──
  const users = await prisma.user.findMany({
    where: { companyId: cid },
    select: { id: true, faceEnrolledAt: true, faceConsentAt: true, authMethod: true },
  });
  for (const u of users) {
    const state = { enrolled: !!u.faceEnrolledAt, history: u.authMethod === "face" || !!u.faceConsentAt };
    const outcome = await unenroll(u.id, cid, state);
    if (outcome === "failed") {
      const note = `얼굴서버 삭제 실패로 보류(직원 ${users.length}명 중 ${counts.face}명 처리 후) — 다음 회차에 다시 시도`;
      await writeLog(cid, terminatedAt, "held", counts, note);
      return { companyId: cid, status: "held", counts, note };
    }
    if (outcome !== "skipped") counts.face++;
  }

  // ── ③ 디스크 파일 — 실패가 하나라도 있으면 DB를 건드리지 않는다 ──
  try {
    // 🔴 fileDeletedAt(이미 지움 표시)으로 거르지 않는다(검수 중간 2). 90일 파기·동의 철회는 파일 삭제가 실패해도
    //    표시를 찍는다(lib/clock-photo.ts unlinkAndMark) — 거르면 그런 사진은 여기서 건너뛰고, 곧 행이 지워져
    //    "누구 얼굴인지"라는 단서까지 사라진 채 파일만 영구히 남는다. 이미 없는 파일은 absent로 세어 비용이 거의 없다.
    const photos = await prisma.clockPhoto.findMany({ where: { companyId: cid }, select: { fileName: true } });
    const p = await deleteClockPhotoFiles(photos.map((x) => x.fileName));
    counts.file += p.deleted;
    const a = await deleteCompanyAttachmentDir(cid);
    counts.file += a.deleted;
    const d = await deleteCompanyDocDir(cid);
    counts.file += d.deleted;
    const failed = p.failed.length + a.failed + d.failed;
    if (failed > 0) {
      const note = `파일 ${failed}개 삭제 실패로 보류(사진 ${p.failed.length}·첨부 ${a.failed}·문서 ${d.failed}) — 다음 회차에 다시 시도`;
      await writeLog(cid, terminatedAt, "held", counts, note);
      return { companyId: cid, status: "held", counts, note };
    }
  } catch (e) {
    const note = `파일 삭제 중 오류로 보류 — ${e instanceof Error ? e.message : "원인미상"}`;
    await writeLog(cid, terminatedAt, "held", counts, note);
    return { companyId: cid, status: "held", counts, note };
  }

  // ── ④ DB 행 — 자식부터. 도중 오류면 그때까지 지운 건수를 대장에 남기고 이번 실행을 멈춘다 ──
  try {
    for (const t of TABLES) counts[t.cat] += await drain(t, cid);

    // ── ⑤ 남은 행 0건 확인 후 회사 행 삭제 ──
    const left = await companyFootprint(cid);
    if (Object.keys(left).length > 0) {
      throw new Error(`남은 행이 있어 회사 행을 지우지 않음 — ${JSON.stringify(left)}`);
    }
    const gone = await prisma.company.deleteMany({
      where: { id: cid, terminatedAt: { not: null }, purgeStartedAt: { not: null } },
    });
    if (gone.count !== 1) throw new Error(`회사 행 삭제 결과가 ${gone.count}건`);
    counts.other += 1;
  } catch (e) {
    const note = `DB 삭제 중 중단(위 건수는 중단 전까지 실제로 지운 수) — ${e instanceof Error ? e.message : "원인미상"}`;
    await writeLog(cid, terminatedAt, "aborted", counts, note);
    return { companyId: cid, status: "aborted", counts, note };
  }

  // ── ⑥ 대장 ──
  await writeLog(cid, terminatedAt, "done", counts);
  console.log(
    `[company-purge] 해지 회사 파기 완료(ID ${cid.slice(0, 8)}) — 얼굴 ${counts.face} · 파일 ${counts.file} · 출퇴근 ${counts.attendance} · ` +
      `신청 ${counts.request} · 교대 ${counts.shift} · PC ${counts.agent} · 계정 ${counts.user} · 기타 ${counts.other}`
  );
  return { companyId: cid, status: "done", counts };
}

/**
 * 보관 기간(30일)이 끝난 해지 회사를 파기한다. 하루(최근 20시간) 최대 MAX_COMPANIES_PER_RUN곳.
 *  · 시간대(새벽) 판단·하루 주기는 호출부(runCompanyPurgeIfDue)가 한다. 이 함수는 부르면 바로 돈다.
 *  · 예외를 밖으로 던지지 않는 것을 원칙으로 하되, 혹시 새는 예외는 호출부가 막는다.
 */
export async function purgeDueCompanies(deps: Deps = {}): Promise<{ results: CompanyPurgeOutcome[]; blocked?: string }> {
  const now = deps.now ?? new Date();
  const unenroll = deps.unenroll ?? unenrollFaceOutcome;

  // 안전장치 ④ — 모르는 표가 있으면 아무것도 지우지 않는다.
  const missing = uncoveredModels();
  if (missing.length > 0) {
    const blocked = `파기 목록에 없는 표가 있어 자동 파기를 멈춥니다: ${missing.join(", ")} — lib/company-purge.ts TABLES에 추가할 것`;
    console.error(`[company-purge] ${blocked}`);
    return { results: [], blocked };
  }

  // 대상: 해지 시각이 (지금 − 30일) 이전. 기준선은 lib/company-termination.ts와 같은 달력 계산.
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - TERMINATION_RETENTION_DAYS);
  const only = deps.onlyCompanyId !== undefined ? assertCompanyId(deps.onlyCompanyId) : null;
  const candidates = await prisma.company.findMany({
    where: { terminatedAt: { not: null, lte: cutoff }, ...(only ? { id: only } : {}) },
    select: { id: true, terminatedAt: true },
    orderBy: { terminatedAt: "asc" },
    take: 50,
  });

  // 최근 20시간 안에 손댄 회사(완료·보류·중단 모두) — 두 가지에 쓴다.
  //  ① 하루 상한(검수 중간 1): 예전엔 "한 번 실행에 3곳"이라, 새벽 1~3시에 2~3번 돌면 하루 6~9곳까지 지워질 수 있었다.
  //     이제 최근 20시간에 이미 손댄 회사 수만큼 이번 몫을 줄인다 → 하루 최대 3곳.
  //  ② 재시도 대기: 보류·중단된 회사는 20시간 안에 다시 두드리지 않는다(얼굴서버가 꺼진 동안 매시간 요청하지 않게).
  const recent = await prisma.companyPurgeLog.findMany({
    where: { ranAt: { gt: new Date(now.getTime() - RETRY_AFTER_MS) } },
    select: { companyId: true, status: true },
  });
  const cooling = new Set(recent.map((r) => r.companyId));
  // 하루 상한은 "실제로 손댄(지우기 시작한) 회사"만 센다 — waiting(카드 대기)은 아무것도 지우지 않았다(검수 M4).
  const touched = new Set(recent.filter((r) => r.status !== "waiting").map((r) => r.companyId));
  const budget = Math.max(0, MAX_COMPANIES_PER_RUN - touched.size);

  const results: CompanyPurgeOutcome[] = [];
  let used = 0; // 이번 실행에서 실제로 손댄 회사 수(waiting 제외)
  for (const cand of candidates) {
    if (used >= budget) break;
    if (cooling.has(cand.id)) continue;
    // 3시가 넘었으면 다음 회사는 시작하지 않는다(검수 경미 9) — 03:30 백업과 겹치지 않게. 남은 회사는 다음 날.
    if (deps.stopAtHour !== undefined && new Date().getHours() >= deps.stopAtHour) break;
    let r: CompanyPurgeOutcome;
    try {
      r = await purgeOne(cand.id, now, unenroll);
    } catch (e) {
      // purgeOne의 try 밖(재확인·파기 시작 표시·직원 조회)에서 난 예외(검수 경미 4) — 대장에 남겨 20시간 대기를 걸고 멈춘다.
      //  남기지 않으면 다음 실행이 같은 회사부터 다시 부딪쳐 뒤의 회사들이 계속 밀린다.
      const note = `파기 준비 중 오류로 중단 — ${e instanceof Error ? e.message : "원인미상"}`;
      await writeLog(cand.id, cand.terminatedAt ?? now, "aborted", zeroCounts(), note);
      results.push({ companyId: cand.id, status: "aborted", counts: zeroCounts(), note });
      break;
    }
    if (r.status === "skipped") continue;
    results.push(r);
    if (r.status !== "waiting") used++;
    if (r.status === "aborted") break; // DB 오류(잠금 등) 중에 다음 회사로 넘어가 부하를 키우지 않는다
  }
  return { results };
}

// ════════════════════════════════════════════════════════════════════════════
//  자동 실행(lib/scheduled-jobs.ts가 1시간마다 부른다) — 새벽 1시~3시(한국시간)에만 실제로 돈다.
//   · 왜 새벽인가: 파기는 DB 쓰기를 많이 한다. 근무시간에 돌면 다른 회사 출퇴근 저장이 잠깐씩 밀린다.
//     03:30 정기 백업(deploy/server/backup-attendance.sh)과도 겹치지 않게 3시 전에 끝낸다.
//   · 서버 TZ=Asia/Seoul 전제(Dockerfile·docker-compose.prod.yml에 지정). getHours()가 한국 시각이다.
//   · 1시간 간격이라 그 2시간 안에 1~3번 돌 수 있다. 하루 3곳 상한은 대장(최근 20시간)으로 세므로 몇 번 돌아도 같다.
//   · 3시가 넘으면 다음 회사를 시작하지 않는다(stopAtHour). 이미 시작한 회사 하나는 끝까지 간다(대개 몇 분).
// ════════════════════════════════════════════════════════════════════════════
export const PURGE_HOUR_FROM = 1; // 이 시각(포함)부터
export const PURGE_HOUR_TO = 3;   // 이 시각(미포함)까지

let purgeRunning = false; // 한 서버 안에서 겹쳐 돌지 않게(앞 회차가 오래 걸려도 다음 회차가 끼어들지 않는다)

export async function runCompanyPurgeIfDue(): Promise<void> {
  const h = new Date().getHours();
  if (h < PURGE_HOUR_FROM || h >= PURGE_HOUR_TO) return;
  if (purgeRunning) return;
  purgeRunning = true;
  try {
    const r = await purgeDueCompanies({ stopAtHour: PURGE_HOUR_TO });
    if (r.blocked) return; // 이미 console.error로 남겼다. 운영자 화면에도 빨갛게 뜬다(getPurgeOverview).
    for (const x of r.results) {
      if (x.status !== "done") console.warn(`[company-purge] 회사 ${x.companyId.slice(0, 8)} ${x.status} — ${x.note ?? ""}`);
    }
  } catch (e) {
    // 파기 실패가 서버를 멈추면 안 된다. 다음 회차(1시간 뒤, 시간대 안이면)나 다음 날 다시 돈다.
    console.error("[company-purge] 자동 파기 실행 오류:", e);
  } finally {
    purgeRunning = false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  운영자 화면용 현황 — "해지한 회사가 언제 지워지는지 / 왜 아직 안 지워졌는지 / 무엇을 지웠는지"
//   · 회사 이름은 아직 지워지지 않은 회사(해지 후 보관 중)에만 있다. 파기된 회사는 대장에 id만 남는다.
// ════════════════════════════════════════════════════════════════════════════
export type PurgePending = {
  id: string;
  name: string;
  terminatedAt: Date;
  dueAt: Date;
  state: "keeping" | "waiting" | "held"; // 보관 중 / 파기 대기(다음 새벽) / 보류·중단(마지막 시도 실패)
  note: string | null; // held일 때 마지막 시도의 사유
};
export type PurgeDone = { companyId: string; terminatedAt: Date; ranAt: Date; total: number; face: number; file: number };

export async function getPurgeOverview(now: Date = new Date()): Promise<{ uncovered: string[]; pending: PurgePending[]; done: PurgeDone[] }> {
  const companies = await prisma.company.findMany({
    where: { terminatedAt: { not: null } },
    select: { id: true, name: true, terminatedAt: true, purgeStartedAt: true },
    orderBy: { terminatedAt: "asc" },
    take: 100,
  });
  // 회사마다 마지막 시도 1건 — 보관 중인 회사 수는 많지 않아 한 번에 읽고 코드에서 고른다.
  const logs = companies.length
    ? await prisma.companyPurgeLog.findMany({
        where: { companyId: { in: companies.map((c) => c.id) } },
        select: { companyId: true, status: true, note: true, ranAt: true },
        orderBy: { ranAt: "desc" },
      })
    : [];
  const lastLog = new Map<string, { status: string; note: string | null }>();
  for (const l of logs) if (!lastLog.has(l.companyId)) lastLog.set(l.companyId, l);

  const pending: PurgePending[] = [];
  for (const c of companies) {
    if (!c.terminatedAt) continue;
    const last = lastLog.get(c.id);
    const over = isRetentionOver(c.terminatedAt, now);
    const held = over && !!last && last.status !== "done";
    pending.push({
      id: c.id, name: c.name, terminatedAt: c.terminatedAt,
      dueAt: purgeDueAt(c.terminatedAt),
      state: !over ? "keeping" : held ? "held" : "waiting",
      note: held ? last?.note ?? null : null,
    });
  }

  const doneRows = await prisma.companyPurgeLog.findMany({
    where: { status: "done" },
    orderBy: { ranAt: "desc" },
    take: 10,
  });
  const done = doneRows.map((d) => ({
    companyId: d.companyId, terminatedAt: d.terminatedAt, ranAt: d.ranAt, face: d.faceDeleted, file: d.fileDeleted,
    total: d.attendanceDeleted + d.requestDeleted + d.shiftDeleted + d.agentDeleted + d.userDeleted + d.otherDeleted,
  }));

  return { uncovered: uncoveredModels(), pending, done };
}
