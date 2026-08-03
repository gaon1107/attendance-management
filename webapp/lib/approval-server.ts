// 결재선(부서장 자동 결재선) DB 로직 — 결재자 해석·단계 진행·결재함 조회.
//  · 순수 계산은 lib/approval.ts, 여기선 DB 접근(회사격리 필수).
//  · 설계: docs/04_architecture/결재선_설계.md
import { cache } from "react";
import { prisma } from "@/lib/db";
import { buildApprovalChain, nextPendingStep, isChainComplete, isChainRejected, type DeptNode, type ChainApprover } from "@/lib/approval";
import { outingKindLabel } from "@/lib/outing";
import { remoteRangeLabel } from "@/lib/remote";
import { overtimeTimeLabel } from "@/lib/overtime-request";
import { tripRangeLabel } from "@/lib/trip";

export type RequestType = "leave" | "correction" | "outing" | "remote" | "overtime" | "trip";

// 결재선 대상 신청 유형 목록(런타임). custom 결재선 저장·검증에서 화이트리스트로 사용.
export const REQUEST_TYPES: readonly RequestType[] = ["leave", "correction", "outing", "remote", "overtime", "trip"];
export function isRequestType(t: string): t is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(t);
}

// custom 결재선 1건당 최대 결재자 수(대리~대표까지 담기게 넉넉히).
export const MAX_APPROVERS = 8;

type Me = { id: string; role: string; companyId: string };

// 직급 상급자 후보 범위 = "나보다 직급 높은 사람" 중,
//   ① 같은 부서(내 팀 상급자: 대리→과장→부장)  또는  ② 내 부서 최고 직급보다 높은 전사 임원(부장 위: 상무→전무→대표).
//  · 조직도(부서장/상위부서) 없이 직급만으로 결재선을 짠다(직급 단일 모델). 직원·부서장 모두 이 후보에서 직접 고른다.
type Scope = { myLevel: number; deptMax: number; departmentId: string | null };
async function candidateScope(companyId: string, applicantUserId: string): Promise<Scope | null> {
  const me = await prisma.user.findFirst({
    where: { id: applicantUserId, companyId },
    select: { departmentId: true, jobGrade: { select: { level: true } } },
  });
  if (!me?.jobGrade) return null; // 직급 미지정이면 상급자 판별 불가
  let deptMax = me.jobGrade.level;
  if (me.departmentId) {
    const top = await prisma.user.findFirst({
      where: { companyId, deactivatedAt: null, departmentId: me.departmentId, jobGradeId: { not: null } },
      orderBy: { jobGrade: { level: "desc" } },
      select: { jobGrade: { select: { level: true } } },
    });
    if (top?.jobGrade) deptMax = Math.max(deptMax, top.jobGrade.level);
  }
  return { myLevel: me.jobGrade.level, deptMax, departmentId: me.departmentId };
}
// "유효 상급자 후보" Prisma where 조각 — companyId·재직 등과 AND로 합쳐 쓴다.
function candidateWhere(scope: Scope) {
  const sameDept = scope.departmentId ? [{ departmentId: scope.departmentId }] : [];
  return {
    AND: [
      { jobGrade: { level: { gt: scope.myLevel } } }, // 나보다 상급 직급
      { OR: [...sameDept, { jobGrade: { level: { gt: scope.deptMax } } }] }, // 같은 부서 OR 내 부서 최고직급 위(임원)
    ],
  };
}

// custom 결재선 편집용 후보 목록 — "나보다 직급 높은 상급자"(같은 부서 팀 상급자 + 내 부서 최고직급 위 전사 임원).
//  · 직급 단일 모델: 직원(사원→대리→과장→부장)도 부서장(→상무→전무→대표)도 이 후보에서 직접 고른다. 조직도 불필요.
//  · 내부통제: 나보다 낮거나 같은 직급은 후보에 안 나옴 → 동료/부하 상호지정 원천 차단.
//  · 신청자가 직급 미지정이면 후보 0명 → 결재선 설정 불가(관리자 단독 승인 폴백).
export type LineCandidate = { id: string; name: string; employeeNo: string | null; deptName: string | null; gradeName: string | null };
export async function listApprovalCandidates(companyId: string, excludeUserId: string): Promise<LineCandidate[]> {
  const scope = await candidateScope(companyId, excludeUserId);
  if (!scope) return []; // 직급 미지정 → 고를 상급자 없음
  const users = await prisma.user.findMany({
    where: {
      companyId,
      deactivatedAt: null,
      id: { not: excludeUserId },
      ...candidateWhere(scope),
    },
    select: { id: true, name: true, employeeNo: true, department: { select: { name: true } }, jobGrade: { select: { name: true } } },
    orderBy: [{ jobGrade: { level: "asc" } }, { name: "asc" }], // 낮은 상급자부터(대리→과장→…→대표)
  });
  return users.map((u) => ({ id: u.id, name: u.name, employeeNo: u.employeeNo, deptName: u.department?.name ?? null, gradeName: u.jobGrade?.name ?? null }));
}

