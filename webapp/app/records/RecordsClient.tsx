"use client";
// 근태현황 표 + 검색 (클라이언트) — 커스텀 달력 팝업으로 기간을 고르고, 검색어는 타이핑 즉시 필터한다.
//  · 기간(from~to)은 URL로 서버 조회 → 날짜를 바꾸면 router.push 로 서버가 그 기간 데이터를 다시 불러온다.
//  · 통합검색은 브라우저에서 즉시 필터(서버 왕복 없음). 여러 단어는 공백/쉼표로 구분해 OR(하나라도 포함) 검색.
//  · KPI·위조배너 숫자도 걸러진 목록 기준으로 함께 갱신된다.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// 서버(page.tsx)에서 미리 계산해 넘겨주는 한 줄의 표시값(직렬화 가능한 순수 객체)
export type RecordRow = {
  id: string;
  userId: string;
  userName: string;
  initial: string;
  dateText: string;
  dateISO: string;
  workMode: string;
  location: string;
  inText: string;
  outText: string;
  hasClockOut: boolean;
  holiday: boolean;
  late: boolean | null;
  worked: string;
  suspect: boolean;
  review: boolean;
  isWorkingNow: boolean;
  search: string; // 위 컬럼들을 합쳐 소문자로 만든 검색용 문자열
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function RecordsClient({
  rows,
  from,
  to,
  hasRule,
  todayISO,
}: {
  rows: RecordRow[];
  from: string;
  to: string;
  hasRule: boolean;
  todayISO: string;
}) {
  const [q, setQ] = useState("");

  // ── 통합검색(OR) ─────────────────────────────
  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (terms.length === 0) return rows;
    return rows.filter((r) => terms.some((t) => r.search.includes(t)));
  }, [q, rows]);

  const total = filtered.length;
  const working = filtered.filter((r) => r.isWorkingNow).length;
  const lateCount = filtered.filter((r) => r.late === true).length;
  const suspectCount = filtered.filter((r) => r.suspect).length;
  const reviewCount = filtered.filter((r) => r.review).length;

  const kpis = [
    { label: "출근 기록", value: `${total}`, unit: "건", color: "var(--text)" },
    { label: "지각", value: hasRule ? `${lateCount}` : "—", unit: hasRule ? "건" : "", color: lateCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "근무 중", value: `${working}`, unit: "명", color: working > 0 ? "var(--success)" : "var(--text)" },
  ];

  return (
    <>
      {/* 검색바: 커스텀 달력 + 통합검색(절반 폭·실시간) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <RangeCalendar from={from} to={to} todayISO={todayISO} />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="검색어(여러 개는 띄어쓰기 = OR)"
          aria-label="통합 검색"
          style={{ width: 240, maxWidth: "100%", height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontSize: 14, fontFamily: "inherit" }}
        />
        {q.trim() && (
          <button
            type="button"
            onClick={() => setQ("")}
            style={{ height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            지우기
          </button>
        )}
      </div>

      <div className="kpi-grid-3" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              {k.unit && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {(suspectCount > 0 || reviewCount > 0) && (
        <div style={{ background: suspectCount > 0 ? "#FEE2E2" : "#FEF3C7", border: `1px solid ${suspectCount > 0 ? "#FCA5A5" : "#FCD34D"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 14, fontWeight: 700, color: suspectCount > 0 ? "#B91C1C" : "#B45309" }}>
          ⚠ {q.trim() ? "검색된 목록 중" : "이 기간에"}{suspectCount > 0 ? ` 위조 의심 ${suspectCount}건` : ""}{suspectCount > 0 && reviewCount > 0 ? "," : ""}{reviewCount > 0 ? ` 확인 필요(판독 실패) ${reviewCount}건` : ""}이 있습니다. 이름 옆 표시를 눌러 사진을 확인하세요.
        </div>
      )}

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>날짜</th>
                <th style={th}>이름</th>
                <th style={th}>근무형태</th>
                <th style={th}>위치</th>
                <th style={th}>출근</th>
                <th style={th}>퇴근</th>
                <th style={th}>지각</th>
                <th style={{ ...th, textAlign: "right" }}>실근무</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "이 기간에 출퇴근 기록이 없습니다."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.dateText}</td>
                    <td style={td}>
                      <Link href={`/records/${r.userId}?date=${r.dateISO}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                          {r.initial}
                        </div>
                        <span style={{ fontWeight: 700 }}>{r.userName}</span>
                        {r.suspect ? (
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#B91C1C", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>⚠ 위조 의심</span>
                        ) : r.review ? (
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#D97706", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>❓ 확인 필요</span>
                        ) : null}
                      </Link>
                    </td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{r.workMode}</td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{r.location}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.inText}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.hasClockOut ? "var(--text)" : "var(--text-sub)" }}>{r.outText}</td>
                    <td style={td}>
                      {r.holiday ? (
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#6D28D9" }}>휴일근무</span>
                      ) : r.late === null ? (
                        <span style={{ color: "#9CA3AF" }}>—</span>
                      ) : r.late ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#FEF3C7" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>지각</span>
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>정상</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{r.worked}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6 }}>
        이름을 누르면 그 직원의 날짜별 상세 기록을 볼 수 있습니다. 지각 판정은 [설정 → 근무제·기준시간]을 정해야 표시됩니다.
      </div>
    </>
  );
}

// ── 커스텀 달력 팝업(기간 선택) ─────────────────────────────
function RangeCalendar({ from, to, todayISO }: { from: string; to: string; todayISO: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // 화면에 보여줄 달(첫날), 선택 중인 시작/종료
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const [y, m] = from.split("-").map(Number);
    return { y, m: (m || 1) - 1 };
  });
  const [selStart, setSelStart] = useState<string | null>(from);
  const [selEnd, setSelEnd] = useState<string | null>(to);

  function openCal() {
    // 열 때 현재 기간으로 초기화
    const [y, m] = from.split("-").map(Number);
    setView({ y, m: (m || 1) - 1 });
    setSelStart(from);
    setSelEnd(to);
    setOpen(true);
  }

  function pick(iso: string) {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(iso);
      setSelEnd(null);
    } else {
      // 시작만 정해진 상태 → 종료 확정(거꾸로 고르면 자동으로 뒤바꿈)
      if (iso < selStart) {
        setSelEnd(selStart);
        setSelStart(iso);
      } else {
        setSelEnd(iso);
      }
    }
  }

  function apply() {
    const f = selStart ?? from;
    const t = selEnd ?? selStart ?? to;
    setOpen(false);
    router.push(`/records?from=${f}&to=${t}`);
  }

  function setPreset(days: number) {
    // 오늘 기준 최근 N일(0이면 오늘 하루)
    const [ty, tm, tdd] = todayISO.split("-").map(Number);
    const end = new Date(ty, tm - 1, tdd);
    const startD = new Date(ty, tm - 1, tdd - days);
    const s = isoOf(startD.getFullYear(), startD.getMonth(), startD.getDate());
    setSelStart(s);
    setSelEnd(todayISO);
    setView({ y: startD.getFullYear(), m: startD.getMonth() });
  }

  // 달력 그리드
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const lo = selStart && selEnd ? (selStart < selEnd ? selStart : selEnd) : selStart;
  const hi = selStart && selEnd ? (selStart < selEnd ? selEnd : selStart) : selStart;

  const shiftMonth = (dir: number) => {
    const d = new Date(view.y, view.m + dir, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={openCal}
        style={{ height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
      >
        📅 <span style={{ fontVariantNumeric: "tabular-nums" }}>{from} ~ {to}</span>
      </button>

      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: 44, left: 0, zIndex: 41, width: 300, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 14 }}>
            {/* 빠른 선택 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {[{ l: "오늘", d: 0 }, { l: "최근 7일", d: 6 }, { l: "최근 30일", d: 29 }].map((p) => (
                <button key={p.l} type="button" onClick={() => setPreset(p.d)} style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 999, background: "#F9FAFB", color: "var(--text-sub)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {p.l}
                </button>
              ))}
            </div>

            {/* 월 이동 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button type="button" onClick={() => shiftMonth(-1)} style={navBtn}>◀</button>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{view.y}년 {view.m + 1}월</div>
              <button type="button" onClick={() => shiftMonth(1)} style={navBtn}>▶</button>
            </div>

            {/* 요일 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
              {WEEK.map((w, i) => (
                <div key={w} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: i === 0 ? "#DC2626" : i === 6 ? "#2563EB" : "var(--text-sub)", padding: "4px 0" }}>{w}</div>
              ))}
            </div>

            {/* 날짜 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
              {cells.map((d, i) => {
                if (d === null) return <div key={`e${i}`} />;
                const iso = isoOf(view.y, view.m, d);
                const isEndpoint = iso === selStart || iso === selEnd;
                const inRange = !!lo && !!hi && iso >= lo && iso <= hi;
                const isToday = iso === todayISO;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pick(iso)}
                    style={{
                      height: 34, border: "none", borderRadius: 8, cursor: "pointer",
                      fontSize: 13, fontWeight: isEndpoint ? 800 : 600, fontFamily: "inherit",
                      background: isEndpoint ? "var(--primary)" : inRange ? "#DBEAFE" : "transparent",
                      color: isEndpoint ? "#fff" : inRange ? "#1D4ED8" : "var(--text)",
                      outline: isToday && !isEndpoint ? "1px solid var(--primary)" : "none",
                      outlineOffset: -1,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>

            {/* 선택 요약 + 적용 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
                {selStart ?? "—"} ~ {selEnd ?? selStart ?? "—"}
              </div>
              <button type="button" onClick={apply} style={{ height: 34, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                적용
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
  fontWeight: 700, cursor: "pointer",
};
