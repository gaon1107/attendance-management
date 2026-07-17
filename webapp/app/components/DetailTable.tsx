// 근태 상세 표(직원별/내근태 공용) — KPI(근무일수·실근무·지각·결근) + 날짜별 표(출퇴근·결근·휴일근무).
// showLiveness(기본 꺼짐): 관리자 화면에서만 켜는 "본인 확인" 열 — 출퇴근 사진 판독 결과·사진 열람.
//   직원 본인 화면(내근태)에는 절대 켜지 않는다(조용한 표시 원칙 — 직원에게 판독 사실을 노출하지 않음).
import { formatMinutes } from "@/lib/worktime";
import { workModeLabel, locationLabel, hhmm, monthDayDow } from "@/lib/labels";
import type { DayDetail, ClockPhotoLite } from "@/lib/dayentries";

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

// 출근/퇴근 사진 1건의 판독 표시 — 상태를 색 배지로 직관화(위조=빨강 / 정상=초록 / 판독실패=회색) + 사진 보기 버튼
function PhotoBadge({ p, label }: { p: ClockPhotoLite; label: string }) {
  // 상태별 색·문구
  let bg: string, color: string, text: string;
  if (p.livenessStatus === "suspect") { bg = "#FEE2E2"; color = "#B91C1C"; text = "⚠ 위조 의심"; }
  else if (p.livenessStatus === "ok") { bg = "#DCFCE7"; color = "#15803D"; text = "✓ 정상"; }
  else { bg = "#F3F4F6"; color = "#6B7280"; text = "판독 실패"; }
  const scoreText = p.livenessScore === null ? "" : ` ${Math.round(p.livenessScore * 100)}%`;
  const suspect = p.livenessStatus === "suspect";
  // 부정 방지 재검토가 필요한 위조 의심(suspect)·판독 실패(error)만 [사진 보기]를 연다(감시 우려 축소).
  //   화이트리스트로 판정한다 — 서버 API(route.ts ⑤)와 동일 기준. 모르는 상태는 안 여는 쪽(fail-safe).
  const viewable = p.livenessStatus === "suspect" || p.livenessStatus === "error";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, borderRadius: 6, padding: "2px 8px" }}>
        {text}{scoreText}
      </span>
      {p.fileDeletedAt ? (
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>(사진 파기됨)</span>
      ) : !viewable ? (
        // 정상 확인 건 — 사진은 열지 않는다(개인정보 최소열람). 판정 결과 배지만 남긴다.
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>(정상 · 열람 제한)</span>
      ) : (
        // 위조 의심이면 사진 보기를 버튼처럼 강조(관리자가 바로 눌러 확인)
        <a
          href={`/api/clock-photo/${p.id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11, fontWeight: 700, textDecoration: "none",
            borderRadius: 6, padding: "2px 8px",
            ...(suspect
              ? { background: "#B91C1C", color: "#fff" }
              : { border: "1px solid var(--border)", color: "var(--primary)" }),
          }}
        >
          📷 사진 보기
        </a>
      )}
    </span>
  );
}

// "본인 확인" 셀 — 그 날 출퇴근의 판독 결과 요약. 위조 의심이 하나라도 있으면 상단에 빨간 배지로 강하게 알린다.
function LivenessCell({ photos }: { photos?: ClockPhotoLite[] }) {
  if (!photos || photos.length === 0) return <span style={{ color: "#9CA3AF" }}>—</span>;
  const hasSuspect = photos.some((p) => p.livenessStatus === "suspect");
  const ins = photos.filter((p) => p.kind === "in");
  const outs = photos.filter((p) => p.kind === "out");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {hasSuspect && (
        <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#B91C1C", borderRadius: 6, padding: "3px 9px", alignSelf: "flex-start" }}>
          ⚠ 위조 의심 — 사진 확인 필요
        </span>
      )}
      <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap" }}>
        {ins.map((p) => <PhotoBadge key={p.id} p={p} label="출근" />)}
        {outs.map((p) => <PhotoBadge key={p.id} p={p} label="퇴근" />)}
      </span>
    </div>
  );
}

export function DetailTable({ detail, showLiveness = false }: { detail: DayDetail; showLiveness?: boolean }) {
  const { entries, totalMinutes, days, lateCount, earlyLeaveCount, absentCount, hasRule, hasEndRule } = detail;

  const kpis = [
    { label: "근무일수", value: `${days}`, unit: "일", color: "var(--text)" },
    { label: "실근무 합계", value: formatMinutes(totalMinutes), unit: "", color: "var(--primary)" },
    { label: "지각", value: hasRule ? `${lateCount}` : "—", unit: hasRule ? "건" : "", color: lateCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "조퇴", value: hasEndRule ? `${earlyLeaveCount}` : "—", unit: hasEndRule ? "건" : "", color: earlyLeaveCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "결근", value: `${absentCount}`, unit: "일", color: absentCount > 0 ? "var(--danger)" : "var(--text)" },
  ];

  return (
    <>
      <div className="kpi-grid-5" style={{ marginBottom: 16 }}>
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

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>날짜</th>
                <th style={th}>근무형태</th>
                <th style={th}>위치</th>
                <th style={th}>출근</th>
                <th style={th}>퇴근</th>
                <th style={th}>지각/조퇴</th>
                <th style={th}>외출</th>
                <th style={{ ...th, textAlign: "right" }}>실근무</th>
                {showLiveness && <th style={th}>본인 확인</th>}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={showLiveness ? 9 : 8} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    이 기간에 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                entries.map((e, i) => {
                  if (e.type === "absent") {
                    return (
                      <tr key={`a${i}`} style={{ borderBottom: "1px solid #F3F4F6", background: "#FEF2F2" }}>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{monthDayDow(e.date)}</td>
                        <td style={{ ...td, color: "#9CA3AF" }} colSpan={4}>—</td>
                        <td style={td}><span style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>결근</span></td>
                        <td style={{ ...td, color: "#9CA3AF" }}>—</td>
                        <td style={{ ...td, textAlign: "right", color: "#9CA3AF" }}>—</td>
                        {showLiveness && <td style={{ ...td, color: "#9CA3AF" }}>—</td>}
                      </tr>
                    );
                  }
                  if (e.type === "leave") {
                    return (
                      <tr key={`l${i}`} style={{ borderBottom: "1px solid #F3F4F6", background: "#EFF6FF" }}>
                        <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{monthDayDow(e.date)}</td>
                        <td style={{ ...td, color: "#9CA3AF" }} colSpan={4}>—</td>
                        <td style={td}><span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>휴가 · {e.label}</span></td>
                        <td style={{ ...td, color: "#9CA3AF" }}>—</td>
                        <td style={{ ...td, textAlign: "right", color: "#9CA3AF" }}>—</td>
                        {showLiveness && <td style={{ ...td, color: "#9CA3AF" }}>—</td>}
                      </tr>
                    );
                  }
                  const r = e.rec;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{monthDayDow(r.clockIn)}</td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{workModeLabel(r.workMode)}</td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{locationLabel(r.locationStatus)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{hhmm(r.clockIn)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.clockOut ? "var(--text)" : "var(--text-sub)" }}>
                        {r.clockOut ? hhmm(r.clockOut) : "근무 중"}
                      </td>
                      <td style={td}>
                        {e.holiday ? (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#6D28D9" }}>휴일근무</span>
                        ) : e.approvedLeave || e.late || e.early ? (
                          // 승인 반차/조퇴(파랑)와 자동 지각/조퇴(주황)를 함께 표시. 승인이 있으면 그날은 지각·조퇴가 면제됨.
                          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                            {e.approvedLeave && <span style={{ fontSize: 13, fontWeight: 700, color: "#1D4ED8" }}>{e.approvedLeave}</span>}
                            {e.late && <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>지각</span>}
                            {e.early && <span style={{ fontSize: 13, fontWeight: 700, color: "#C2410C" }}>조퇴</span>}
                          </span>
                        ) : e.late === null && e.early === null ? (
                          <span style={{ color: "#9CA3AF" }}>—</span>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>정상</span>
                        )}
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>
                        {r.breaks.length === 0 ? (
                          <span style={{ color: "#9CA3AF" }}>0회</span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {[...r.breaks].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).map((b, i) => (
                              <span key={i} style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                                <span style={{ color: "var(--text-sub)", marginRight: 5 }}>{b.reason}</span>
                                <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                                  {hhmm(b.startAt)}~{b.endAt ? hhmm(b.endAt) : ""}
                                </span>
                                {!b.endAt && <span style={{ color: "var(--warning)", fontWeight: 700, marginLeft: 5 }}>외출 중</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{formatMinutes(e.minutes)}</td>
                      {showLiveness && <td style={td}><LivenessCell photos={r.clockPhotos} /></td>}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
