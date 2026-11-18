// 운영자(본사) 홈 — 회원사 현황.
//
// 🔴 로그인 검사는 **여기 맨 위**에서 한다(layout이 아니라). 이유는 app/operator/layout.tsx 주석.
// 🔴 이 화면은 회사 칸막이(companyId 격리)를 넘어 **전체 회원사**를 보는 유일한 자리다.
//    그래서 지켜야 하는 선이 있다 — 직원 개인 이름·개별 근태·얼굴 정보는 **보여주지 않는다.**
//    회사별 합계 숫자만 본다(조회는 lib/operator-companies.ts — 그 파일도 합계만 꺼낸다).
//
// 2026-11-18(운영 준비 3단계): 회원사 목록 — 검색(회사명)·무료 상태 필터·50개씩. 상세·무료 기간 지정은 /operator/companies/[id].
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { listCompanies, parseTrialFilter, TRIAL_FILTERS, TRIAL_SOON_DAYS, OPERATOR_PAGE_SIZE, LAST_USE_WINDOW_DAYS, type CompanyRow, type TrialFilter } from "@/lib/operator-companies";
import { formatKoreanDate } from "@/lib/trial";
import { OperatorHeader } from "./OperatorHeader";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; f?: string; p?: string }>;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function TrialBadge({ r }: { r: CompanyRow }) {
  const tone = r.expired
    ? { bg: "#FEE2E2", dot: "var(--danger)", fg: "#991B1B", text: "종료" }
    : r.daysLeft <= TRIAL_SOON_DAYS
      ? { bg: "#FFEDD5", dot: "var(--warning)", fg: "#9A3412", text: `${r.daysLeft}일 남음` }
      : { bg: "#DBEAFE", dot: "var(--primary)", fg: "#1E40AF", text: `${r.daysLeft}일 남음` };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: tone.bg, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone.dot }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: tone.fg }}>{tone.text}</span>
    </span>
  );
}

function query(q: string, f: TrialFilter, p?: number): string {
  const s = new URLSearchParams();
  if (q) s.set("q", q);
  if (f !== "all") s.set("f", f);
  if (p && p > 1) s.set("p", String(p));
  const t = s.toString();
  return t ? `/operator?${t}` : "/operator";
}

