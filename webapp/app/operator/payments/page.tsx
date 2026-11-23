// 운영자 — 결제 (2026-11-23 결제 6단계)
//
// 🔴 로그인 검사는 맨 위에서(app/operator/layout.tsx 주석). 회사 칸막이를 넘어 **모든 회사의 결제**를 보는 화면이다.
// 🔴 보이는 것: 회사 상호·사업자번호·금액·상태·가린 카드번호·이용 기간·거래번호 끝 6자리. 직원 개인정보·빌키는 보이지 않는다.
// 🔴 열 때마다 운영자 기록(열람)을 남긴다 — 회원사 목록과 같은 이유(안전성 확보조치 §8).
//  · 맨 위 "확인 필요"는 지금까지 서버 기록([운영자 확인 필요])에만 남던 결제다. 정상 운영이면 비어 있다.
//  · 취소(환불)는 회사 상세의 "결제" 칸에서 한다(그 회사의 이용 기간을 함께 보고 판단해야 해서).
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import {
  listOperatorPayments, getAttention, parsePayFilter, PAY_FILTERS, ATTENTION_LABEL, STUCK_DAYS, OPERATOR_PAY_PAGE_SIZE, type PayFilter,
} from "@/lib/billing-operator";
import { OperatorHeader } from "../OperatorHeader";
import { ymd, ymdhm, lastDayOf, won, th, td, StatusBadge, typeLabel } from "./PayParts";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; f?: string; p?: string }>;

function query(q: string, f: PayFilter, p?: number): string {
  const s = new URLSearchParams();
  if (q) s.set("q", q);
  if (f !== "all") s.set("f", f);
  if (p && p > 1) s.set("p", String(p));
  const t = s.toString();
  return t ? `/operator/payments?${t}` : "/operator/payments";
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--border)", borderRadius: 12 };