// custom 모드: 저장된 개인 결재선(ApprovalLineTemplate)을 로드해 "실제로 결재 가능한" 결재자 id 순서를 돌려준다.
//  · 검증: 같은 회사 재직자 + 본인 제외 + 중복 제거 + 순서 보존 + 최대 MAX_APPROVERS.
//  · 저장 후 결재자가 퇴사(deactivatedAt)했으면 자동으로 건너뛴다. 결과 빈 배열이면 관리자 단일 승인 폴백.
export async function resolveCustomApprovers(
  companyId: string,
  applicantUserId: string,
  requestType: RequestType,
): Promise<string[]> {
  const tpl = await prisma.approvalLineTemplate.findFirst({
    where: { companyId, userId: applicantUserId, requestType },
    select: { approverIdsCsv: true },
  });
  if (!tpl || !tpl.approverIdsCsv.trim()) return [];
  const raw = tpl.approverIdsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  return filterActiveApprovers(companyId, applicantUserId, raw);
}

// 결재자 id 목록을 "현재 유효한 상급자"만 남긴다: 후보 규칙(직급 상급자)·본인 제외·중복 제거·순서 보존·상한.
//  · 저장(saveApprovalLine)·신청(resolveCustomApprovers) 양쪽 공용 → 후보 화면(listApprovalCandidates)과 같은 규칙을
//    선택·실행 모두에 강제(폼 위조로 동급·하급·범위 밖 지정 차단).
//  · 신청자 직급 미지정이면 0명. 저장 후 결재자가 퇴사/직급하락/부서이동하면 자동 제외(안전 폴백).
export async function filterActiveApprovers(
  companyId: string,
  applicantUserId: string,
  ids: string[],
): Promise<string[]> {
  const uniq: string[] = [];
  const seen = new Set<string>([applicantUserId]); // 본인 제외
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  if (uniq.length === 0) return [];
  const scope = await candidateScope(companyId, applicantUserId);
  if (!scope) return [];
  // 같은 회사·재직 + 직급 상급자 범위(같은 부서 팀 상급자 + 부서최고직급 위 임원)인 결재자만 남긴다.
  const valid = await prisma.user.findMany({
    where: { id: { in: uniq }, companyId, deactivatedAt: null, ...candidateWhere(scope) },
    select: { id: true },
  });
  const validSet = new Set(valid.map((u) => u.id));
  return uniq.filter((id) => validSet.has(id)).slice(0, MAX_APPROVERS);
}

// 신청자의 결재선(결재자 목록)을 계산. 빈 배열이면 결재선 없음(관리자 단일 승인 폴백).
//  · 반환 각 원소 isFinal=true면 전결권자(그 단계에서 종결). 전결권자를 만나면 배열이 그 사람에서 끝난다.
export async function resolveApproverChain(
  companyId: string,
  applicantUserId: string,
  applicantDeptId: string | null,
  stepCount: number,
): Promise<ChainApprover[]> {
  const depts = await prisma.department.findMany({
    where: { companyId },
    select: { id: true, headUserId: true, parentId: true, deputyUserId: true, finalApproval: true },
  });
  const map = new Map<string, DeptNode>(depts.map((d) => [d.id, d]));

  // 🔴 [검수 H-6 → 9-A 개선] 퇴사한 사람을 결재자로 세우지 않는다.
  //   예전엔 체인을 만든 **뒤에** 퇴사자를 빼기만 해서 ① 그 부서의 대결자가 대신 서지 못했고
  //   ② 전결(isFinal) 단계가 통째로 사라져 체인이 거기서 잘렸다.
  //   이제 부서장/대결자 후보 전원의 재직 여부를 **먼저** 조회해 buildApprovalChain에 주입한다 —
  //   퇴사한 부서장 자리는 대결자가 대신 서고(전결권 승계), 둘 다 없으면 상위 부서로 이어진다.
  const candidateIds = [
    ...new Set(depts.flatMap((d) => [d.headUserId, d.deputyUserId]).filter((v): v is string => !!v)),
  ];
  const alive = candidateIds.length
    ? await prisma.user.findMany({
        where: { id: { in: candidateIds }, companyId, deactivatedAt: null },
        select: { id: true },
      })
    : [];
  const aliveSet = new Set(alive.map((u) => u.id));
  return buildApprovalChain(applicantUserId, applicantDeptId, map, stepCount, aliveSet).approvers;
}

