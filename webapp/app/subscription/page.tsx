// [구독·요금] (관리자 전용) — "우리 회사는 지금 얼마인가"를 보여주는 화면.
//
// 2026-11-23 결제 2단계: **카드 1개월 결제**(직접 결제만 — 자동결제는 3단계)와 결제 내역을 붙였다(lib/billing-pay.ts).
//    KIS 상점 설정이 없으면 버튼 대신 "준비 중"이 보인다(lib/kispg-config.ts). 계획서 plan-근태결제-개발.md.
//    ⚠️ 아직 아무것도 막지 않는다(미납 차단은 5단계) — 화면 문구도 그 사실에 맞춘다.
//
// 📌 **금액 표기 판단**(2026-11-20 사장님 결정 ③과의 관계):
//    공개 요금표(홈화면)는 "(부가세 별도)" 안내만 하기로 확정됐다. 이 화면은 공개 광고가 아니라
//    **관리자가 자기 회사 청구액을 확인하는 내부 화면**이라, 공급가와 함께 **카드에서 실제로 빠지는
//    금액(부가세 포함)**을 적는다. 고객이 5,000원으로 기억하고 결제창에서 5,500원을 보고 놀라는 일을
//    줄이는 쪽이 안전하고, 결제 금액 고지는 광고 표기 정책과 별개다.
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { quoteForCompany } from "@/lib/pricing-server";
import { PRICE_TIERS, QUOTE_OVER, formatWon, tierLabel, withVat } from "@/lib/pricing";
import { trialStatus, trialLastDay, formatKoreanDate, TRIAL_DAYS } from "@/lib/trial";
import { payOverview, listPayments } from "@/lib/billing-pay";
import { PayButton } from "./PayButton";

const card = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden" as const,
};
const cardPad = { ...card, padding: "16px 20px" };
// 한글 안내문은 음절 중간에서 줄바꿈되지 않게(디자인 규칙 §4).
const noteText = { fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7, wordBreak: "keep-all" as const };

