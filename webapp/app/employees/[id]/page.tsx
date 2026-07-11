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
import { usedLeaveDays } from "@/lib/leave";

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
    include: { department: { select: { name: true } } },
  });
  if (!emp) notFound();

  // 회사 부서 목록(배정 드롭다운용)
  const departments = await prisma.department.findMany({
    where: { companyId: me.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true } });
  const companyDaysLabel = daysLabel(parseDays(company?.workDays));
  const effectiveLabel = daysLabel(effectiveWorkDays(emp.workDays, company?.workDays));

  // 이 직원의 연차 사용/잔여(승인된 연차·반차 합)
  const empLeaves = await prisma.leaveRequest.findMany({
    where: { userId: emp.id, companyId: me.companyId },
    select: { type: true, days: true, status: true },
  });
  const leaveUsed = usedLeaveDays(empLeaves);
  const leaveRemaining = emp.annualLeaveDays - leaveUsed;

  const authLabel = emp.authMethod === "face" ? "얼굴인증" : emp.authMethod === "gps" ? "GPS(위치)" : "미설정";
  const consented = !!emp.faceConsentAt;
  const active = !emp.deactivatedAt;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "이메일", value: emp.email },
    { label: "전화번호", value: <span style={{ color: emp.phone ? "var(--text)" : "#9CA3AF" }}>{emp.phone ?? "미입력"}</span> },
    { label: "부서", value: <span style={{ color: emp.department ? "var(--text)" : "#9CA3AF" }}>{emp.department?.name ?? "미배정"}</span> },
    { label: "직급/직책", value: <span style={{ color: emp.position ? "var(--text)" : "#9CA3AF" }}>{emp.position ?? "미입력"}</span> },
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
    <AppShell user={me} active="employees" title={`${emp.name} 님`} subtitle={me.company.name} right={backBtn}>
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
          initialPosition={emp.position ?? ""}
          initialEmployeeNo={emp.employeeNo ?? ""}
          initialHireDate={ymdInput(emp.hireDate)}
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
          올해 부여할 연차 일수입니다. 사용 <b>{leaveUsed}일</b> · 잔여 <b style={{ color: leaveRemaining > 0 ? "var(--primary)" : "var(--danger)" }}>{leaveRemaining}일</b>. (직원이 신청·승인한 연차·반차가 사용에 반영됩니다.)
        </p>
        <AnnualLeaveForm id={emp.id} initialDays={emp.annualLeaveDays} />
      </div>

      {/* 비밀번호 재설정 (재직중일 때만) */}
      {active && (
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
        <EmployeeStatusActions id={emp.id} name={emp.name} active={active} />
      </div>
      </div>
      </div>
    </AppShell>
  );
}