// 신청 생성 직후 결재선(ApprovalStep들)을 만든다. 결재자가 없으면 만들지 않는다(=관리자 단일 승인).
//  · single: 결재선 없음(관리자 단독).
//  · deptline: 부서장 자동 결재선(전결권자 단계엔 isFinal 저장).
//  · custom(직급 단일): 직원이 직급 상급자(같은 부서 팀 상급자 + 부서최고직급 위 임원) 중 직접 고른 순서 그대로.
//      - 직원(사원→대리→과장→부장)도 부서장(→상무→전무→대표)도 같은 방식으로 고른다. 조직도 자동부는 없다.
//      - 미설정(선택 0)·직급 미지정 → 단계 미생성 = 관리자 단독 승인 폴백. 마지막 단계 승인=최종 확정(isChainComplete).
export async function createApprovalStepsIfNeeded(
  company: { approvalMode: string; approvalStepCount: number } | null,
  companyId: string,
  applicantUserId: string,
  applicantDeptId: string | null,
  requestType: RequestType,
  requestId: string,
): Promise<void> {
  if (!company) return;

  if (company.approvalMode === "custom") {
    // 직원이 고른 상급자 결재선(순서 그대로). 유효성(직급 상급자·재직)은 resolveCustomApprovers가 재검증.
    const ids = await resolveCustomApprovers(companyId, applicantUserId, requestType);
    if (ids.length === 0) return; // 미설정/유효 0 → 관리자 단독 승인 폴백
    await prisma.approvalStep.createMany({
      data: ids.map((uid, i) => ({
        companyId,
        requestType,
        requestId,
        stepOrder: i + 1,
        approverUserId: uid,
        // custom은 순번 결재(전결 개념 없음) → isFinal=false. 최종 확정은 전원 승인(isChainComplete)으로 처리.
        isFinal: false,
      })),
    });
    return;
  }

  if (company.approvalMode !== "deptline") return;
  const approvers = await resolveApproverChain(companyId, applicantUserId, applicantDeptId, company.approvalStepCount);
  if (approvers.length === 0) return; // 결재자 없음 → 관리자 단일 승인
  await prisma.approvalStep.createMany({
    data: approvers.map((a, i) => ({
      companyId,
      requestType,
      requestId,
      stepOrder: i + 1,
      approverUserId: a.userId,
      isFinal: a.isFinal,
    })),
  });
}

// 결재 단계 진행 판정 결과.
//  · "approved"  = 체인 완료 → 원본을 승인 확정하라
//  · "rejected"  = 반려 → 원본을 반려 확정하라
//  · "advanced"  = 이번 단계만 승인, 다음 결재자 대기(원본은 pending 유지)
//  · "denied"    = 권한 없음/유효하지 않음(아무 것도 하지 말라)
export type AdvanceResult = "approved" | "rejected" | "advanced" | "denied";

// 한 신청에 대해 현재 사용자가 승인/반려를 시도한다. 회사격리·권한(현재 단계 결재자 또는 관리자)을 강제한다.
//  · comment: 결재자 결정 사유(선택). 이번에 처리하는 단계(들)에 저장한다. 미전달이면 기존과 동일(무영향).
export async function advanceApproval(
  me: Me,
  requestType: RequestType,
  requestId: string,
  action: "approve" | "reject",
  comment?: string,
): Promise<AdvanceResult> {
  const note = comment && comment.trim() ? comment.trim() : null;
  const steps = await prisma.approvalStep.findMany({
    where: { companyId: me.companyId, requestType, requestId },
    orderBy: { stepOrder: "asc" },
  });

  // 결재선 없음(단일 승인/폴백) → 관리자만.
  if (steps.length === 0) {
    if (me.role !== "admin") return "denied";
    return action === "approve" ? "approved" : "rejected";
  }

  // 이미 반려된 단계가 있으면 결과는 '반려'로 확정됨. 뒷 단계가 pending이어도(반려는 현재 단계만 마킹)
  // 결과는 바뀌지 않으므로, 부분 실패 후 재시도 시 원본을 반려 확정하도록 그대로 반환한다(멱등 복구).
  if (isChainRejected(steps)) return "rejected";

  const cur = nextPendingStep(steps);
  if (!cur) {
    // 대기 단계 없음 + 반려 없음 = 전 단계 승인(또는 건너뜀) 완료.
    // 부분 실패(원본 status 반영 실패)나 결재자 퇴사로 단계가 건너뛰어진 뒤,
    // 원본을 확정하려면 여기를 지나야 한다.
    //
    // 🔴 [후속 검수 치명 1] 반드시 권한을 먼저 본다.
    //    예전엔 이 자리에 권한 검사가 없어서, **회사의 아무 직원이나** 신청 id만 알면
    //    남의 휴가·근태정정을 자기 이름으로 최종 승인할 수 있었다.
    //    (근태정정은 승인되면 실제 출퇴근 기록을 덮어쓰므로 법정 기록 위조 경로가 된다)
    //    이 확정은 "관리자가 마무리 짓는" 복구 동작이므로 관리자만 허용한다.
    if (me.role !== "admin") return "denied";
    if (isChainComplete(steps)) return "approved";
    return "denied";
  }

  // 권한: 현재 단계 결재자 본인 또는 관리자(오버라이드).
  const canAct = me.role === "admin" || cur.approverUserId === me.id;
  if (!canAct) return "denied";

  const now = new Date();

  if (action === "reject") {
    await prisma.approvalStep.update({ where: { id: cur.id }, data: { status: "rejected", decidedAt: now, comment: note } });
    return "rejected";
  }

  // 관리자 오버라이드: 남은 대기 단계 전부 승인 → 즉시 완료(단일 원자 쓰기).
  //  · 관리자 사유는 호출 액션이 원본 decisionComment에 미러한다(신청자 표시의 원천). 단계 comment엔 별도 기록하지 않음
  //    — 타 부서장 소유 단계에 관리자 글을 귀속시키지 않고, 비원자적 2차 쓰기도 없앤다.
  if (me.role === "admin") {
    await prisma.approvalStep.updateMany({
      where: { companyId: me.companyId, requestType, requestId, status: "pending" },
      data: { status: "approved", decidedAt: now },
    });
    return "approved";
  }

  // 부서장: 현재 단계만 승인 → 완료 여부 판정.
  await prisma.approvalStep.update({ where: { id: cur.id }, data: { status: "approved", decidedAt: now, comment: note } });
  const updated = steps.map((s) => (s.id === cur.id ? { ...s, status: "approved" } : s));
  return isChainComplete(updated) ? "approved" : "advanced";
}

