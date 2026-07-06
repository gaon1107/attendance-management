// 회사 초기설정(온보딩) — 가입 직후 관리자가 근무기준·회사위치를 한 번에 정하는 집중형 화면. (리뉴얼 디자인)
// 사이드바 없이 가운데 정렬(첫 설정에 집중). 각 항목은 개별 저장되며, 나중에 [설정]에서 다시 바꿀 수 있다.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { WorkRulesForm } from "@/app/settings/WorkRulesForm";
import { OfficeLocationForm } from "@/app/settings/OfficeLocationForm";

export default async function OnboardingPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { officeLat: true, officeLng: true, officeRadiusM: true, workStartTime: true, workEndTime: true, lateGraceMin: true },
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 64px" }}>
        {/* 로고 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 18 }}>근</div>
          <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>환영합니다, {me.name} 님 👋</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24, lineHeight: 1.6 }}>
          <b>{me.company.name}</b>의 근태를 시작하기 전에 기본 설정을 해주세요. 지금 건너뛰어도 되고, 나중에 [설정]에서 언제든 바꿀 수 있습니다.
        </p>

        {/* 1) 근무제·기준시간 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", marginBottom: 8 }}>1단계 · 근무 기준</div>
          <WorkRulesForm
            initial={{
              start: company?.workStartTime ?? "",
              end: company?.workEndTime ?? "",
              grace: company?.lateGraceMin ?? 0,
            }}
          />
        </div>

        {/* 2) 회사 위치 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", marginBottom: 8 }}>2단계 · 회사 위치 (사무실 출근 확인용)</div>
          <OfficeLocationForm
            initial={{
              lat: company?.officeLat ?? null,
              lng: company?.officeLng ?? null,
              radius: company?.officeRadiusM ?? 200,
            }}
          />
        </div>

        {/* 완료 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/dashboard"
            style={{ height: 52, padding: "0 28px", display: "inline-flex", alignItems: "center", borderRadius: 10, background: "var(--primary)", color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none" }}
          >
            설정 완료 · 대시보드로 →
          </Link>
          <Link href="/dashboard" style={{ fontSize: 14, color: "var(--text-sub)", textDecoration: "none", fontWeight: 700 }}>
            나중에 하기
          </Link>
        </div>
      </main>
    </div>
  );
}
