// 설정 (관리자 전용) — 사업장 위치 등.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/ip";
import { Sidebar } from "@/app/components/Sidebar";
import { OfficeLocationForm } from "./OfficeLocationForm";
import { OfficeNetworkForm } from "./OfficeNetworkForm";

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { officeLat: true, officeLng: true, officeRadiusM: true, officeIps: true },
  });

  const currentIp = getClientIp(await headers());

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg)" }}>
      <Sidebar user={me} active="settings" />

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* 상단 바 */}
        <header
          style={{
            height: 60,
            flexShrink: 0,
            background: "#fff",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>설정</span>
            <span style={{ fontSize: 13, color: "#9CA3AF" }}>{me.company.name} · 관리자 {me.name}</span>
          </div>
        </header>

        <div style={{ flex: 1, minWidth: 0, padding: "24px 28px 48px" }}>
          <div style={{ maxWidth: 720 }}>
            <OfficeLocationForm
              initial={{
                lat: company?.officeLat ?? null,
                lng: company?.officeLng ?? null,
                radius: company?.officeRadiusM ?? 200,
              }}
            />
            <OfficeNetworkForm initialIps={company?.officeIps ?? ""} currentIp={currentIp} />
          </div>
        </div>
      </main>
    </div>
  );
}
