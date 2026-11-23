// 운영자 — 회원사 상세 (2026-11-18, 운영 준비 3단계)
//
// 🔴 로그인 검사는 맨 위에서(app/operator/layout.tsx 주석). 회사 칸막이를 넘는 화면이다.
// 🔴 합계 숫자와 회사가 가입 때 적은 업무용 연락처만 보여준다. 직원 이름·개별 출퇴근·얼굴은 보여주지 않는다.
// 🔴 이 화면을 열 때마다 운영자 기록(열람)을 남긴다 — 본사가 어느 고객사 정보를 언제 봤는지 남아야 한다(안전성 확보조치 §8).
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
import { getCompanyDetail, getCompanyAccessSummary, TRIAL_SOON_DAYS, LAST_USE_WINDOW_DAYS, ACCESS_WINDOW_DAYS } from "@/lib/operator-companies";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { formatKoreanDate } from "@/lib/trial";
import { OperatorHeader } from "../../OperatorHeader";
import { TrialForm, DemoForm, TerminateForm } from "./CompanyControls";
import { purgeDueAt, restoreBlockedReason } from "@/lib/company-termination";
import { getCompanyBilling } from "@/lib/billing-operator";
import { CompanyBillingSection } from "./CompanyBillingSection";

export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 해지 시각 표시용 — "2026-11-22 20:31". 분까지만 보이면 충분하다. */
function fmtDateTime(d: Date): string {
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
  // 접속 현황(합계·날짜만 — 개별 로그인 기록은 보여주지 않는다. lib/operator-companies.ts 주석)
  const acc = await getCompanyAccessSummary(c.id);
  // 결제 칸이 실패해도 해지·무료 기간 같은 기존 운영 기능 화면은 떠야 한다(검수 경미 4) — 결제 칸만 숨긴다.
  let billing: Awaited<ReturnType<typeof getCompanyBilling>> = null;
  try {
    billing = await getCompanyBilling(c.id);
  } catch (e) {
    console.error(`[operator] 회사 결제 칸 조회 실패(ID ${c.id.slice(0, 8)}):`, e instanceof Error ? e.name : "unknown");
  }

  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: null, userId: null, actorName: `운영자 ${me.name}`, emailTried: me.email,
    // 끝에 항상 괄호(회사 ID 앞 8자)를 붙인다 — "가온(주)"처럼 괄호로 끝나는 회사명이 기록 화면에서 잘리지 않게(3단계 검수 경미 1)
    kind: "data_view", result: "success", ip, userAgent, meta: `operator_company_view:${c.name} (ID ${c.id.slice(0, 8)})`,
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
          가입 {ymd(c.createdAt)} · 마지막 사용일 {c.lastClockIn ? ymd(c.lastClockIn) : `${LAST_USE_WINDOW_DAYS}일 넘게 없음`} · 이 화면을 연 기록이 운영자 접속 기록에 남습니다.
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

        {/* 접속 현황 — 2026-11-20 사장님 요청. 합계·날짜만(누가·몇 시·IP는 보이지 않음 = 고객사 직원 개인정보 보호) */}
        <section style={{ ...card, marginBottom: 16 }}>
          <h2 style={{ ...h2, marginBottom: 4 }}>접속 현황</h2>
          <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 10px", lineHeight: 1.6, wordBreak: "keep-all" }}>
            회사 전체 합계만 보여 줍니다(아래 숫자는 최근 {ACCESS_WINDOW_DAYS}일 기준). 누가 언제 어디서 접속했는지(개별 기록)는 고객사 직원 개인정보라 이 화면에서 볼 수 없습니다.
          </p>
          <Row label="마지막 접속일" value={acc.lastActiveDay ? ymd(acc.lastActiveDay) : `${LAST_USE_WINDOW_DAYS}일 넘게 없음`} />
          <Row label="회사 계정 로그인" value={acc.ownerLastLoginDay ? `마지막 ${ymd(acc.ownerLastLoginDay)}` : `${LAST_USE_WINDOW_DAYS}일 넘게 없음`} />
          <Row label="접속 계정" value={`${acc.activeAccounts30d}개${acc.ownerActive30d ? " (회사 계정 포함)" : ""}`} />
          <Row label="로그인" value={`${acc.logins30d}회 · ${acc.loginAccounts30d}개 계정`} />
          <Row
            label="로그인 실패"
            value={
              <span style={{ color: acc.loginFails30d >= 10 ? "var(--danger)" : undefined, fontWeight: acc.loginFails30d >= 10 ? 700 : undefined }}>
                {acc.loginFails30d}회 (비밀번호 틀림){acc.loginFails30d >= 10 ? " — 비밀번호를 여러 번 틀린 계정이 있는지 고객사에 확인해 보세요" : ""}
              </span>
            }
          />
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 10, lineHeight: 1.6, wordBreak: "keep-all" }}>
            직원은 한 번 로그인하면 쓰는 동안 로그인이 유지되므로 로그인 횟수가 적은 것이 정상입니다. 실제 사용 여부는 &lsquo;접속 계정&rsquo;과 &lsquo;마지막 접속일&rsquo;로 보세요.
          </div>
        </section>

        {/* 결제 — 2026-11-23 결제 6단계(lib/billing-operator.ts). 이용 상태·요금 인원·자동결제 카드·결제 내역·취소(환불). */}
        {billing && <CompanyBillingSection companyId={c.id} b={billing} />}

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
            {/* 결제한 기간이 있으면 미리 알린다(2026-11-23 결제 6단계) — 결제 기간은 무료 끝 뒤에 이어 붙어 있어, 무료 기간을 늘리면 겹친다. */}
            {billing?.paidUntil && (
              <div role="note" style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#9A3412", marginBottom: 12, lineHeight: 1.6, wordBreak: "keep-all" }}>
                이 회사는 <b>{ymd(new Date(billing.paidUntil.getTime() - 1))}까지 결제한 기간</b>이 있습니다. 무료 기간을 늘려도 그날까지는 달라지지 않고,
                그날보다 길게 하면 고객이 낸 기간이 무료 기간에 묻힙니다.
              </div>
            )}
            <TrialForm companyId={c.id} current={ymd(c.trialLast)} custom={c.trialLastDate !== null} />

            <h2 style={{ ...h2, marginTop: 28 }}>시험용 회사 표시</h2>
            <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 12px", lineHeight: 1.6, wordBreak: "keep-all" }}>
              시험용으로 표시하면 홈페이지 공개 통계와 이 화면의 고객 수에서 빠지고, <b>미납 차단에서도 빠집니다</b>(결제가 없어도 직원 출근이 막히지 않음). 시험용 표시를 끄면 그 즉시 차단 대상이 됩니다.
              <br />
              <b style={{ color: "var(--danger)" }}>실제 고객 회사에는 켜지 마세요.</b> 시험용 회사는 데모 정리 작업에서 지워질 수 있습니다.
            </p>
            <DemoForm companyId={c.id} isDemo={c.isDemo} />

            {/* 해지(탈퇴) — 2026-11-22, 이용약관 제14조 ④·제15조.
                  1단계: 해지하면 로그인만 막고 30일 안에는 되살릴 수 있다.
                  2단계: 30일이 지나면 되살리기가 막히고 그 뒤 첫 새벽에 자동 파기된다(lib/company-purge.ts).
                  🔴 "되살릴 수 있는가"는 **서버 시계로 여기서** 판정해 넘긴다(브라우저 시계는 틀릴 수 있다).
                     서버 액션도 같은 함수(lib/company-termination.ts)로 다시 검사한다. */}
            <h2 style={{ ...h2, marginTop: 28 }}>해지(탈퇴) 처리</h2>
            <TerminateForm
              companyId={c.id}
              companyName={c.name}
              terminatedAt={c.terminatedAt ? fmtDateTime(c.terminatedAt) : null}
              terminatedBy={c.terminatedBy}
              terminatedNote={c.terminatedNote}
              purgeDue={c.terminatedAt ? fmtDateTime(purgeDueAt(c.terminatedAt)) : null}
              restoreBlocked={restoreBlockedReason(c)}
            />
          </section>

          <section style={card}>
            <h2 style={h2}>회사 정보 (가입 때 회사가 입력)</h2>
            <Row label="사업자등록번호" value={c.bizRegNo} />
            <Row label="대표자" value={c.ceoName} />
            <Row label="대표전화" value={c.companyPhone} />
            <Row label="담당자" value={[c.managerName, c.managerTitle].filter(Boolean).join(" · ")} />
            <Row label="담당자 연락처" value={c.managerPhone} />
            <Row label="담당자 이메일" value={c.managerEmail} />
            <Row label="회사 계정(로그인)" value={c.ownerEmail ? `${c.ownerEmail} (일부 가림)` : null} />
          </section>
        </div>
      </main>
    </div>
  );
}
