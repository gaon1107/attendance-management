// 직원 관리 (관리자 전용) — 직원 목록(+통합검색) + 직원 추가. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { FoldSection } from "@/app/components/FoldSection";
import { AddEmployeeForm } from "./AddEmployeeForm";
import { InviteLink } from "./InviteLink";
import { PendingResetRequests } from "./PendingResetRequests";
import { DepartmentManager } from "./DepartmentManager";
import { JobGradeManager, type GradeRow } from "./JobGradeManager";
import { EmployeeList, type EmpRow, type RetiredRow } from "./EmployeeList";
import { cancelInvite } from "@/app/actions/invites";
import { InviteButton } from "./InviteButton";
import { companySmsReady } from "@/lib/company-sms-account";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function EmployeesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 목록에는 **관리자도 함께** 나온다(2026-07-27) — 여기서 관리자를 지정·해제하기 때문.
  //  · 사람이 아닌 회사 계정(isOwner)만 제외한다.
  const allEmployees = await prisma.user.findMany({
    where: { companyId: me.companyId, isOwner: false },
    orderBy: { createdAt: "asc" },
    include: { department: { select: { name: true } } },
  });
  // 재직중(퇴사 안 한) / 퇴사(비활성화) 분리
  const employees = allEmployees.filter((e) => !e.deactivatedAt);
  const retired = allEmployees.filter((e) => e.deactivatedAt);

  // 부서 목록 + 부서별 재직 인원 수(부서 관리 섹션용)
  const departments = await prisma.department.findMany({
    where: { companyId: me.companyId },
    orderBy: { name: "asc" },
  });
  const deptData = departments.map((d) => ({
    id: d.id,
    name: d.name,
    memberCount: employees.filter((e) => e.departmentId === d.id).length,
    headUserId: d.headUserId,
    parentId: d.parentId,
    deputyUserId: d.deputyUserId,
    finalApproval: d.finalApproval,
  }));

  // 직급 사다리 + 직급별 재직 인원 수(직급 관리 섹션용). 서열 오름차순(하급→상급).
  const jobGrades = await prisma.jobGrade.findMany({
    where: { companyId: me.companyId },
    orderBy: { level: "asc" },
  });
  const gradeData: GradeRow[] = jobGrades.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: employees.filter((e) => e.jobGradeId === g.id).length,
  }));

  // 회사 결재방식(결재선 설정용). 없으면 기본 single.
  const approvalCompany = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { approvalMode: true, approvalStepCount: true },
  });
  // 결재자 후보(부서장·대결자) = 재직 직원 목록.
  const empOptions = employees.map((e) => ({ id: e.id, name: e.name, employeeNo: e.employeeNo }));

  // 아직 안 쓴(미만료) 초대 링크
  const invites = await prisma.invite.findMany({
    where: { companyId: me.companyId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  // 문자로 이미 보낸 초대(중복발송 방지 표시). 성공 = "발송됨", 결과 미확인 = 다시 보낼 수 없으니 따로 알린다
  //  (예전엔 성공만 세서, 결과 미확인 초대에 버튼이 다시 보이고 눌러도 계속 거부됐다 — 2단계 검수 M-2).
  const sentInviteLogs = await prisma.smsLog.findMany({
    where: { companyId: me.companyId, kind: "invite", result: { in: ["success", "unknown"] }, refId: { in: invites.map((i) => i.id) } },
    select: { refId: true, result: true },
  });
  const sentInviteIds = new Set(sentInviteLogs.filter((s) => s.result === "success").map((s) => s.refId).filter((x): x is string => !!x));
  const unknownInviteIds = new Set(sentInviteLogs.filter((s) => s.result === "unknown").map((s) => s.refId).filter((x): x is string => !!x));
  // 이 회사가 비즈모아샷 계정을 연결했는가 — 초대·임시비번 [문자로 보내기]를 보여 줄지(서버 액션과 같은 판정).
  const smsReady = await companySmsReady(me.companyId);

  // 비밀번호 재설정 대기 요청(직원이 접수한 것) — 관리자가 임시 비밀번호를 발급한다.
  const resetRequests = await prisma.passwordResetRequest.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const resetReqData = resetRequests.map((r) => ({
    id: r.id,
    name: r.user.name,
    email: r.user.email,
    createdAtLabel: r.createdAt.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }));

  // 실제 데이터로만 집계 (재직중 기준)
  const faceCount = employees.filter((e) => e.authMethod === "face").length;
  const gpsCount = employees.filter((e) => e.authMethod === "gps").length;
  const unsetCount = employees.filter((e) => e.authMethod !== "face" && e.authMethod !== "gps").length;

  const kpis = [
    { label: "재직 직원", value: `${employees.length}`, unit: "명", color: "var(--text)" },
    { label: "얼굴인증 사용", value: `${faceCount}`, unit: "명", color: "var(--text)" },
    { label: "GPS 사용", value: `${gpsCount}`, unit: "명", color: "var(--text)" },
    { label: "인증 미설정", value: `${unsetCount}`, unit: "명", color: unsetCount > 0 ? "var(--warning)" : "var(--text)" },
  ];

  // 목록(재직/퇴사)을 검색 가능한 직렬화 행으로 변환
  const activeRows: EmpRow[] = employees.map((emp) => {
    const authLabel = emp.authMethod === "face" ? "얼굴인증" : emp.authMethod === "gps" ? "GPS" : "미설정";
    const dept = emp.department?.name ?? "미배정";
    const isAdmin = emp.role === "admin";
    return {
      id: emp.id, name: emp.name, employeeNo: emp.employeeNo, initial: emp.name.slice(0, 1), dept, deptSet: !!emp.department,
      email: emp.email, authLabel, hasAuth: !!emp.authMethod, consented: !!emp.faceConsentAt,
      joinLabel: ymd(emp.createdAt), isAdmin, isMe: emp.id === me.id,
      // 검색어에 "관리자"를 넣어 두면 관리자만 골라 보기가 쉬워진다.
      search: [emp.name, emp.employeeNo ?? "", emp.email, dept, authLabel, isAdmin ? "관리자" : "직원"].join(" ").toLowerCase(),
    };
  });
  const retiredRows: RetiredRow[] = retired.map((emp) => ({
    id: emp.id, name: emp.name, employeeNo: emp.employeeNo, initial: emp.name.slice(0, 1), email: emp.email,
    retireLabel: emp.deactivatedAt ? ymd(emp.deactivatedAt) : "—",
    search: [emp.name, emp.employeeNo ?? "", emp.email].join(" ").toLowerCase(),
  }));

  return (
    <AppShell user={me} active="employees" title="직원 관리" subtitle={`${me.company.name} · 재직 ${employees.length}명`}>
      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 비밀번호 재설정 대기 요청 (있을 때만 표시) */}
      <PendingResetRequests requests={resetReqData} smsReady={smsReady} />


      {/* 직원 목록(재직/퇴사) + 통합검색 — 2026-08-23 디자인 검토로 **맨 위로 올렸다.**
          매일 보는 것이 이건데 그전에는 부서·직급·초대·등록 네 묶음에 밀려 1,500px 아래에 있었다. */}
      <EmployeeList active={activeRows} retired={retiredRows} />

      {/* 회사 세팅 묶음 — 처음 한 번 정하고 거의 안 건드리는 것들이라 접어 둔다.
          ⚠️ 두 경우에는 **펼친 채로** 시작한다. 접혀 있으면 사용자가 할 일을 못 찾거나 결과를 못 본다:
             · 아직 부서가 하나도 없는 회사 → 여기서 부서를 만들어야 한다(처음 세팅).
             · 살아 있는 초대 링크가 있는 회사 → 방금 만든 링크를 복사해 보내야 한다. */}
      <FoldSection
        title="부서·직급·직원 추가"
        hint="부서 · 직급 · 초대 링크 · 직접 등록"
        defaultOpen={deptData.length === 0 || invites.length > 0}
      >
        {/* 부서 관리 */}
        <DepartmentManager
          departments={deptData}
          employees={empOptions}
          approvalMode={approvalCompany?.approvalMode ?? "single"}
          approvalStepCount={approvalCompany?.approvalStepCount ?? 1}
        />

        {/* 직급 관리 */}
        <JobGradeManager grades={gradeData} />

        {/* 직원 초대 (링크 방식 — 직원이 스스로 가입) */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>직원 초대</div>
          <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
            초대 링크를 만들어 직원에게 보내면(카톡·문자 등), 직원이 링크로 <b>직접 가입</b>합니다. 비밀번호는 직원 본인이 정합니다. (링크는 7일간, 1회만 사용 가능)
          </p>
          {/* 2026-11-23 결제 4단계: 요금 구간이 오르면 새 금액 동의 창을 띄운다(InviteButton → SeatConsent). */}
          <InviteButton />

          {invites.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              {invites.map((inv) => (
                <div key={inv.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>
                      만료 {inv.expiresAt.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}까지
                    </span>
                    <form action={cancelInvite}>
                      <input type="hidden" name="id" value={inv.id} />
                      <button type="submit" style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                        취소
                      </button>
                    </form>
                  </div>
                  <InviteLink path={`/invite/${inv.token}`} inviteId={inv.id} smsSent={sentInviteIds.has(inv.id)} smsUnknown={unknownInviteIds.has(inv.id)} smsReady={smsReady} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 직원 직접 등록 (관리자가 계정을 바로 만들 때) */}
        <AddEmployeeForm />
      </FoldSection>
    </AppShell>
  );
}