// ⚠️ 신청 취소 시 결재 단계만 따로 지우는 함수는 **일부러 없앴다**(검수 M-5).
//    결재 단계만 지워지고 원본 신청이 남으면, 결재 엔진이 "결재선을 안 쓰는 회사"로 보고
//    관리자 단독 승인을 허용해 **부서장 결재선이 통째로 사라진다**.
//    취소는 반드시 lib/request-cancel.ts의 cancelPendingRequest(원본+단계 한 트랜잭션)를 쓸 것.

// 결재함용 한 항목.
export type ApprovalInboxItem = {
  type: RequestType;
  requestId: string;
  applicantName: string;
  applicantNo: string | null;
  stepOrder: number;
  totalSteps: number;
  isFinal: boolean; // 내 현재 단계가 전결 종결 단계인지(전결권자) → 결재함에 "전결" 표시. 승인 시 바로 최종 확정.
  createdAt: Date;
  // 표시용 요약(휴가/근태정정)
  summary: string;
  detail: string;
};

// 로그인한 사용자가 "지금 결재할 차례"인 대기 항목만 모은다(앞 단계가 끝난 것).
//  · 조회 방식(P-1): 예전엔 대기 건마다 "형제 단계 1회 + 원본 1회"를 물어봐서 200건이면 400회가 넘었다.
//    이제 ①내 대기 단계 ②형제 단계 전부 ③유형별 원본 6종을 각각 **한 번씩** 물어본다(최대 8회 고정).
//    같은 파일 countMyPendingApprovals가 쓰던 방식 그대로다. 반환 내용·순서는 예전과 같다.
export async function listMyApprovals(me: Me): Promise<ApprovalInboxItem[]> {
  const mySteps = await prisma.approvalStep.findMany({
    where: { companyId: me.companyId, approverUserId: me.id, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  if (mySteps.length === 0) return [];

  // ① 형제 단계(같은 신청의 모든 단계)를 한 번에 — "지금 내 차례인가"를 메모리에서 판정한다.
  const reqIds = [...new Set(mySteps.map((s) => s.requestId))];
  const allSiblings = await prisma.approvalStep.findMany({
    where: { companyId: me.companyId, requestId: { in: reqIds } },
    orderBy: { stepOrder: "asc" },
  });
  const sibKey = (t: string, id: string) => `${t}:${id}`;
  const sibMap = new Map<string, typeof allSiblings>();
  for (const s of allSiblings) {
    const k = sibKey(s.requestType, s.requestId);
    const arr = sibMap.get(k) ?? [];
    arr.push(s);
    sibMap.set(k, arr);
  }

  // ② 내 차례인 단계만 남긴다(앞 단계가 아직 대기면 제외). 원본 조회 건수를 여기서 미리 줄인다.
  const myTurn = mySteps.filter((step) => {
    const cur = nextPendingStep(sibMap.get(sibKey(step.requestType, step.requestId)) ?? []);
    return !!cur && cur.id === step.id;
  });
  if (myTurn.length === 0) return [];

  // ③ 유형별 원본을 한 번에. 조건(회사격리 + status: pending)은 예전 건별 조회와 동일하다.
  //    ⚠️ 유형과 표를 **한 줄에 짝지어** 둔다(검수 중간 2). 예전처럼 "id 목록 배열"과 "조회 배열"을
  //       순서로만 맞추면, 나중에 한쪽 순서만 바뀌어도 타입 검사에 안 걸리고
  //       그 유형의 결재 건이 **오류 없이 결재함에서 통째로 사라진다**(조회가 빈 배열을 돌려주므로).
  //    ⚠️ 신청 유형을 새로 추가할 땐 **여기 loadFor 한 줄 + 아래 조립 분기를 반드시 함께** 추가할 것.
  //       컴파일러가 빠뜨림을 막아주지 않는다(requestType이 DB에서 문자열이라 완전성 검사가 안 걸린다).
  const idsOf = (t: RequestType) => myTurn.filter((s) => s.requestType === t).map((s) => s.requestId);
  const applicant = { user: { select: { name: true, employeeNo: true } } } as const;
  const pick = (ids: string[]) => ({ where: { id: { in: ids }, companyId: me.companyId, status: "pending" }, include: applicant });
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  // 유형과 조회할 표를 **한 줄에 함께** 적는다 — 둘을 따로 두면 순서만 어긋나도 타입 검사에 안 걸린다.
  const loadFor = async <R extends { id: string }>(t: RequestType, run: (ids: string[]) => Promise<R[]>) => {
    const ids = idsOf(t);
    return byId(ids.length ? await run(ids) : []);
  };
  const [leaveMap, corrMap, outingMap, remoteMap, overtimeMap, tripMap] = await Promise.all([
    loadFor("leave", (ids) => prisma.leaveRequest.findMany(pick(ids))),
    loadFor("correction", (ids) => prisma.attendanceCorrection.findMany(pick(ids))),
    loadFor("outing", (ids) => prisma.outingRequest.findMany(pick(ids))),
    loadFor("remote", (ids) => prisma.remoteWorkRequest.findMany(pick(ids))),
    loadFor("overtime", (ids) => prisma.overtimeRequest.findMany(pick(ids))),
    loadFor("trip", (ids) => prisma.businessTripRequest.findMany(pick(ids))),
  ]);

  // ④ 조립 — 표시 문구는 예전과 한 글자도 다르지 않게 유지한다.
  const items: ApprovalInboxItem[] = [];
  for (const step of myTurn) {
    const siblings = sibMap.get(sibKey(step.requestType, step.requestId)) ?? [];

    if (step.requestType === "leave") {
      const lv = leaveMap.get(step.requestId);
      if (!lv) continue; // 취소/처리됨
      const s = lv.startDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      const e = lv.endDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      items.push({
        type: "leave",
        requestId: lv.id,
        applicantName: lv.user.name,
        applicantNo: lv.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: lv.createdAt,
        summary: `휴가 신청 (${s === e ? s : `${s}~${e}`})`,
        detail: lv.reason ?? "",
      });
    } else if (step.requestType === "correction") {
      const c = corrMap.get(step.requestId);
      if (!c) continue;
      const d = c.targetDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      const parts = [c.requestedIn ? `출근 ${c.requestedIn}` : "", c.requestedOut ? `퇴근 ${c.requestedOut}` : ""].filter(Boolean).join(" · ");
      items.push({
        type: "correction",
        requestId: c.id,
        applicantName: c.user.name,
        applicantNo: c.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: c.createdAt,
        summary: `근태정정 (${d}) ${parts}`,
        detail: c.reason,
      });
    } else if (step.requestType === "outing") {
      const o = outingMap.get(step.requestId);
      if (!o) continue;
      const d = o.targetDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      const kindLabel = outingKindLabel(o.kind);
      items.push({
        type: "outing",
        requestId: o.id,
        applicantName: o.user.name,
        applicantNo: o.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: o.createdAt,
        summary: `${kindLabel} 신청 (${d} ${o.startTime}~${o.endTime})${o.place ? ` · ${o.place}` : ""}`,
        detail: o.reason ?? "",
      });
    } else if (step.requestType === "remote") {
      const rw = remoteMap.get(step.requestId);
      if (!rw) continue;
      items.push({
        type: "remote",
        requestId: rw.id,
        applicantName: rw.user.name,
        applicantNo: rw.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: rw.createdAt,
        summary: `재택근무 신청 (${remoteRangeLabel(rw.startDate, rw.endDate)})`,
        detail: rw.reason ?? "",
      });
    } else if (step.requestType === "overtime") {
      const ot = overtimeMap.get(step.requestId);
      if (!ot) continue;
      const d = ot.targetDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      items.push({
        type: "overtime",
        requestId: ot.id,
        applicantName: ot.user.name,
        applicantNo: ot.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: ot.createdAt,
        summary: `초과근무 신청 (${d} ${overtimeTimeLabel(ot.startTime, ot.endTime)})`,
        detail: ot.reason ?? "",
      });
    } else if (step.requestType === "trip") {
      const tp = tripMap.get(step.requestId);
      if (!tp) continue;
      items.push({
        type: "trip",
        requestId: tp.id,
        applicantName: tp.user.name,
        applicantNo: tp.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: tp.createdAt,
        summary: `출장 신청 (${tripRangeLabel(tp.startDate, tp.endDate)}) · ${tp.destination}`,
        detail: tp.reason ?? "",
      });
    }
  }
  return items;
}

// 결재 라인 구성원인지(사이드바 [결재함] 메뉴 표시용). 실제 결재자 산정(buildApprovalChain:
// 재직 부서장 → 없으면 재직 대결자)과 일치시킨다 → 부서장(headUserId)이거나,
// **부서장이 없거나 퇴사한 부서의** 대결자(deputyUserId)면 true. 전결권자도 부서장이라 포함(9-A).
//  · 부서장이 재직 중이면 대결자는 실제 결재를 받지 못하므로(빈 결재함 방지) 제외.
//  · 회사격리 필수. React cache() → 한 요청 내 실제 조회 1회.
export const isApprovalLineMember = cache(async (companyId: string, userId: string): Promise<boolean> => {
  const asHead = await prisma.department.count({ where: { companyId, headUserId: userId } });
  if (asHead > 0) return true; // 본인이 부서장(로그인한 본인 = 재직)

  // 대결자인 부서들: 부서장 칸이 비었거나, 적힌 부서장이 퇴사자면 이 사람이 실제 결재자다.
  const deputyDepts = await prisma.department.findMany({
    where: { companyId, deputyUserId: userId },
    select: { headUserId: true },
  });
  if (deputyDepts.length === 0) return false;
  if (deputyDepts.some((d) => !d.headUserId)) return true;
  const headIds = [...new Set(deputyDepts.map((d) => d.headUserId).filter((v): v is string => !!v))];
  const aliveHeads = await prisma.user.findMany({
    where: { id: { in: headIds }, companyId, deactivatedAt: null },
    select: { id: true },
  });
  const aliveSet = new Set(aliveHeads.map((u) => u.id));
  return deputyDepts.some((d) => d.headUserId && !aliveSet.has(d.headUserId));
});

// 내가 지금 결재할 차례인 대기 건수(사이드바 배지·알림용). 배지용이라 원본 레코드·user join 없이
// 단계만으로 경량 집계(건수 K와 무관하게 최대 ~4쿼리). 결재자 아니면 첫 쿼리 빈 결과로 즉시 0.
// React cache() → 한 요청 내(사이드바가 여러 번 읽어도) 실제 집계 1회.
export const countMyPendingApprovals = cache(async (companyId: string, userId: string): Promise<number> => {
  const mySteps = await prisma.approvalStep.findMany({
    where: { companyId, approverUserId: userId, status: "pending" },
    select: { requestType: true, requestId: true, stepOrder: true },
  });
  if (mySteps.length === 0) return 0;

  const reqIds = [...new Set(mySteps.map((s) => s.requestId))];
  const siblings = await prisma.approvalStep.findMany({
    where: { companyId, requestId: { in: reqIds } },
    select: { requestType: true, requestId: true, stepOrder: true, status: true, approverUserId: true },
  });
  // 원본이 아직 pending인 신청만(반려·완료된 건 제외). 타입별 id 분리.
  const leaveIds = mySteps.filter((s) => s.requestType === "leave").map((s) => s.requestId);
  const corrIds = mySteps.filter((s) => s.requestType === "correction").map((s) => s.requestId);
  const outingIds = mySteps.filter((s) => s.requestType === "outing").map((s) => s.requestId);
  const remoteIds = mySteps.filter((s) => s.requestType === "remote").map((s) => s.requestId);
  const overtimeIds = mySteps.filter((s) => s.requestType === "overtime").map((s) => s.requestId);
  const tripIds = mySteps.filter((s) => s.requestType === "trip").map((s) => s.requestId);
  const [pendLeaves, pendCorrs, pendOutings, pendRemotes, pendOvertimes, pendTrips] = await Promise.all([
    leaveIds.length ? prisma.leaveRequest.findMany({ where: { id: { in: leaveIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    corrIds.length ? prisma.attendanceCorrection.findMany({ where: { id: { in: corrIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    outingIds.length ? prisma.outingRequest.findMany({ where: { id: { in: outingIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    remoteIds.length ? prisma.remoteWorkRequest.findMany({ where: { id: { in: remoteIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    overtimeIds.length ? prisma.overtimeRequest.findMany({ where: { id: { in: overtimeIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    tripIds.length ? prisma.businessTripRequest.findMany({ where: { id: { in: tripIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const pendingReqIds = new Set([...pendLeaves.map((x) => x.id), ...pendCorrs.map((x) => x.id), ...pendOutings.map((x) => x.id), ...pendRemotes.map((x) => x.id), ...pendOvertimes.map((x) => x.id), ...pendTrips.map((x) => x.id)]);

  let n = 0;
  for (const my of mySteps) {
    if (!pendingReqIds.has(my.requestId)) continue;
    const sib = siblings.filter((s) => s.requestType === my.requestType && s.requestId === my.requestId);
    const cur = nextPendingStep(sib);
    if (cur && cur.stepOrder === my.stepOrder && cur.approverUserId === userId) n++;
  }
  return n;
});

// 신청들의 결재 진행상황(진행표시용). requestId → {단계수·승인수·다음 결재자·반려 여부·다음이 전결권자인지}.
export type ApprovalProgress = {
  total: number;
  approvedCount: number; // 승인 + 건너뜀(=처리가 끝난 단계 수)
  skippedCount: number; // 그중 건너뛴 단계(결재자 퇴사 등)
  needsAdminFinalize: boolean; // 결재선은 끝났는데 원본이 아직 대기 → 관리자가 확정만 하면 됨
  nextApproverName: string | null;
  rejected: boolean;
  nextIsFinal: boolean;
};

// 결재 진행상황을 관리자 화면에 보여줄 한 줄 문구로 만든다.
// 6개 승인 화면(휴가·정정·외출·초과근무·재택·출장)이 같은 문구를 쓰도록 여기 하나로 모았다.
//  (예전엔 같은 문장이 6곳에 복붙돼 있어, 한 곳만 고치면 화면마다 다른 말을 하게 됐다)
// 관리자가 **자기 신청**을 보고 있고 부서장 결재가 아직 진행 중이면, 승인을 눌러도 통과되지 않는다(M-11).
// 그 이유를 화면에 미리 알려주는 문구 — 안 그러면 "눌러도 아무 반응이 없는 버튼"이 된다(검수 치명).
//  · 결재선이 없거나(관리자 단독 승인) 이미 끝난 상태(관리자 확정만 남음)면 승인할 수 있으므로 문구 없음.
export function selfApprovalNotice(p: ApprovalProgress | undefined, isMine: boolean): string | undefined {
  if (!isMine || !p) return undefined;
  if (p.rejected || p.needsAdminFinalize) return undefined; // 확정·마무리 가능한 상태
  return "본인 신청이라 부서장 결재가 끝나야 확정할 수 있습니다(승인 눌러도 통과되지 않음)";
}

export function approvalProgressLabel(p: ApprovalProgress | undefined): string | undefined {
  if (!p) return undefined;
  if (p.rejected) return "부서장 반려됨";
  // 결재자가 퇴사해 단계가 건너뛰어졌고, 남은 결재자가 없는 상태 → 관리자가 확정만 하면 된다.
  if (p.needsAdminFinalize) {
    return p.skippedCount > 0
      ? `결재자 퇴사로 건너뜀 (${p.approvedCount}/${p.total}) · 관리자 확정 필요`
      : `부서장 결재 완료 (${p.approvedCount}/${p.total}) · 관리자 확정 필요`;
  }
  const skipped = p.skippedCount > 0 ? ` · 퇴사로 건너뜀 ${p.skippedCount}건` : "";
  return `부서장 결재 ${p.approvedCount}/${p.total}${p.nextApproverName ? ` · 다음 ${p.nextApproverName}` : ""}${skipped}`;
}

export async function getApprovalProgressMap(
  companyId: string,
  requestType: RequestType,
  requestIds: string[],
): Promise<Map<string, ApprovalProgress>> {
  const map = new Map<string, ApprovalProgress>();
  if (requestIds.length === 0) return map;

  const steps = await prisma.approvalStep.findMany({
    where: { companyId, requestType, requestId: { in: requestIds } },
    orderBy: { stepOrder: "asc" },
    select: { requestId: true, stepOrder: true, status: true, approverUserId: true, isFinal: true },
  });
  if (steps.length === 0) return map;

  // 다음 결재자 이름 해석(한 번에)
  const names = await prisma.user.findMany({
    where: { companyId, id: { in: [...new Set(steps.map((s) => s.approverUserId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((u) => [u.id, u.name]));

  const byReq = new Map<string, typeof steps>();
  for (const s of steps) {
    const arr = byReq.get(s.requestId) ?? [];
    arr.push(s);
    byReq.set(s.requestId, arr);
  }
  for (const [rid, ss] of byReq) {
    const next = ss.find((s) => s.status === "pending");
    // 🔴 [후속 검수 치명 2] 건너뛴 단계(결재자 퇴사 등)도 "처리 끝난 단계"로 센다.
    //    안 그러면 결재자가 퇴사해 단계가 건너뛰어졌는데도 화면에 "부서장 결재 1/2 · 다음 —"으로 떠서
    //    관리자가 "아직 누가 결재 중"으로 오해하고 확정을 미룬다(= 결재가 조용히 멈춘 것과 같아진다).
    const skippedCount = ss.filter((s) => s.status === "skipped").length;
    map.set(rid, {
      total: ss.length,
      approvedCount: ss.filter((s) => s.status === "approved").length + skippedCount,
      skippedCount,
      // 대기 단계가 없는데 반려도 아니면 = 결재선은 끝났고 관리자가 확정만 하면 되는 상태
      needsAdminFinalize: !next && !ss.some((s) => s.status === "rejected"),
      nextApproverName: next ? (nameOf.get(next.approverUserId) ?? null) : null,
      rejected: ss.some((s) => s.status === "rejected"),
      nextIsFinal: next ? next.isFinal === true : false, // 다음 결재자가 전결권자면 그 승인이 최종
    });
  }
  return map;
}

/**
 * 🔴 "자기 신청을 자기가 승인"을 막는다.
 *
 * 왜 지금 필요한가 (2026-07-27 가입 개편)
 *  · 예전에는 관리자가 회사에 사실상 1명뿐이라 관리자가 신청자가 되는 일이 거의 없었다.
 *    이제 관리자를 여러 명 둘 수 있고 관리자도 근로자로 집계되므로, **관리자가 자기 휴가를
 *    자기가 승인 확정**하는 경로가 실사용 경로가 됐다. 근로시간 기록의 신뢰성이 제품의 차별점이라 막는다.
 *  · 단, **다른 관리자가 아무도 없으면 허용한다.** 안 그러면 관리자 1명인 회사에서 그 사람의 휴가를
 *    영원히 승인할 수 없다(막는 것이 오히려 업무를 멈춘다).
 *
 * 🔴 [검수 M-11] 결재선이 진행 중이면 관리자라도 자기 신청을 스스로 통과시킬 수 없다.
 *  · 예전엔 "다른 관리자 수"만 봤다. 그래서 **관리자가 1명인 회사**에서는 부서장 결재선을 켜 놓아도
 *    그 관리자가 자기 휴가를 신청한 뒤 곧바로 스스로 최종 승인할 수 있었다
 *    (관리자 오버라이드가 남은 부서장 단계를 전부 승인 처리한다) → 결재선이 통째로 무의미해진다.
 *  · 그래서 **내 신청에 아직 처리되지 않은(pending) 결재 단계가 남아 있으면 무조건 막는다.**
 *  · 막다른 길이 아닌 이유: 부서장들이 결재를 마치면 그 마지막 승인으로 원본이 자동 확정된다.
 *    결재자 퇴사 등으로 단계가 건너뛰어져 "관리자 확정만 남은" 상태가 되면 pending이 0이므로
 *    아래 기존 규칙으로 내려가고, 관리자가 나뿐이면 확정할 수 있다.
 *
 * ⚠️ **반려(reject)에는 일부러 이 가드를 걸지 않는다.** 결재가 멈췄을 때(결재자 부재 등)
 *    관리자가 자기 신청을 스스로 종료시킬 수 있는 유일한 탈출구이기 때문이다.
 *    여기에 가드를 추가하면 관리자 1명 회사에서 승인도 반려도 못 하는 진짜 막다른 길이 생긴다.
 *
 * @param ctx 신청을 특정할 수 있으면 넘긴다(승인 경로 6곳). 없으면 결재선 검사 없이 기존 규칙만 적용
 *            — 승인 **취소**나 화면 버튼 노출 판단처럼 "진행 중인 결재선"이 없는 자리에서 쓴다.
 * @returns true면 이 승인을 막아야 한다.
 */
export async function isSelfApprovalBlocked(
  me: { id: string; companyId: string },
  requesterId: string,
  ctx?: { requestType: RequestType; requestId: string },
): Promise<boolean> {
  if (requesterId !== me.id) return false;

  if (ctx) {
    const pending = await prisma.approvalStep.count({
      where: { companyId: me.companyId, requestType: ctx.requestType, requestId: ctx.requestId, status: "pending" },
    });
    if (pending > 0) return true; // 부서장이 아직 결재 중 → 관리자라도 자기 건을 통과시킬 수 없다
  }

  const otherAdmins = await prisma.user.count({
    where: { companyId: me.companyId, role: "admin", isOwner: false, deactivatedAt: null, id: { not: me.id } },
  });
  return otherAdmins > 0;
}
