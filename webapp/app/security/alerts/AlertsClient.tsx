"use client";
// 이상 접속(관리자) — 공통 기간 달력 + 통합검색 + KPI + [확인함].
//  · 판정·회사격리·권한은 서버(page.tsx / lib/anomaly.ts)가 책임. 여기선 필터·표시만.
import { useMemo, useState } from "react";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import { markSecurityChecked } from "@/app/actions/security-alerts";

export type AlertRow = {
  id: string;
  kind: "blocked_retry" | "fail_burst" | "night_login";
  level: "high" | "mid";
  title: string;
  detail: string;
  who: string;
  ip: string;
  timeText: string;
  count: number;
  isNew: boolean;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle" };

// 종류 필터
const KIND_FILTERS = [
  { key: "all", label: "전체", kinds: [] as string[] },
  { key: "blocked_retry", label: "차단 IP 재시도", kinds: ["blocked_retry"] },
  { key: "fail_burst", label: "로그인 실패 반복", kinds: ["fail_burst"] },
  { key: "night_login", label: "심야 로그인", kinds: ["night_login"] },
];

const LEVEL_STYLE: Record<AlertRow["level"], { bg: string; color: string; label: string }> = {
  high: { bg: "#FEE2E2", color: "#B91C1C", label: "주의" },
  mid: { bg: "#FEF3C7", color: "#B45309", label: "참고" },
};

export function AlertsClient({
  rows,
  from,
  to,
  todayISO,
  capped,
  newCount,
  badgeDays,
  checkedAtText,
  rules,
}: {
  rows: AlertRow[];
  from: string;
  to: string;
  todayISO: string;
  capped: boolean;
  newCount: number;
  badgeDays: number;
  checkedAtText: string | null;
  rules: { nightOn: boolean; nightStart: number; nightEnd: number; failOn: boolean; failCount: number };
}) {
  const [q, setQ] = useState("");
  const [kindKey, setKindKey] = useState("all");

  const shown = useMemo(() => {
    const filter = KIND_FILTERS.find((f) => f.key === kindKey);
    const byKind = filter && filter.kinds.length ? rows.filter((r) => filter.kinds.includes(r.kind)) : rows;
    const terms = queryTerms(q);
    if (!terms.length) return byKind;
    return byKind.filter((r) => matchesTerms([r.title, r.detail, r.who, r.ip].join(" ").toLowerCase(), terms));
  }, [rows, q, kindKey]);

  const highCount = rows.filter((r) => r.level === "high").length;

  const hh = (n: number) => `${String(n).padStart(2, "0")}시`;

  return (
    <div>
      {/* 지금 켜져 있는 규칙 — 안 보이면 "왜 알림이 없지?"를 알 수 없다 */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.7 }}>
        지금 적용 중인 감지 기준: <b>차단 IP 재시도</b>(항상){" "}
        · <b>로그인 실패 반복</b> {rules.failOn ? `하루 ${rules.failCount}회 이상` : <span style={{ color: "var(--text-sub)" }}>꺼짐</span>}{" "}
        {/* 끝 시각은 미포함 — "22시~06시"라 쓰면 06:00 로그인도 뜰 것 같지만 안 뜬다. 정확히 "06시 전까지". */}
        · <b>심야 로그인</b> {rules.nightOn ? `${hh(rules.nightStart)}부터 ${hh(rules.nightEnd)} 전까지` : <span style={{ color: "var(--text-sub)" }}>꺼짐</span>}{" "}
        <a href="/settings" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none", marginLeft: 4 }}>기준 변경</a>
        <br />
        ※ 판정은 <b>지금 기준으로 매번 다시 계산</b>합니다 — 기준을 바꾸면 과거 기록의 표시도 함께 바뀝니다.
      </div>

      {capped && (
        <div style={{ background: "#FEF3C7", color: "#B45309", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 8, marginBottom: 12, lineHeight: 1.6 }}>
          ⚠️ 이 기간의 접속기록이 너무 많아 일부만 검사했습니다. 표시된 횟수가 실제보다 적을 수 있고,{" "}
          <b>일부 이상은 목록에 아예 나타나지 않을 수 있습니다.</b> 기간을 좁혀서 다시 봐주세요.
          {/* 축소 진술 금지 — "횟수가 적을 수 있다"고만 쓰면 관리자는 목록이 완전하다고 믿는다(검수 지적). */}
        </div>
      )}

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {[
          { label: "이상 접속 (선택 기간)", value: rows.length, color: "var(--text)" },
          { label: "주의 (선택 기간)", value: highCount, color: highCount > 0 ? "var(--danger)" : "var(--text-sub)" },
          // ⚠️ 이 KPI만 기준이 다르다 — 대시보드 배지와 같은 창(최근 N일). 라벨에 그 사실을 밝혀야
          //    "왜 위 숫자랑 안 맞지?"가 생기지 않는다.
          { label: `아직 확인 안 함 (최근 ${badgeDays}일)`, value: newCount, color: newCount > 0 ? "var(--warning)" : "var(--text-sub)" },
        ].map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 14, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              <span style={{ fontSize: 15, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>건</span>
            </div>
          </div>
        ))}
      </div>

      {/* 검색·기간·필터 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <RangeCalendarNav basePath="/security/alerts" from={from} to={to} todayISO={todayISO} />
        <SearchBox value={q} onChange={setQ} placeholder="이름·IP로 검색" />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {KIND_FILTERS.map((f) => {
            const on = f.key === kindKey;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setKindKey(f.key)}
                style={{
                  height: 38, padding: "0 14px", borderRadius: 8, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
                  border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
                  background: on ? "var(--primary)" : "#fff",
                  color: on ? "#fff" : "var(--text-sub)",
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {checkedAtText && <span style={{ fontSize: 12, color: "var(--text-sub)" }}>마지막 확인: {checkedAtText}</span>}
          {/* 이 버튼은 "지금 이 순간까지 발생한 이상 전체"를 확인 처리한다(보고 있는 기간과 무관).
              그러니 라벨도 "전부"라고 말해야 한다 — 화면 기간의 건수를 라벨로 쓰면 관리자가 본 적 없는
              과거 경보까지 조용히 끄면서 "N건 확인"이라 말하는 거짓말이 된다(검수 지적). */}
          <form action={markSecurityChecked}>
            <button
              type="submit"
              disabled={newCount === 0}
              title="지금까지 발생한 이상을 모두 확인한 것으로 표시합니다(보고 있는 기간과 무관)."
              style={{
                height: 38, padding: "0 16px", borderRadius: 8, border: "1px solid var(--border)",
                background: newCount > 0 ? "var(--primary)" : "#fff",
                color: newCount > 0 ? "#fff" : "var(--text-sub)",
                fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
                cursor: newCount > 0 ? "pointer" : "default",
              }}
            >
              {newCount > 0 ? `${newCount}건 모두 확인` : "모두 확인됨"}
            </button>
          </form>
        </div>
      </div>

      {/* 목록 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>마지막 발생</th>
                <th style={th}>내용</th>
                <th style={th}>관련자</th>
                <th style={th}>IP</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "36px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center", lineHeight: 1.7 }}>
                    {rows.length === 0 ? (
                      <>
                        이 기간에 이상 접속이 없습니다. 👍
                        <br />
                        <span style={{ fontSize: 13 }}>수상한 접속이 생기면 여기와 대시보드에 표시됩니다.</span>
                      </>
                    ) : (
                      "조건에 맞는 이상 접속이 없습니다."
                    )}
                  </td>
                </tr>
              ) : (
                shown.map((r) => {
                  const st = LEVEL_STYLE[r.level];
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6", background: r.isNew ? "#FFFBEB" : undefined }}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: "var(--text-sub)", whiteSpace: "nowrap" }}>{r.timeText}</td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
                            {st.label}
                          </span>
                          <span style={{ fontWeight: 700 }}>{r.title}</span>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4 }}>{r.detail}</div>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{r.who}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.ip}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {/* 차단 IP 재시도는 이미 막힌 것 — 또 막을 게 없다. 나머지는 차단 화면으로 보낸다. */}
                        {r.kind !== "blocked_retry" && r.ip !== "—" && (
                          <a
                            href="/security/blocked"
                            style={{ display: "inline-block", height: 30, lineHeight: "28px", padding: "0 10px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", fontSize: 12, fontWeight: 700, color: "var(--text-sub)", textDecoration: "none", whiteSpace: "nowrap" }}
                          >
                            차단 검토
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.7 }}>
        · 같은 IP의 반복 시도는 <b>한 줄로 묶어</b> 횟수로 보여줍니다(하루 수천 건이 그대로 쌓이면 오히려 아무것도 못 봅니다).
        <br />· 노란 배경 = 아직 확인하지 않은 이상입니다. <b>[모두 확인]은 지금까지 발생한 이상 전체</b>를 확인 처리합니다(보고 있는 기간과 무관).
        <br />· 로그인 실패는 <b>자정을 기준으로 하루씩 끊어</b> 셉니다. 자정을 걸쳐 나눠 시도하면 각각 따로 세어져 기준에 안 걸릴 수 있습니다(이때는 <b>5회 실패 계정 잠금</b>이 함께 막습니다).
        <br />· 접속 위치(IP) 판정은 <b>서버 설정에 따라 달라집니다</b>. 배포 시 설정이 없으면 모든 직원이 같은 IP로 보여 실패 알림이 잘못 뜰 수 있습니다.
        <br />· 이메일·문자 알림은 <b>서버 배포 후 지원 예정</b>입니다. 지금은 이 화면과 대시보드에서 확인해주세요.
      </div>
    </div>
  );
}
