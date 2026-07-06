// 직원 상세/수정 — 관리자 전용. 개별 직원 정보 확인 + 이름 수정 + 근태 상세로 이동. (리뉴얼 디자인)
// ※ 회사 격리: 내 회사 소속 직원만 조회(notFound).
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { EditEmployeeForm } from "./EditEmployeeForm";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const { id } = await params;
  const emp = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!emp) notFound();

  const authLabel = emp.authMethod === "face" ? "얼굴인증" : emp.authMethod === "gps" ? "GPS(위치)" : "미설정";
  const consented = !!emp.faceConsentAt;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "이메일", value: emp.email },
    { label: "역할", value: emp.role === "admin" ? "관리자" : "직원" },
    { label: "인증방식", value: <span style={{ color: emp.authMethod ? "var(--text)" : "#9CA3AF" }}>{authLabel}</span> },
    {
      label: "생체정보 동의",
      value: consented
        ? <span style={{ color: "#15803D", fontWeight: 700 }}>동의함 {emp.faceConsentAt ? `(${ymd(emp.faceConsentAt)})` : ""}</span>
        : <span style={{ color: "#9CA3AF" }}>동의 안 함</span>,
    },
    { label: "가입일", value: ymd(emp.createdAt) },
  ];

  const backBtn = (
    <Link href="/employees" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 직원 관리
    </Link>
  );

  return (
    <AppShell user={me} active="employees" title={`${emp.name} 님`} subtitle={me.company.name} right={backBtn} narrow>
      {/* 정보 카드 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 20 }}>
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
    </AppShell>
  );
}
