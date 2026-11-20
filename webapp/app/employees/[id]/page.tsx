// 직원 상세/수정 — 관리자 전용. 개별 직원 정보 확인 + 이름 수정 + 근태 상세로 이동. (리뉴얼 디자인)
// ※ 회사 격리: 내 회사 소속 직원만 조회(notFound).
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { EditEmployeeForm } from "./EditEmployeeForm";
import { WorkDaysForm } from "./WorkDaysForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { EmployeeStatusActions } from "./EmployeeStatusActions";
import { AnnualLeaveForm } from "./AnnualLeaveForm";
import { DepartmentAssignForm } from "./DepartmentAssignForm";
import { ProfileForm } from "./ProfileForm";
import { parseDays, effectiveWorkDays, daysLabel } from "@/lib/workdays";
import { leaveBalanceInYear, grantedAnnualLeave } from "@/lib/leave";
import { openSessionSince } from "@/lib/worktime";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// input type=date 용 "YYYY-MM-DD"(로컬 기준). null이면 빈 문자열.
function ymdInput(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const { id } = await params;
  const emp = await prisma.user.findFirst({
    where: { id, companyId: me.companyId },
    include: { department: { select: { name: true } }, jobGrade: { select: { name: true } } },
  });
  if (!emp) notFound();
  // 🔒 회사 계정 상세는 열지 않는다 — 이 화면에 [비밀번호 재설정]·[퇴사 처리]가 있어
  //    다른 관리자가 회사 열쇠를 빼앗는 통로가 된다(검수 치명 1). 서버 액션도 각각 막아 두었다.
  if (emp.isOwner) notFound();

  // 회사 부서 목록(배정 드롭다운용)
  const departments = await prisma.department.findMany({
    where: { companyId: me.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // 회사 직급 사다리(직급 드롭다운용). 상급이 위로 오게 서열 내림차순.
  const jobGrades = await prisma.jobGrade.findMany({
    where: { companyId: me.companyId },
    orderBy: { level: "desc" },
    select: { id: true, name: true },
  });

  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true } });
  const companyDaysLabel = daysLabel(parseDays(company?.workDays));
  const effectiveLabel = daysLabel(effectiveWorkDays(emp.workDays, company?.workDays));

  // 이 직원의 올해 연차 현황 — lib/leave.ts 단일 출처 함수 사용(화면 간 숫자 불일치 방지, 검수 C-2).
  const empLeaves = await prisma.leaveRequest.findMany({
    where: { userId: emp.id, companyId: me.companyId },
    select: { type: true, days: true, status: true, startDate: true },
  });
  const leaveBalance = leaveBalanceInYear(emp, empLeaves, new Date().getFullYear());
  const leaveUsed = leaveBalance.used;
  const leavePending = leaveBalance.pending;
  const leaveAutoDays = grantedAnnualLeave(emp.hireDate); // 입사일 기준 자동 발생값
  const leaveGranted = leaveBalance.granted; // 적용값(override 우선)
  const leaveRemaining = leaveBalance.remaining;

  const authLabel = emp.authMethod === "face" ? "얼굴인증" : emp.authMethod === "gps" ? "GPS(위치)" : "미설정";
  const consented = !!emp.faceConsentAt;
  const active = !emp.deactivatedAt;

  // 🔴 [검수 M-6] 퇴근을 안 찍은 기록이 남은 채로 퇴사시키면, 본인은 로그인할 수 없어
  //    그 기록의 퇴근 시각을 더 이상 채울 수 없다(정정 신청은 본인만 가능).
  //    ⚠️ 서버가 퇴근 시각을 지어내지 않는다 — 법정 3년 보존 기록에 가짜 시각이 남기 때문이다
  //       (actions/attendance.ts의 기존 규칙과 동일). 대신 **퇴사시키기 전에 관리자에게 알린다.**
  //    ⚠️ 열린 기록을 **두 종류로 나눈다**(2차 검수 치명 1). 하나로 뭉치면 둘 중 하나가 반드시 망가진다:
  //       ① 오래된 미퇴근(`clockIn < openSessionSince()`) — 퇴근을 못 찍고 넘어간 것. 정정이 필요하다.
  //       ② 지금 출근 상태(`clockIn >= openSessionSince()`) — 근무 중. 이걸 ①로 세면 퇴사 처리 때마다
  //          오경보가 되지만, 아예 안 세면 **가장 사고가 잦은 경우**(출근해 있는 사람을 그날 퇴사시킴)를
  //          놓친다. 그 순간 세션이 삭제돼 본인은 오늘 퇴근을 영영 못 찍는다. 그래서 문구를 달리해 알린다.
  //       두 종류의 경계는 lib/worktime.ts openSessionSince() 한 곳에서 정한다.
  //    · 퇴사자에게도 보여준다 — 이미 퇴사시킨 뒤라면 복직시켜야만 고칠 수 있어서, 그 방법을 알려야 한다(검수 중간 3).
  const openBase = { userId: emp.id, companyId: me.companyId, clockOut: null } as const;
  const sessionSince = openSessionSince();
  const [staleOpen, staleCount, workingNowCount] = await Promise.all([
    prisma.attendance.findMany({
      where: { ...openBase, clockIn: { lt: sessionSince } },
      orderBy: { clockIn: "asc" }, // 오래된 것부터 — 가장 문제인 기록이 "외"에 숨지 않게(검수 경미 12)
      take: 4,
      select: { clockIn: true },
    }),
    prisma.attendance.count({ where: { ...openBase, clockIn: { lt: sessionSince } } }),
    prisma.attendance.count({ where: { ...openBase, clockIn: { gte: sessionSince } } }),
  ]);
  const openAttendanceDates = staleOpen.map((a) =>
    a.clockIn.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
  );
  // 퇴사자에게는 둘을 나눌 의미가 없다(근무 중일 수 없다) — 남은 열린 기록을 모두 합쳐 보여준다.
  const openAttendanceCount = active ? staleCount : staleCount + workingNowCount;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "이메일", value: emp.email },
    { label: "전화번호", value: <span style={{ color: emp.phone ? "var(--text)" : "#9CA3AF" }}>{emp.phone ?? "미입력"}</span> },
    { label: "부서", value: <span style={{ color: emp.department ? "var(--text)" : "#9CA3AF" }}>{emp.department?.name ?? "미배정"}</span> },
    { label: "직급", value: <span style={{ color: emp.jobGrade ? "var(--text)" : "#9CA3AF" }}>{emp.jobGrade?.name ?? "미지정"}</span> },
    { label: "사번", value: <span style={{ color: emp.employeeNo ? "var(--text)" : "#9CA3AF" }}>{emp.employeeNo ?? "미입력"}</span> },
    { label: "역할", value: emp.role === "admin" ? "관리자" : "직원" },
    {
      label: "상태",
      value: active
        ? <span style={{ color: "#15803D", fontWeight: 700 }}>재직중</span>
        : <span style={{ color: "#6B7280", fontWeight: 700 }}>퇴사 {emp.deactivatedAt ? `(${ymd(emp.deactivatedAt)})` : ""}</span>,
    },
    { label: "인증방식", value: <span style={{ color: emp.authMethod ? "var(--text)" : "#9CA3AF" }}>{authLabel}</span> },
    {
      label: "생체정보 동의",
      value: consented
        ? <span style={{ color: "#15803D", fontWeight: 700 }}>동의함 {emp.faceConsentAt ? `(${ymd(emp.faceConsentAt)})` : ""}</span>
        : <span style={{ color: "#9CA3AF" }}>동의 안 함</span>,
    },
    { label: "근무요일", value: <span>{effectiveLabel}<span style={{ color: "var(--text-sub)", fontWeight: 400 }}>{emp.workDays ? " (직접 지정)" : " (회사 기본)"}</span></span> },
    { label: "입사일", value: <span style={{ color: emp.hireDate ? "var(--text)" : "#9CA3AF" }}>{emp.hireDate ? ymd(emp.hireDate) : "미입력"}</span> },
    { label: "가입일", value: ymd(emp.createdAt) },
  ];

  const backBtn = (
    <Link href="/employees" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 직원 관리
    </Link>
  );

  return (
    <AppShell user={me} active="employees" helpKey="employee-detail" title={`${emp.name} 님`} subtitle={me.company.name} right={backBtn}>
      {/* PC=2단(정보 | 관리 폼), 좁은 화면=세로 */}
      <div className="split-2">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 정보 카드 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
            {emp.name.slice(0, 1)}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{emp.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r, i) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid #F3F4F6", gap: 16 }}>
              <span style={{ fontSize: 14, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontSize: 15, textAlign: "right" }}>{r.value}</span>
            </div>
          ))}
        </div>

        <Link
          href={`/records/${emp.id}`}
          style={{ display: "inline-flex", marginTop: 18, height: 42, padding: "0 18px", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--primary)", background: "#fff", color: "var(--primary)", fontSize: 14, fontWeight: 700, textDecoration: "none" }}
        >
          이 직원 근태 상세 보기 →
        </Link>
      </div>

      {/* 수정 카드 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>정보 수정</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          이름을 수정할 수 있습니다. 인증방식·생체정보 동의는 직원 본인이 [인증방식] 화면에서 직접 정합니다.
        </p>
        <EditEmployeeForm id={emp.id} initialName={emp.name} />
      </div>

      {/* 인적정보 수정 (전화번호·직급·사번·입사일) */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>인적정보</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          전화번호·직급·사번·입사일입니다. 모두 <b>선택 항목</b>이라 비워 둬도 되고, 빈 칸으로 저장하면 지워집니다.
        </p>
        <ProfileForm
          id={emp.id}
          initialPhone={emp.phone ?? ""}
          initialEmployeeNo={emp.employeeNo ?? ""}
          initialHireDate={ymdInput(emp.hireDate)}
          grades={jobGrades}
          initialJobGradeId={emp.jobGradeId ?? ""}
        />
      </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 부서 배정 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>부서</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          이 직원의 소속 부서입니다. 부서는 <b>직원 관리</b> 화면에서 먼저 만들어야 목록에 나옵니다.
        </p>
        <DepartmentAssignForm id={emp.id} initialDepartmentId={emp.departmentId} departments={departments} />
      </div>

      {/* 근무요일 (회사 기본 따름 or 직접 지정) */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>근무요일</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          이 직원이 일하는 요일입니다. 회사 기본과 같으면 그대로 두고, 다르면 직접 지정하세요. 선택한 요일에만 지각·결근을 판정합니다.
        </p>
        <WorkDaysForm id={emp.id} initialDays={emp.workDays} companyDaysLabel={companyDaysLabel} />
      </div>

      {/* 연차 부여 / 잔여 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>연차</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          발생 <b>{leaveGranted}일</b> · 사용 <b>{leaveUsed}일</b>
          {leavePending > 0 && <> · 결재 대기 <b style={{ color: "var(--warning)" }}>{leavePending}일</b></>}
          {" · "}잔여 <b style={{ color: leaveRemaining < 0 ? "var(--danger)" : "var(--primary)" }}>{leaveRemaining}일</b>. (올해 기준. 입사일 기준으로 자동 발생하며, 신청·승인한 연차·반차가 사용에 반영됩니다. 결재 대기 중인 연차도 미리 잔여에서 빼둡니다.)
        </p>
        <AnnualLeaveForm id={emp.id} autoDays={leaveAutoDays} override={emp.annualLeaveOverride} hasHireDate={!!emp.hireDate} />
      </div>

      {/* 비밀번호 재설정 (재직중 + **본인이 아닐 때만**)
          ⚠️ 본인을 제외하는 이유: 발급하면 그 계정의 세션이 전부 삭제된다. 자기 자신에게 누르면
             새 비밀번호를 화면에서 보기도 전에 로그아웃돼 계정이 잠긴다(검수 치명 1).
             서버(resetEmployeePassword)도 같은 검사를 한다 — 화면은 방어가 아니라 안내다. */}
      {active && emp.id !== me.id && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>비밀번호 재설정</div>
          <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
            직원이 비밀번호를 잊었을 때 새 임시 비밀번호를 정해 알려주세요. 재설정하면 직원의 기존 로그인은 풀리고, 새 비밀번호로 다시 로그인합니다.
          </p>
          <ResetPasswordForm id={emp.id} />
        </div>
      )}

      {/* 퇴사 처리 / 복직 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{active ? "퇴사 처리" : "복직"}</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          {active
            ? "퇴사 처리하면 이 직원은 로그인할 수 없고 직원 목록에서 내려갑니다. 과거 근태 기록은 리포트에 그대로 보존되며, 나중에 복직할 수 있습니다."
            : "이 직원은 현재 퇴사(비활성화) 상태입니다. 복직시키면 다시 로그인할 수 있습니다."}
        </p>
        <EmployeeStatusActions
          id={emp.id}
          name={emp.name}
          active={active}
          openAttendanceCount={openAttendanceCount}
          openAttendanceDates={openAttendanceDates}
          workingNow={active && workingNowCount > 0}
          hasBiometric={emp.authMethod === "face" || !!emp.faceConsentAt || !!emp.faceEnrolledAt}
          faceLeft={!active && !!emp.faceEnrolledAt}
        />
      </div>
      </div>
      </div>
    </AppShell>
  );
}
