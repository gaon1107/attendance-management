// 계정 설정(공통) — 내 계정 정보 확인 + 비밀번호 변경. 관리자·직원 모두 사용(프로필 아바타로 진입). (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function AccountPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const info: { label: string; value: string }[] = [
    { label: "이름", value: me.name },
    { label: "이메일", value: me.email },
    { label: "회사", value: me.company.name },
    { label: "역할", value: me.role === "admin" ? "관리자" : "직원" },
  ];

  return (
    <AppShell user={me} active="account" title="계정 설정" subtitle={`${me.name} 님`}>
      <div className="split-2">
      {/* 내 정보 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>내 정보</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {info.map((r, i) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid #F3F4F6", gap: 16 }}>
              <span style={{ fontSize: 14, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontSize: 15, textAlign: "right" }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 비밀번호 변경 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>비밀번호 변경</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.
        </p>
        <ChangePasswordForm />
      </div>
      </div>
    </AppShell>
  );
}
