"use client";
// 일정 캘린더(클라이언트) — 월 그리드 + 날짜 클릭 시 모달로 일정/휴무일 관리.
//  · 법정공휴일(빨강, 읽기전용) · 회사 휴무일(보라 배지) · 회사 일정(막대) 표시.
//  · 등록/삭제는 서버액션(addEvent/deleteEvent + 기존 add/deleteCompanyHoliday)으로. 저장 후 목록은 서버 재검증으로 갱신.
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { addEvent, deleteEvent } from "@/app/actions/schedule";
import { addCompanyHoliday, deleteCompanyHoliday } from "@/app/actions/holidays";
import { createNotice, deleteNotice } from "@/app/actions/notice";
import { DatePicker } from "@/app/components/DatePicker";

export type DayData = {
  nationalHoliday?: string; // 법정공휴일 이름(읽기전용)
  companyHoliday?: { id: string; name: string }; // 회사 휴무일
  // 일정. mine=내가 삭제 가능한지 / personal=개인 일정(true)인지 회사 일정(false)인지.
  events: { id: string; title: string; color: string | null; mine: boolean; personal: boolean }[];
  // 공지(사내 공지사항) — 올린 날(작성일) 칸에 표시. 본문은 모달에서 읽는다.
  notices?: { id: string; title: string; body: string; authorName: string }[];
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const EVENT_BG = "#2563EB"; // 회사 일정(파랑)
const PERSONAL_BG = "#059669"; // 개인 일정(초록) — 직원이 자기 일정을 구분하기 쉽게
const NOTICE_BG = "#D97706"; // 공지(주황) — 일정과 구분

const navBtn: React.CSSProperties = {
  width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
  fontWeight: 700, cursor: "pointer", textDecoration: "none", fontSize: 15,
};

export function ScheduleCalendar({
  year, month, todayISO, byDate, prevYm, nextYm, todayYm, canManageCompany,
}: {
  year: number; month: number; todayISO: string;
  byDate: Record<string, DayData>;
  prevYm: string; nextYm: string; todayYm: string;
  canManageCompany: boolean; // 관리자만 회사 일정·휴무일 관리. 직원은 개인 일정만.
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      {/* 헤더: 안내 + 월 이동 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>일정 캘린더</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4 }}>
          {canManageCompany
            ? "날짜를 클릭해 회사 일정을 등록하거나 그 날을 휴무일로 지정하세요. 공지는 아래 '공지 작성'으로 올리며 표시 날짜를 지정할 수 있습니다. (법정공휴일은 빨간색으로 자동 표시)"
            : "회사 공휴일·휴무일·공지·일정은 보기만 할 수 있고, 날짜를 클릭해 내 개인 일정을 추가할 수 있어요. (개인 일정은 나만 봅니다)"}
        </div>
      </div>

      {/* 관리자 공지 작성 — 공지는 '오늘 날짜'로 등록되어 전 직원에게 알림이 간다(작성일 칸에 표시). */}
      {canManageCompany && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: composeOpen ? 16 : 0, marginBottom: 14, background: "#FFFBEB" }}>
          {!composeOpen ? (
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              style={{ width: "100%", height: 44, border: "none", borderRadius: 10, background: "#FFFBEB", color: "#B45309", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              📢 공지 작성
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#92400E" }}>📢 새 공지 작성 <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-sub)" }}>(표시 날짜 지정 · 전 직원 알림)</span></div>
                <button type="button" onClick={() => setComposeOpen(false)} style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 7, background: "#fff", color: "var(--text-sub)", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>✕</button>
              </div>
              <NoticeCompose onDone={() => setComposeOpen(false)} defaultDate={todayISO} />
            </>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Link href={`/schedule?ym=${prevYm}`} style={navBtn}>‹</Link>
          <Link href={`/schedule?ym=${nextYm}`} style={navBtn}>›</Link>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{year}년 {month + 1}월</div>
        <Link href={`/schedule?ym=${todayYm}`} style={{ ...navBtn, width: "auto", padding: "0 14px", fontSize: 13 }}>오늘</Link>
      </div>

      {/* 요일 헤더 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
        {WEEK.map((w, i) => (
          <div key={w} style={{ textAlign: "center", fontSize: 13, fontWeight: 700, padding: "8px 0", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", color: i === 0 ? "#DC2626" : i === 6 ? "#2563EB" : "var(--text-sub)" }}>{w}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderLeft: "1px solid var(--border)" }}>
        {cells.map((d, idx) => {
          if (d === null) return <div key={`b${idx}`} style={{ borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "#FAFAFA", minHeight: 104 }} />;
          const iso = isoOf(year, month, d);
          const dow = (firstWeekday + d - 1) % 7;
          const data = byDate[iso];
          const isToday = iso === todayISO;
          // 공휴일·회사휴무일·일요일이면 빨강, 토요일이면 파랑, 그 외 기본색
          const dayColor = data?.nationalHoliday || data?.companyHoliday || dow === 0 ? "#DC2626" : dow === 6 ? "#2563EB" : "var(--text)";
          const shownNotices = data?.notices?.slice(0, 2) ?? [];
          const shownEvents = data?.events?.slice(0, 3) ?? [];
          const moreCount =
            ((data?.notices?.length ?? 0) - shownNotices.length) +
            ((data?.events?.length ?? 0) - shownEvents.length);

          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelected(iso)}
              style={{
                borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                background: isToday ? "#FFFBEB" : "#fff",
                minHeight: 104, padding: 6, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", gap: 3, overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: dayColor, fontVariantNumeric: "tabular-nums" }}>{d}</span>
                {isToday && <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309" }}>오늘</span>}
              </div>
              {data?.nationalHoliday && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.nationalHoliday}</span>
              )}
              {data?.companyHoliday && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6D28D9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>휴무 · {data.companyHoliday.name}</span>
              )}
              {shownNotices.map((nt) => (
                <span key={nt.id} style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: NOTICE_BG, borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  📢 {nt.title}
                </span>
              ))}
              {shownEvents.map((ev) => (
                <span key={ev.id} style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: ev.color || (ev.personal ? PERSONAL_BG : EVENT_BG), borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ev.title}
                </span>
              ))}
              {moreCount > 0 && <span style={{ fontSize: 10, color: "var(--text-sub)", fontWeight: 700 }}>+{moreCount}건 더</span>}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14, fontSize: 12, color: "var(--text-sub)" }}>
        <Legend color="#DC2626" label="법정공휴일(자동)" />
        <Legend color="#6D28D9" label="회사 휴무일" />
        <Legend color={EVENT_BG} label="회사 일정" />
        <Legend color={NOTICE_BG} label="공지" />
        {!canManageCompany && <Legend color={PERSONAL_BG} label="내 일정" />}
      </div>

      {selected && (
        <DayModal
          key={selected}
          iso={selected}
          data={byDate[selected]}
          canManageCompany={canManageCompany}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

// 하루 상세 모달 — 그 날 공휴일/휴무일/일정. 관리자는 회사 일정·휴무일 관리, 직원은 개인 일정만.
function DayModal({ iso, data, canManageCompany, onClose }: { iso: string; data: DayData | undefined; canManageCompany: boolean; onClose: () => void }) {
  const [addEvState, addEvAction, addEvPending] = useActionState(addEvent, {});
  const [delEvState, delEvAction] = useActionState(deleteEvent, {});
  const [addHolState, addHolAction, addHolPending] = useActionState(addCompanyHoliday, {});
  const [delHolState, delHolAction] = useActionState(deleteCompanyHoliday, {});

  const [y, m, d] = iso.split("-").map(Number);
  const dow = WEEK[new Date(y, m - 1, d).getDay()];
  const events = data?.events ?? [];
  const notices = data?.notices ?? [];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 50 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 51, width: "min(440px, 92vw)", maxHeight: "86vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{y}. {m}. {d}. ({dow})</div>
          <button type="button" onClick={onClose} style={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", cursor: "pointer", fontSize: 16, fontWeight: 700 }}>✕</button>
        </div>

        {/* 법정공휴일(읽기전용) */}
        {data?.nationalHoliday && (
          <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
            법정공휴일 · {data.nationalHoliday} <span style={{ fontWeight: 400, color: "var(--text-sub)" }}>(자동, 해제 불가)</span>
          </div>
        )}

        {/* 공지(사내 공지) — 그 날 올라온 공지 본문을 읽는다. 관리자는 삭제 가능. */}
        {notices.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#B45309" }}>📢 공지</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notices.map((nt) => (
                <div key={nt.id} style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#92400E", lineHeight: 1.4 }}>{nt.title}</div>
                    {canManageCompany && (
                      <form action={deleteNotice}>
                        <input type="hidden" name="id" value={nt.id} />
                        <button type="submit" style={{ height: 26, padding: "0 8px", border: "1px solid #FDE68A", borderRadius: 6, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>삭제</button>
                      </form>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap", marginTop: 6 }}>{nt.body}</div>
                  <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 8 }}>{nt.authorName}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 회사 휴무일 — 관리자만 지정/해제. 직원에겐 "휴무일" 안내만(있을 때). */}
        {canManageCompany ? (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>회사 휴무일 <span style={{ fontWeight: 400, color: "var(--text-sub)" }}>(지정하면 지각·결근 판정에서 제외)</span></div>
            {data?.companyHoliday ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#6D28D9", flex: 1 }}>휴무 · {data.companyHoliday.name}</span>
                <form action={delHolAction}>
                  <input type="hidden" name="id" value={data.companyHoliday.id} />
                  <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>휴무 해제</button>
                </form>
              </div>
            ) : (
              <form action={addHolAction} style={{ display: "flex", gap: 8 }}>
                <input type="hidden" name="date" value={iso} />
                <input name="name" defaultValue="휴무일" maxLength={50} style={{ flex: 1, height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
                <button type="submit" disabled={addHolPending} style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 8, background: "#6D28D9", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: addHolPending ? "default" : "pointer", opacity: addHolPending ? 0.6 : 1, whiteSpace: "nowrap" }}>휴무 지정</button>
              </form>
            )}
            {addHolState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{addHolState.error}</div>}
            {delHolState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{delHolState.error}</div>}
          </div>
        ) : (
          data?.companyHoliday && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginBottom: 14, fontSize: 13, fontWeight: 700, color: "#6D28D9" }}>
              회사 휴무일 · {data.companyHoliday.name}
            </div>
          )
        )}

        {/* 일정 — 회사 일정(파랑)은 보기 전용(삭제는 관리자만=mine), 개인 일정(초록)은 본인만 삭제 */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>일정</div>
          {events.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 10 }}>등록된 일정이 없습니다.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {events.map((ev) => (
                <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: ev.color || (ev.personal ? PERSONAL_BG : EVENT_BG), flexShrink: 0 }} />
                  <span style={{ fontSize: 14, flex: 1, wordBreak: "break-word" }}>{ev.title}</span>
                  {ev.personal && <span style={{ fontSize: 11, fontWeight: 700, color: PERSONAL_BG, flexShrink: 0 }}>내 일정</span>}
                  {ev.mine ? (
                    <form action={delEvAction}>
                      <input type="hidden" name="id" value={ev.id} />
                      <button type="submit" style={{ height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>삭제</button>
                    </form>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", flexShrink: 0 }}>회사</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 추가 폼 — 관리자=회사 일정 / 직원=내 개인 일정 */}
          <form action={addEvAction} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="date" value={iso} />
            <input name="title" required placeholder={canManageCompany ? "회사 일정 내용(예: 월례회의)" : "내 일정 내용(예: 병원 예약)"} maxLength={100} style={{ flex: 1, height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
            <button type="submit" disabled={addEvPending} style={{ height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: canManageCompany ? "var(--primary)" : PERSONAL_BG, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: addEvPending ? "default" : "pointer", opacity: addEvPending ? 0.6 : 1, whiteSpace: "nowrap" }}>{canManageCompany ? "추가" : "내 일정 추가"}</button>
          </form>
          {!canManageCompany && <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 6 }}>회사 일정·휴무일은 관리자만 등록합니다. 여기서 추가하면 <b>나만 보는 개인 일정</b>이 됩니다.</div>}
          {addEvState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{addEvState.error}</div>}
          {delEvState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{delEvState.error}</div>}
        </div>
      </div>
    </>
  );
}

// 공지 작성 폼(관리자, 캘린더 상단) — 표시 날짜+제목+내용. 등록되면 지정 날짜 칸에 표시되고 입력창을 비운다.
function NoticeCompose({ onDone, defaultDate }: { onDone: () => void; defaultDate: string }) {
  const [state, formAction, pending] = useActionState(createNotice, {});
  // 등록 성공 시 폼을 닫는다 → 다음에 열면 컴포넌트가 새로 떠서 날짜 선택기가 기본(오늘)으로 초기화된다.
  // (등록 결과는 캘린더에 바로 반영되므로 성공을 눈으로 확인 가능하다.)
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state?.ok, onDone]);
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0 12px", height: 42, border: "1px solid #D1D5DB", borderRadius: 8,
    fontFamily: "inherit", fontSize: 14, color: "var(--text)", outline: "none", background: "#fff",
  };

  return (
    <form
      action={async (fd) => {
        const res = await formAction(fd);
        void res;
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 6 }}>표시 날짜 <span style={{ fontWeight: 400, color: "var(--text-sub)" }}>(이 날짜 칸에 공지가 표시됩니다 · 기본 오늘)</span></label>
        <DatePicker name="date" defaultValue={defaultDate} allowClear={false} placeholder="날짜 선택" />
      </div>
      <input name="title" type="text" placeholder="공지 제목 (예: 7월 워크샵 안내)" maxLength={100} style={inputStyle} />
      <textarea name="body" rows={3} maxLength={5000} placeholder="공지 내용을 입력하세요." style={{ ...inputStyle, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }} />
      {state?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 12, color: "var(--success)", fontWeight: 700 }}>공지를 등록했습니다.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={pending}
          style={{ height: 42, border: "none", borderRadius: 8, background: "#B45309", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 22px" }}
        >
          {pending ? "등록 중..." : "공지 등록"}
        </button>
        <button type="button" onClick={onDone} style={{ height: 42, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "0 18px" }}>닫기</button>
      </div>
    </form>
  );
}