export default async function OperatorHomePage({ searchParams }: { searchParams: SP }) {
  const me = await getCurrentOperator();
  if (!me) redirect("/operator/login");

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 50) : "";
  const filter = parseTrialFilter(sp.f);
  const pageReq = Number(sp.p) || 1;
  const { rows, total, page, pages, summary } = await listCompanies({ q, filter, page: pageReq });

  // 목록에도 고객사 담당자 이름·연락처가 나오므로 상세 화면과 똑같이 열람 기록을 남긴다(3단계 검수 중간 2 —
  // 상세만 기록하면 검색으로 특정 회사 연락처를 봐도 흔적이 없다). 무엇을 찾았는지(검색어·필터·쪽)도 함께.
  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: null, userId: null, actorName: `운영자 ${me.name}`, emailTried: me.email,
    kind: "data_view", result: "success", ip, userAgent,
    meta: `operator_company_list (검색 ${q || "없음"} · ${TRIAL_FILTERS.find((f) => f.key === filter)?.label ?? "전체"} · ${page}쪽 ${rows.length}곳)`,
  });

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle", whiteSpace: "nowrap" };
  const kpis: { label: string; value: number; unit: string; f: TrialFilter }[] = [
    { label: "고객 회사(시험용 제외)", value: summary.customers, unit: "곳", f: "all" },
    { label: "무료 체험 중", value: summary.active, unit: "곳", f: "active" },
    { label: `${TRIAL_SOON_DAYS}일 이내 종료`, value: summary.soon, unit: "곳", f: "soon" },
    { label: "무료 기간 종료", value: summary.expired, unit: "곳", f: "expired" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <OperatorHeader name={me.name} active="companies" />
      <main style={{ padding: "28px 28px 40px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>회원사 현황</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", margin: "0 0 20px", wordBreak: "keep-all" }}>
          회사별 합계만 보여 줍니다. 직원 개인 정보와 개별 출퇴근 기록은 이 화면에서 볼 수 없습니다.
        </p>

        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          {kpis.map((k) => (
            <Link key={k.label} href={query("", k.f)} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
                  {k.value}
                  <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* 검색(회사명) + 상태 필터 — 서버에서 거르는 방식이라 회사가 많아도 한 화면 조회 횟수는 같다 */}
        <form method="get" action="/operator" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="회사명으로 찾기"
            maxLength={50}
            style={{ height: 38, width: 240, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff" }}
          />
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <button type="submit" style={{ height: 38, padding: "0 16px", border: 0, borderRadius: 8, background: "var(--primary)", color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>
            찾기
          </button>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginLeft: 8 }}>
            {TRIAL_FILTERS.map((f) => {
              const on = f.key === filter;
              return (
                <Link
                  key={f.key}
                  href={query(q, f.key)}
                  aria-current={on ? "page" : undefined}
                  style={{
                    height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 16,
                    fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                    border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                    background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--text-sub)",
                  }}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </form>

        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>회사명</th>
                  <th style={th}>가입일</th>
                  <th style={th}>무료 이용</th>
                  <th style={th}>마지막 날</th>
                  <th style={{ ...th, textAlign: "right" }}>재직 직원</th>
                  <th style={{ ...th, textAlign: "right" }}>최근 7일 출근</th>
                  <th style={th}>마지막 사용일</th>
                  <th style={th}>담당자</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...td, textAlign: "center", color: "var(--text-sub)", padding: "32px 16px" }}>
                      {q || filter !== "all" ? "조건에 맞는 회사가 없습니다." : "아직 가입한 회사가 없습니다."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <Link href={`/operator/companies/${r.id}`} style={{ fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>
                        {r.name}
                      </Link>
                      {r.isDemo && (
                        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: "var(--text-sub)", background: "#F3F4F6", borderRadius: 4, padding: "2px 6px" }}>시험용</span>
                      )}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymd(r.createdAt)}</td>
                    <td style={td}><TrialBadge r={r} /></td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                      {formatKoreanDate(r.trialLast)}
                      {r.trialCustom && <span style={{ marginLeft: 6, fontSize: 12, color: "var(--primary)", fontWeight: 700 }}>지정</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.employees}명</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.clockIns7d}건</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.lastClockIn ? "var(--text)" : "var(--text-sub)" }}>
                      {r.lastClockIn ? ymd(r.lastClockIn) : `${LAST_USE_WINDOW_DAYS}일 넘게 없음`}
                    </td>
                    <td style={td}>
                      {r.managerName || r.managerPhone ? (
                        <>
                          {r.managerName ?? ""}
                          {r.managerPhone && <span style={{ marginLeft: 6, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.managerPhone}</span>}
                        </>
                      ) : (
                        <span style={{ color: "var(--text-sub)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이지 나누기 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--text-sub)", flexWrap: "wrap", gap: 8 }}>
          <span>
            {total}곳 중 {total === 0 ? 0 : (page - 1) * OPERATOR_PAGE_SIZE + 1}–{Math.min(page * OPERATOR_PAGE_SIZE, total)}
            {summary.demo > 0 && filter !== "demo" && ` · 시험용 ${summary.demo}곳 포함`}
          </span>
          {pages > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {page > 1 ? <Link href={query(q, filter, page - 1)} style={{ color: "var(--primary)", fontWeight: 700 }}>← 이전</Link> : <span>← 이전</span>}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{page} / {pages}</span>
              {page < pages ? <Link href={query(q, filter, page + 1)} style={{ color: "var(--primary)", fontWeight: 700 }}>다음 →</Link> : <span>다음 →</span>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
