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
import { getPurgeOverview, PURGE_HOUR_FROM, PURGE_HOUR_TO, type PurgePending } from "@/lib/company-purge";

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

/** 날짜·시각 — "2026-12-22 20:31" */
function ymdhm(d: Date): string {
  return `${ymd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 해지 회사 파기 상태 배지 — 보관 중(되살리기 가능) / 파기 대기 / 보류 */
function PurgeBadge({ s }: { s: PurgePending["state"] }) {
  const tone =
    s === "keeping" ? { bg: "#DBEAFE", fg: "#1E40AF", text: "보관 중(되살리기 가능)" }
    : s === "waiting" ? { bg: "#FFEDD5", fg: "#9A3412", text: "파기 대기" }
    : { bg: "#FEE2E2", fg: "#991B1B", text: "보류" };
  return (
    <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>
      {tone.text}
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
  // 해지 회사 파기 현황(2026-11-22 해지 2단계) — 해지한 회사가 하나도 없고 경고도 없으면 칸 자체를 숨긴다.
  const purge = await getPurgeOverview();
  const showPurge = purge.pending.length > 0 || purge.done.length > 0 || purge.uncovered.length > 0;

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
                      {/* 해지 배지(2026-11-22 검수 중간 4) — 목록만 보고도 알아야 한다.
                             없으면 해지한 회사에 "무료 이용 중"으로 연락·청구하는 사고가 난다. */}
                      {r.terminated && (
                        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: "var(--danger)", background: "#FEE2E2", borderRadius: 4, padding: "2px 6px" }}>해지</span>
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

        {/* 해지 회사 파기 현황 — 2026-11-22 해지 2단계(lib/company-purge.ts).
              약관 제14조 ④ "30일 보관 뒤 파기"가 실제로 지켜지는지 운영자가 한눈에 보는 자리.
              🔴 "보류"가 오래 남아 있으면 약속(30일) 위반이 이어지는 중이다 — 사유(얼굴서버·파일)를 보고 조치한다.
              파기된 회사는 이름이 남지 않는다(파기 대상 정보). ID 앞 8자리로 해지 때의 운영자 기록과 대조한다. */}
        {showPurge && (
          <section style={{ marginTop: 28, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>해지 회사 파기 현황</h2>
            <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 14px", lineHeight: 1.7, wordBreak: "keep-all" }}>
              해지 후 30일이 지나면 매일 새벽 {PURGE_HOUR_FROM}~{PURGE_HOUR_TO}시에 모든 데이터(직원·근태·파일·얼굴 정보)가 자동으로 파기됩니다.
              접속 기록만 2년 보관 뒤 따로 지워집니다. 하루에 최대 3곳까지 처리하고, 실패한 회사는 다음 날 다시 시도합니다.
              {/* "마지막 회차" — 대장은 회차마다 한 줄이라, 중단 뒤 이어서 끝난 회사는 마지막 날 지운 건수만 보인다(검수 경미 6). */}
            </p>
            {purge.uncovered.length > 0 && (
              <div role="alert" style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#991B1B", fontWeight: 700, marginBottom: 14, lineHeight: 1.7, wordBreak: "keep-all" }}>
                자동 파기가 멈춰 있습니다. 파기 목록에 없는 데이터 표가 있습니다({purge.uncovered.join(", ")}). 개발 담당에게 알려 주세요.
              </div>
            )}
            {purge.pending.length > 0 && (
              <div style={{ overflowX: "auto", marginBottom: purge.done.length > 0 ? 18 : 0 }}>
                <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                      <th style={th}>회사명</th>
                      <th style={th}>해지 시각</th>
                      <th style={th}>파기 예정</th>
                      <th style={th}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purge.pending.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={td}>
                          <Link href={`/operator/companies/${r.id}`} style={{ fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>{r.name}</Link>
                        </td>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymdhm(r.terminatedAt)}</td>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymdhm(r.dueAt)} 이후 첫 새벽</td>
                        <td style={{ ...td, whiteSpace: "normal" }}>
                          <PurgeBadge s={r.state} />
                          {r.note && <div style={{ marginTop: 4, fontSize: 12, color: "#991B1B", wordBreak: "keep-all" }}>{r.note}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {purge.done.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>최근 파기 완료(최대 10건)</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        <th style={th}>회사 ID(앞 8자리)</th>
                        <th style={th}>해지 시각</th>
                        <th style={th}>파기 시각</th>
                        <th style={{ ...th, textAlign: "right" }}>지운 기록(마지막 회차)</th>
                        <th style={{ ...th, textAlign: "right" }}>지운 파일(마지막 회차)</th>
                        <th style={{ ...th, textAlign: "right" }}>얼굴 삭제 요청</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purge.done.map((d) => (
                        <tr key={`${d.companyId}-${d.ranAt.getTime()}`} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ ...td, fontFamily: "monospace" }}>{d.companyId.slice(0, 8)}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymdhm(d.terminatedAt)}</td>
                          <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymdhm(d.ranAt)}</td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.total.toLocaleString()}건</td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.file}개</td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.face}명</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
