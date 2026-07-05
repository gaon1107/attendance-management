// 설정 (관리자 전용) — 사업장 위치 등.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { TopNav } from "@/app/components/TopNav";
import { OfficeLocationForm } from "./OfficeLocationForm";

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { officeLat: true, officeLng: true, officeRadiusM: true },
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav user={me} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>설정</h1>
        <OfficeLocationForm
          initial={{
            lat: company?.officeLat ?? null,
            lng: company?.officeLng ?? null,
            radius: company?.officeRadiusM ?? 200,
          }}
        />
      </main>
    </div>
  );
}