// ⚠️ 라벨·보조문구에 `whiteSpace: "nowrap"`을 주지 않는다(검수 중간 5).
//    카드가 `overflow: hidden`이라, 폰(≤600px)에서 `.kpi-grid`가 2열이 되면 글자 영역이 110px 안쪽으로
//    좁아져 **말줄임표도 없이 잘려 사라진다.** 이 화면의 라벨("카드 청구액")과 보조문구
//    ("공급가 5,000원 + 부가세 500원")는 이 저장소에서 가장 긴 편이라 그 폭을 넘는다.
//    → 라벨·보조문구는 두 줄로 접히게 두고(keep-all: 어절 단위로만 끊김), 숫자만 nowrap을 지킨다.
function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div style={cardPad}>
      <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, wordBreak: "keep-all" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
        {value}
        {unit ? (
          <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{unit}</span>
        ) : null}
      </div>
      {sub ? (
        <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, lineHeight: 1.5, wordBreak: "keep-all" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export default async function SubscriptionPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 인원 집계와 요금 산출을 한 번에 — 경로를 하나로 모은다(검수 중간 4).
  //  ⚠️ 인원을 따로 세지 말 것. 화면에 보이는 숫자와 나중에 청구하는 숫자가 **같은 함수**여야 한다.
  const q = await quoteForCompany(me.companyId);
  const employees = q.employees;
  const now = new Date();
  const trial = trialStatus(me.company.createdAt, now, me.company.trialLastDate);
  const [pay, payments] = await Promise.all([payOverview(me.companyId, now), listPayments(me.companyId)]);
  // 이용 기간 끝(자정 기준 표시용) — 유료 기간이 있으면 그 끝, 없으면 무료 기간 끝.
  const paidActive = !!pay?.paidUntil && pay.paidUntil > now;
  const canPayNow = !!pay && pay.canPayFrom <= now;

  return (
    <AppShell user={me} active="subscription" title="구독·요금" subtitle={`${me.company.name} · 관리자 ${me.name}`}>
      {/* ── 1. 지금 요금 ───────────────────────────────────────────── */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {/* 2026-11-23 과금 규칙 변경(관리자 1명까지만 제외 — lib/pricing-server.ts FREE_ADMIN_COUNT).
            예전엔 관리자를 전부 빼서 "관리자는 세지 않는다"가 곧 0원 회피법이라 화면에 쓰지 못했다(검수 치명 2).
            이제 2명째 관리자부터 세므로 회피법이 아니라 정책이다 → 그대로 적는다. 숫자를 바꾸면 이 문구도 함께. */}
        <Kpi label="요금 대상 인원" value={employees.toLocaleString("ko-KR")} unit="명" sub="관리자 1명·퇴사자 제외" />
        <Kpi
          label="현재 구간"
          value={q.kind === "tier" ? q.label : q.kind === "quote" ? `${QUOTE_OVER + 1}명 이상` : "—"}
          sub={q.kind === "quote" ? "별도 협의 구간" : q.kind === "none" ? "대상 직원 없음" : undefined}
        />
        <Kpi
          label="월 요금"
          value={q.kind === "tier" ? formatWon(q.monthly) : q.kind === "quote" ? "별도 협의" : "—"}
          sub={q.kind === "tier" ? "부가세 별도" : undefined}
        />
        {/* 체험 중에는 "카드 청구액"을 그냥 크게 보여주면 "이미 빠져나갔나?"로 읽힌다(검수 중간 1).
            결제는 관리자가 아래 [카드로 1개월 결제하기]를 누를 때만 된다(자동결제 없음 — 3단계 전). */}
        <Kpi
          label="카드 청구액"
          value={q.kind === "tier" ? formatWon(q.total) : "—"}
          sub={
            q.kind === "tier"
              ? // 괄호 앞에 띄어쓰기를 둔다 — `keep-all`에서 "부가세 포함(공급가"가 끊길 자리 없는
                // 한 덩어리가 되면 폰 2열(약 110px)에서 넘친다(검수 경미 2).
                `부가세 포함 (공급가 ${formatWon(q.monthly)} + 부가세 ${formatWon(q.vat)})${
                  // 체험 중에 미리 결제한 회사에는 "아직 청구 없음"이 거짓이다(결제 2단계에서 발견) — 결제 기록이 없을 때만.
                  trial.expired || paidActive ? "" : " · 체험 중 — 아직 청구 없음"
                }`
              : undefined
          }
        />
      </div>

      {/* 금액을 보여줄 수 없는 두 경우는 각각 다른 안내가 필요하다. */}
      {q.kind === "none" ? (
        <div style={{ ...cardPad, marginBottom: 16, borderLeft: "4px solid var(--warning)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>요금 대상 인원이 없습니다</div>
          {/* 2026-11-23부터 이 분기는 "직원 0명 + 사람 관리자 1명 이하"일 때만 나온다(관리자 2명째부터 과금). */}
          <p style={{ ...noteText, margin: 0 }}>
            요금은 재직 중인 <strong>직원</strong> 수(관리자는 1명까지 제외)로 정해집니다. 지금은 요금 대상 인원이 없어 계산할
            금액이 없습니다. <Link href="/employees" style={{ color: "var(--primary)", fontWeight: 700 }}>직원관리</Link>에서
            직원을 등록하시면 이 화면에 금액이 표시됩니다.
          </p>
        </div>
      ) : null}
      {q.kind === "quote" ? (
        <div style={{ ...cardPad, marginBottom: 16, borderLeft: "4px solid var(--primary)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>별도 협의가 필요한 규모입니다</div>
          <p style={{ ...noteText, margin: 0 }}>
            공개된 요금표는 {QUOTE_OVER}명까지입니다. 지금 {employees.toLocaleString("ko-KR")}명이라 요금을 따로
            안내드립니다. 이 화면 맨 아래 [요금·결제 문의]로 연락해 주시면 규모에 맞춰 제안드리겠습니다.
          </p>
        </div>
      ) : null}

      {/* ── 1-2. 결제 (2026-11-23 결제 2단계) ───────────────────────────── */}
      <div style={{ ...cardPad, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>결제</div>
        {pay ? (
          <p style={{ ...noteText, margin: "0 0 12px" }}>
            {paidActive && pay.paidUntil ? (
              <>유료 이용 기간: <strong>{formatKoreanDate(trialLastDay(pay.paidUntil))}</strong>까지입니다.</>
            ) : trial.expired ? (
              <>무료 기간이 끝났습니다. 결제하시면 오늘부터 1개월 이용 기간이 시작됩니다.</>
            ) : (
              <>
                지금 결제하셔도 남은 무료 기간은 그대로이고, 유료 1개월은 무료 기간이 끝난 다음 날(
                {formatKoreanDate(trial.endsAt)})부터 시작됩니다.
              </>
            )}{" "}
            결제는 1개월 단위이며 카드로만 받습니다. 결제하실 때만 청구되고 자동으로 다시 결제되지 않습니다.
          </p>
        ) : null}
        {q.kind !== "tier" ? (
          <p style={{ ...noteText, margin: 0 }}>지금은 결제할 금액이 없습니다.</p>
        ) : pay && !canPayNow && pay.ready ? (
          <p style={{ ...noteText, margin: 0 }}>
            이용 기간이 넉넉히 남아 있습니다. <strong>{formatKoreanDate(pay.canPayFrom)}</strong>부터 다음 달 이용료를 결제하실 수 있습니다.
          </p>
        ) : (
          <PayButton
            ready={!!pay?.ready}
            totalText={formatWon(q.total)}
            // 이용 기간이 남아 있는데 "1개월 결제하기"만 보이면 방금 결제한 것을 다시 내라는 것처럼 읽힌다(2단계 검수 치명 1 덧붙임).
            label={paidActive ? "다음 달 이용료 미리 결제하기" : undefined}
          />
        )}

        {payments.length > 0 ? (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12, overflowX: "auto" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>결제 내역(최근 12건)</div>
            <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-sub)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", fontWeight: 700 }}>결제일</th>
                  <th style={{ padding: "6px 8px", fontWeight: 700 }}>내용</th>
                  <th style={{ padding: "6px 8px", fontWeight: 700 }}>이용 기간</th>
                  <th style={{ padding: "6px 8px", fontWeight: 700, textAlign: "right" }}>금액</th>
                  <th style={{ padding: "6px 8px", fontWeight: 700 }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.orderNo} style={{ borderTop: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "8px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {formatKoreanDate(p.paidAt ?? p.createdAt)}
                    </td>
                    <td style={{ padding: "8px", wordBreak: "keep-all" }}>
                      {p.productName}
                      {p.cardName ? <span style={{ color: "var(--text-sub)" }}> · {p.cardName}{p.cardNoMasked ? ` ${p.cardNoMasked}` : ""}</span> : null}
                    </td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {p.periodStart && p.periodEnd ? `${formatKoreanDate(p.periodStart)} ~ ${formatKoreanDate(trialLastDay(p.periodEnd))}` : "—"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {formatWon(p.totalAmount)}
                    </td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap", fontWeight: 700, color: p.status === "paid" ? "var(--success, #15803D)" : p.status === "cancelled" ? "var(--text-sub)" : "var(--warning)" }}>
                      {p.status === "paid" ? "결제 완료" : p.status === "cancelled" ? "취소" : p.status === "cancel_check" ? "환불 진행 중" : "확인 중"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* ── 2. 무료 기간 · 다음 구간 ────────────────────────────────── */}
      <div className="split-2" style={{ marginBottom: 16 }}>
        <div style={cardPad}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>무료 이용 기간</div>
          {trial.expired ? (
            <p style={{ ...noteText, margin: 0 }}>
              무료 기간이 <strong>{formatKoreanDate(trialLastDay(trial.endsAt))}</strong>에 끝났습니다.
              {paidActive ? (
                <> 지금은 유료 이용 기간입니다(위 [결제] 참고).</>
              ) : (
                <>
                  {" "}지금도 모든 기능을 그대로 쓰실 수 있습니다 — 아직 아무것도 막지 않습니다.
                  계속 이용하시려면 위 [결제]에서 카드로 결제해 주세요.
                </>
              )}
            </p>
          ) : (
            <>
              <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, marginBottom: 8 }}>
                {trial.daysLeft}
                <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>일 남음</span>
              </div>
              <p style={{ ...noteText, margin: 0 }}>
                <strong>{formatKoreanDate(trialLastDay(trial.endsAt))}</strong>까지 무료입니다(가입일부터 {TRIAL_DAYS}일
                기준, 회사별로 따로 정한 경우는 그 날짜까지). 무료 기간이 끝나도 자동으로 결제되지 않습니다(결제는 직접 하실 때만).
              </p>
            </>
          )}
        </div>

        {/* 🔴 "금액을 먼저 보여 드리고 동의를 받습니다"라고 쓰지 않는다(검수 치명 1).
            그 절차(인상 동의 화면)도, 알림 발송 수단도, 결제도 **아직 없다.** 이 화면은 조회 전용이다.
            고객이 이 문구를 캡처해 두면, 결제를 붙인 뒤 요금이 오른 달에 그대로 분쟁 자료가 된다
            (1단계에서 홈화면의 "미리 알려드립니다"를 뺀 것과 같은 이유 — 지킬 주체가 없는 약속).
            → 지금 사실만 적는다. 동의 절차는 실제로 만드는 단계에서 그 화면과 함께 적는다. */}
        <div style={cardPad}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>직원이 늘면</div>
          {q.kind === "tier" && q.next ? (
            <p style={{ ...noteText, margin: 0 }}>
              지금 구간({q.label})에서는 직원이 늘어도 요금이 <strong>{formatWon(q.monthly)}</strong> 그대로입니다.
              <strong> {q.next.addMore}명</strong>을 더 등록하면 {q.next.label} 구간이 되어 월{" "}
              <strong>{formatWon(q.next.monthly)}</strong>(카드 {formatWon(withVat(q.next.monthly).total)})이 됩니다.
              직원이 늘어도 자동으로 결제되지 않습니다 — 새 금액은 다음에 직접 결제하실 때 적용됩니다.
            </p>
          ) : q.kind === "tier" ? (
            <p style={{ ...noteText, margin: 0 }}>
              공개 요금표의 마지막 구간({q.label})입니다. {QUOTE_OVER}명을 넘으면 요금을 따로 안내드립니다.
            </p>
          ) : (
            <p style={{ ...noteText, margin: 0 }}>
              요금은 구간제입니다. 구간 안에서는 직원이 늘어도 요금이 같고, 구간을 넘을 때만 오릅니다.
              자동으로 결제되는 것은 없습니다 — 결제는 직접 하실 때만 됩니다.
            </p>
          )}
        </div>
      </div>

      {/* ── 3. 전체 구간표 ─────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>요금 구간표</div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4, wordBreak: "keep-all" }}>
            전부 부가세 별도입니다. 괄호는 카드에서 빠지는 금액(부가세 포함)입니다.
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 480, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px" }}>
                  재직 직원
                </th>
                <th style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px" }}>
                  월 요금 (부가세 별도)
                </th>
              </tr>
            </thead>
            <tbody>
              {PRICE_TIERS.map((t, i) => {
                const label = tierLabel(i);
                if (!label) return null;
                const here = q.kind === "tier" && q.tierIndex === i;
                return (
                  <tr
                    key={t.max}
                    style={{
                      borderBottom: "1px solid #F3F4F6",
                      background: here ? "#EFF6FF" : undefined,
                    }}
                  >
                    <td style={{ padding: "12px 20px", fontSize: 15, verticalAlign: "middle", fontWeight: here ? 700 : 400 }}>
                      {label}
                      {here ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            height: 22,
                            padding: "0 8px",
                            marginLeft: 8,
                            borderRadius: 6,
                            background: "#DBEAFE",
                            color: "#1D4ED8",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          지금 우리 회사
                        </span>
                      ) : null}
                    </td>
                    <td
                      style={{
                        padding: "12px 20px",
                        fontSize: 15,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: here ? 700 : 400,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatWon(t.monthly)}
                      <span style={{ color: "var(--text-sub)", fontSize: 13, marginLeft: 6 }}>
                        ({formatWon(withVat(t.monthly).total)})
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ padding: "12px 20px", fontSize: 15, fontWeight: q.kind === "quote" ? 700 : 400 }}>
                  {QUOTE_OVER + 1}명 이상
                </td>
                <td style={{ padding: "12px 20px", fontSize: 15, textAlign: "right", color: "var(--text-sub)" }}>
                  별도 협의
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4. 유료 신청 안내 + 과금 규칙 ──────────────────────────── */}
      <div style={cardPad}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>유료 신청과 결제</div>
        <p style={{ ...noteText, margin: "0 0 12px" }}>
          화면에서 바로 결제하는 기능은 <strong>준비 중</strong>입니다. 준비되기 전에는 아무것도 자동으로
          결제되지 않고, 결제는 직접 신청하실 때만 시작됩니다. 유료 전환이나 요금을 상의하시려면 아래로
          연락해 주세요.
        </p>
        <Link
          href="/#contact"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 38,
            padding: "0 16px",
            borderRadius: 8,
            background: "var(--primary)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          요금·결제 문의
        </Link>

        {/* ⚠️ 제목에 "유료 전환 시 적용될"을 반드시 남긴다(검수 중간 2).
            결제일·일할 계산·하향 적용은 **코드에 아직 한 줄도 없다.** 이용약관 페이지도 없어서
            지금은 이 화면이 사실상 유일한 약관처럼 읽힌다 — "지금 그렇다"고 단정해 두면 나중에
            결제 구현이 조금만 달라져도 그대로 분쟁 자료가 된다. */}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>유료 전환 시 적용될 요금 기준</div>
          <ul style={{ ...noteText, margin: 0, paddingLeft: 18 }}>
            <li>재직 중인 <strong>직원</strong> 수로 셉니다. <strong>관리자는 1명까지</strong> 세지 않고, 2명째부터는 직원처럼 셉니다. 퇴사한 사람은 세지 않습니다.</li>
            <li>요금은 결제일의 인원으로 정하고, 월 중간에 들어오거나 나간 사람은 날짜로 쪼개 계산하지 않을 예정입니다.</li>
            <li>직원이 줄어 낮은 구간이 되면 <strong>다음 결제분부터</strong> 낮은 요금을 적용할 예정입니다.</li>
            <li>모든 금액은 부가세 별도입니다.</li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
