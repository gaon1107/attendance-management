// 운영자 — 회원사 상세 (2026-11-18, 운영 준비 3단계)
//
// 🔴 로그인 검사는 맨 위에서(app/operator/layout.tsx 주석). 회사 칸막이를 넘는 화면이다.
// 🔴 합계 숫자와 회사가 가입 때 적은 업무용 연락처만 보여준다. 직원 이름·개별 출퇴근·얼굴은 보여주지 않는다.
// 🔴 이 화면을 열 때마다 운영자 기록(열람)을 남긴다 — 본사가 어느 고객사 정보를 언제 봤는지 남아야 한다(안전성 확보조치 §8).
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
import { getCompanyDetail, TRIAL_SOON_DAYS } from "@/lib/operator-companies";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { formatKoreanDate } from "@/lib/trial";
import { OperatorHeader } from "../../OperatorHeader";
import { TrialForm, DemoForm } from "./CompanyControls";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymdhm(d: Date): string {
  return `${ymd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" };
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: "0 0 14px" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: 14 }}>
      <div style={{ width: 130, flexShrink: 0, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ minWidth: 0, wordBreak: "break-all" }}>{value || <span style={{ color: "var(--text-sub)" }}>—</span>}</div>
    </div>
  );
}

export default async function OperatorCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentOperator();
  if (!me) redirect("/operator/login");

  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) notFound();
  const c = await getCompanyDetail(id);
  if (!c) notFound();

  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: null, userId: null, actorName: `운영자 ${me.name}`, emailTried: me.email,
    kind: "data_view", result: "success", ip, userAgent, meta: `operator_company_view:${c.name}`,
  });

  const trialText = c.expired
    ? "종료"
    : `${c.daysLeft}일 남음${c.daysLeft <= TRIAL_SOON_DAYS ? " (곧 종료)" : ""}`;
  const kpis = [
    { label: "재직 직원", value: c.employees, unit: "명" },
    { label: "그중 관리자", value: c.admins, unit: "명" },
    { label: "퇴사 처리", value: c.deactivated, unit: "명" },
    { label: "최근 30일 출근", value: c.clockIns30d, unit: "건" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <OperatorHeader name={me.name} active="companies" />
      <main style={{ padding: "28px 28px 40px" }}>
        <Link href="/operator" style={{ fontSize: 13, color: "var(--text-sub)", textDecoration: "none" }}>← 회원사 목록</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "8px 0 4px" }}>
          {c.name}
          {c.isDemo && <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: "var(--text-sub)", background: "#F3F4F6", borderRadius: 4, padding: "2px 8px", verticalAlign: "middle" }}>시험용</span>}
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", margin: "0 0 20px", wordBreak: "keep-all" }}>
          가입 {ymd(c.createdAt)} · 마지막 출근 {c.lastClockIn ? ymdhm(c.lastClockIn) : "기록 없음"} · 이 화면을 연 기록이 운영자 접속 기록에 남습니다.
        </p>

        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
                {k.value}
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="split-2">
          <section style={card}>
            <h2 style={h2}>무료 이용 기간</h2>
            <div style={{ fontSize: 14, marginBottom: 16, lineHeight: 1.7, wordBreak: "keep-all" }}>
              지금: <b>{formatKoreanDate(c.trialLast)}까지</b> · {trialText}
              <br />
              <span style={{ color: "var(--text-sub)" }}>
                {c.trialLastDate ? "운영자가 정한 날짜입니다." : "정한 날짜가 없어 기본값(가입일부터 30일)이 적용 중입니다."} 고객사 대시보드에 이 날짜가 그대로 보입니다.
                만료돼도 기능은 막히지 않습니다(결제 기능과 함께 적용 예정).
              </span>
            </div>
            <TrialForm companyId={c.id} current={ymd(c.trialLast)} custom={c.trialLastDate !== null} />

            <h2 style={{ ...h2, marginTop: 28 }}>시험용 회사 표시</h2>
            <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 12px", lineHeight: 1.6, wordBreak: "keep-all" }}>
              시험용으로 표시하면 홈페이지 공개 통계와 이 화면의 고객 수에서 빠집니다. 근태 기능에는 영향이 없습니다.
            </p>
            <DemoForm companyId={c.id} isDemo={c.isDemo} />
          </section>

          <section style={card}>
            <h2 style={h2}>회사 정보 (가입 때 회사가 입력)</h2>
            <Row label="사업자등록번호" value={c.bizRegNo} />
            <Row label="대표자" value={c.ceoName} />
            <Row label="대표전화" value={c.companyPhone} />
            <Row label="담당자" value={[c.managerName, c.managerTitle].filter(Boolean).join(" · ")} />
            <Row label="담당자 연락처" value={c.managerPhone} />
            <Row label="담당자 이메일" value={c.managerEmail} />
            <Row label="회사 계정(로그인)" value={c.ownerEmail} />
          </section>
        </div>
      </main>
    </div>
  );
}
