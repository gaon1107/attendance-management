// 생체정보 동의·파기 관리(관리자) — 직원별 얼굴(생체정보) 동의 현황 + 파기(철회) + 통합검색. (리뉴얼 디자인)
// 법적 가드레일: 생체정보는 민감정보. 관리자가 동의 현황을 파악하고, 퇴사 등 시 파기할 수 있어야 한다.
// ※ 실제 얼굴 원본 데이터 삭제는 얼굴서버(GaonFR) 연동(2phase) 시점에 수행된다. 지금은 동의 상태를 관리한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { BiometricsList, type BioRow } from "./BiometricsList";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function BiometricsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 회사 소속 전원(관리자 포함) — 생체정보 동의는 누구나 할 수 있으므로 전원 표시
  const users = await prisma.user.findMany({
    where: { companyId: me.companyId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  // 실제 데이터로만 집계
  const consentedList = users.filter((u) => !!u.faceConsentAt);
  const faceUsers = users.filter((u) => u.authMethod === "face").length;

  const kpis = [
    { label: "전체 인원", value: `${users.length}`, unit: "명", color: "var(--text)" },
    { label: "생체정보 동의", value: `${consentedList.length}`, unit: "명", color: consentedList.length > 0 ? "var(--primary)" : "var(--text)" },
    { label: "얼굴인증 사용", value: `${faceUsers}`, unit: "명", color: "var(--text)" },
  ];

  const rows: BioRow[] = users.map((u) => {
    const authLabel = u.authMethod === "face" ? "얼굴인증" : u.authMethod === "gps" ? "GPS" : "미설정";
    const consented = !!u.faceConsentAt;
    return {
      id: u.id, name: u.name, initial: u.name.slice(0, 1), isAdmin: u.role === "admin",
      authLabel, hasAuth: !!u.authMethod, consented, consentDateLabel: u.faceConsentAt ? ymd(u.faceConsentAt) : "",
      search: [u.name, authLabel, consented ? "동의함" : "동의 안 함"].join(" ").toLowerCase(),
    };
  });

  return (
    <AppShell user={me} active="biometrics" title="생체정보 관리" subtitle={me.company.name}>
      {/* 법적 안내 */}
      <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "14px 16px", marginBottom: 16, fontSize: 13, color: "#1E40AF", lineHeight: 1.6 }}>
        얼굴 정보는 <b>민감정보(생체정보)</b>입니다. 직원 동의 현황을 확인하고, 퇴사·요청 시 <b>파기</b>할 수 있습니다.
        얼굴 원본 데이터의 실제 삭제는 얼굴인증 서버 연동(준비 중) 시점에 함께 수행됩니다.
      </div>

      <div className="kpi-grid-3" style={{ marginBottom: 16 }}>
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

      <BiometricsList users={rows} />

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6 }}>
        [파기]를 누르면 해당 직원의 생체정보 동의가 철회되고 인증방식이 GPS로 전환됩니다.
        직원 본인도 [인증방식] 화면에서 언제든 동의를 철회할 수 있습니다.
      </div>
    </AppShell>
  );
}