export default async function OperatorPaymentsPage({ searchParams }: { searchParams: SP }) {
  const me = await getCurrentOperator();
  if (!me) redirect("/operator/login");

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 50) : "";
  const filter = parsePayFilter(sp.f);
  const [list, attention] = await Promise.all([
    listOperatorPayments({ q, filter, page: Number(sp.p) || 1 }),
    getAttention(),
  ]);

  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: null, userId: null, actorName: `운영자 ${me.name}`, emailTried: me.email,
    kind: "data_view", result: "success", ip, userAgent,
    meta: `operator_payment_list (검색 ${q || "없음"} · ${PAY_FILTERS.find((f) => f.key === filter)?.label ?? "전체"} · ${list.page}쪽 ${list.rows.length}건 · 확인 필요 ${attention.total}건)`,
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <OperatorHeader name={me.name} active="payments" />
      <main style={{ padding: "28px 28px 40px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>결제</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", margin: "0 0 20px", wordBreak: "keep-all", lineHeight: 1.7 }}>
          모든 회사의 카드 결제입니다. 취소(환불)는 회사 이름을 눌러 회사 상세의 &lsquo;결제&rsquo; 칸에서 합니다. 카드번호는 가린 값만 보입니다.
        </p>

        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          {[
            { label: "확인 필요", value: attention.total, unit: "건", danger: attention.total > 0 },
            { label: "이번 달 결제", value: list.monthPaid.count, unit: "건", danger: false },
            { label: "이번 달 결제 금액(부가세 포함)", value: list.monthPaid.amount.toLocaleString("ko-KR"), unit: "원", danger: false },
          ].map((k) => (
            <div key={k.label} style={{ ...card, padding: "16px 20px", borderColor: k.danger ? "#FECACA" : "var(--border)" }}>
              <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap", color: k.danger ? "var(--danger)" : undefined }}>
                {k.value}
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 확인 필요 — 자동 정리가 손을 못 대는 결제·카드. 비어 있으면 칸을 숨긴다. */}
        {attention.total > 0 && (
          <section style={{ ...card, borderColor: "#FECACA", padding: "20px 24px", marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: "#991B1B" }}>확인 필요 {attention.total}건</h2>
            <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 14px", lineHeight: 1.7, wordBreak: "keep-all" }}>
              자동 정리(10분마다)가 끝내지 못한 결제입니다. 먼저 [KIS에 다시 조회]를 눌러 보고, 그래도 안 닫히면 KIS 상점관리자에서 거래를 직접 확인한 뒤
              확인한 대로 닫아 주세요. 거래번호 끝 6자리로 상점관리자에서 찾을 수 있습니다.
            </p>
            {attention.orders.map((o) => (
              <div key={o.id} style={{ borderTop: "1px solid #F3F4F6", padding: "12px 0", display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0, flex: "1 1 420px", fontSize: 14, lineHeight: 1.7, wordBreak: "keep-all" }}>
                  <div>
                    {o.companyGone ? <b>{o.companyName}</b> : (
                      <Link href={`/operator/companies/${o.companyId}`} style={{ fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>{o.companyName}</Link>
                    )}
                    {o.companyGone && <span style={{ marginLeft: 6, fontSize: 12, color: "var(--danger)", fontWeight: 700 }}>회사 없음(파기)</span>}
                    <span style={{ marginLeft: 8 }}><StatusBadge status={o.status} /></span>
                    <span style={{ marginLeft: 8, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{won(o.totalAmount)}</span>
                    <span style={{ marginLeft: 8, color: "var(--text-sub)", fontSize: 13 }}>{typeLabel(o.orderType)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{o.kinds.map((k) => ATTENTION_LABEL[k]).join(" · ")}</div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)" }}>
                    주문 {o.orderNo} · 거래번호 {o.tidTail ?? "없음"} · 주문 {ymdhm(o.createdAt)}
                    {o.operatorCancelAt && ` · 운영자 취소 요청 ${ymdhm(o.operatorCancelAt)}`}
                    {o.failReason && ` · ${o.failReason}`}
                  </div>
                </div>
                {/* 6-3 처리 버튼 자리 */}
              </div>
            ))}
            {attention.cards.map((k) => (
              <div key={k.id} style={{ borderTop: "1px solid #F3F4F6", padding: "12px 0", display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0, flex: "1 1 420px", fontSize: 14, lineHeight: 1.7, wordBreak: "keep-all" }}>
                  <div>
                    <Link href={`/operator/companies/${k.companyId}`} style={{ fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>{k.companyName}</Link>
                    <span style={{ marginLeft: 8, fontSize: 13, color: "var(--text-sub)" }}>자동결제 카드 등록</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>
                    카드 등록 중 돈이 빠짐 — KIS 상점관리자에서 이 거래를 취소(환불)해 주세요{k.amountHint ? ` (${k.amountHint})` : ""}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)" }}>
                    등록 번호 {k.regNo} · {k.card ?? "카드 정보 없음"} · {ymdhm(k.createdAt)}
                  </div>
                </div>
                {/* 6-3 환불함 표시 자리 */}
              </div>
            ))}
          </section>
        )}

        {/* 검색 + 상태 필터 */}
        <form method="get" action="/operator/payments" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            name="q" defaultValue={q} placeholder="회사명으로 찾기" maxLength={50}
            style={{ height: 38, width: 240, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff" }}
          />
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <button type="submit" style={{ height: 38, padding: "0 16px", border: 0, borderRadius: 8, background: "var(--primary)", color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>
            찾기
          </button>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginLeft: 8 }}>
            {PAY_FILTERS.map((f) => {
              const on = f.key === filter;
              return (
                <Link
                  key={f.key} href={query(q, f.key)} aria-current={on ? "page" : undefined}
                  style={{
                    height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 16, fontSize: 13, fontWeight: 700,
                    textDecoration: "none", whiteSpace: "nowrap", border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                    background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--text-sub)",
                  }}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </form>

        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>회사명</th>
                  <th style={th}>결제 시각</th>
                  <th style={th}>종류</th>
                  <th style={{ ...th, textAlign: "right" }}>금액</th>
                  <th style={th}>상태</th>
                  <th style={th}>늘어난 이용 기간</th>
                  <th style={th}>카드</th>
                  <th style={th}>주문 번호</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...td, textAlign: "center", color: "var(--text-sub)", padding: "32px 16px" }}>
                      {q || filter !== "all" ? "조건에 맞는 결제가 없습니다." : "아직 결제가 없습니다."}
                    </td>
                  </tr>
                )}
                {list.rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      {r.companyGone ? <b>{r.companyName}</b> : (
                        <Link href={`/operator/companies/${r.companyId}`} style={{ fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>{r.companyName}</Link>
                      )}
                      {r.buyerBizRegNo && <div style={{ fontSize: 12, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.buyerBizRegNo}</div>}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymdhm(r.paidAt ?? r.createdAt)}</td>
                    <td style={td}>{typeLabel(r.orderType)}<div style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.employees}명 기준</div></td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{won(r.totalAmount)}</td>
                    <td style={td}>
                      <StatusBadge status={r.status} />
                      {r.operatorCancelAt && <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4 }}>운영자 취소 {ymd(r.operatorCancelAt)}</div>}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                      {r.periodStart && r.periodEnd ? `${ymd(r.periodStart)} ~ ${lastDayOf(r.periodEnd)}` : "—"}
                      {r.status === "cancelled" && r.paidAt && (
                        <div style={{ fontSize: 12, color: r.periodRevertedAt ? "var(--text-sub)" : "var(--danger)", fontWeight: r.periodRevertedAt ? 400 : 700 }}>
                          {r.periodRevertedAt ? "기간 되돌림" : "기간 되돌리는 중"}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 13 }}>{r.card ?? "—"}</td>
                    <td style={{ ...td, fontSize: 12, color: "var(--text-sub)", fontFamily: "monospace" }}>{r.orderNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--text-sub)", flexWrap: "wrap", gap: 8 }}>
          <span>
            {list.total}건 중 {list.total === 0 ? 0 : (list.page - 1) * OPERATOR_PAY_PAGE_SIZE + 1}–{Math.min(list.page * OPERATOR_PAY_PAGE_SIZE, list.total)}
            {" · "}결제창에서 돌아오지 않은 주문·실패(돈 안 빠짐)는 목록에 없습니다. 확인 중인 결제는 {STUCK_DAYS}일까지 자동으로 정리됩니다.
          </span>
          {list.pages > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {list.page > 1 ? <Link href={query(q, filter, list.page - 1)} style={{ color: "var(--primary)", fontWeight: 700 }}>← 이전</Link> : <span>← 이전</span>}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{list.page} / {list.pages}</span>
              {list.page < list.pages ? <Link href={query(q, filter, list.page + 1)} style={{ color: "var(--primary)", fontWeight: 700 }}>다음 →</Link> : <span>다음 →</span>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
