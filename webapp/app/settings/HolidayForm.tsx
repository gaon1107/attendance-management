"use client";
// 공휴일·휴무일 설정 폼 — 관리자만.
//  ① 법정공휴일 자동 반영 ON/OFF (+ 정부 API [지금 갱신])
//  ② 회사 수동 휴무일 추가·삭제 (창립기념일·임시공휴일 즉시 반영)
// 이 설정은 지각·결근·연차 계산에서 "쉬는 날"로 반영된다.
import { useActionState, useState } from "react";
import { saveHolidayAuto, addCompanyHoliday, deleteCompanyHoliday, syncHolidaysNow } from "@/app/actions/holidays";
import { DatePicker } from "@/app/components/DatePicker";

type Holiday = { id: string; date: string; name: string };

const inputStyle: React.CSSProperties = {
  height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, outline: "none",
};

export function HolidayForm({
  initial,
}: {
  initial: { autoOn: boolean; holidays: Holiday[]; syncedCount: number; syncedYears: string };
}) {
  const [autoState, autoAction, autoPending] = useActionState(saveHolidayAuto, {});
  const [syncState, syncAction, syncPending] = useActionState(syncHolidaysNow, {});
  const [addState, addAction, addPending] = useActionState(addCompanyHoliday, {});
  const [delState, delAction] = useActionState(deleteCompanyHoliday, {});

  const [autoOn, setAutoOn] = useState(initial.autoOn);

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>공휴일·휴무일</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        공휴일·휴무일은 <b>지각·결근·연차 계산에서 &quot;쉬는 날&quot;</b>로 처리됩니다. 그날 출근하면 <b>휴일근무</b>로 표시됩니다.
      </p>

      {/* ① 자동 공휴일 반영 토글 */}
      <form action={autoAction} style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          <input type="checkbox" name="holidayAutoOn" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} style={{ width: 16, height: 16 }} />
          법정공휴일 자동 반영
        </label>
        <p style={{ fontSize: 12, color: "var(--text-sub)", margin: 0, lineHeight: 1.6 }}>
          설날·추석·광복절 등 <b>전국 공휴일</b>을 자동으로 쉬는 날 처리합니다.
          <br />
          <b>공휴일에도 정상 근무하는 회사(병원·서비스업 등)라면 꺼주세요.</b> 아래 수동 휴무일은 이 스위치와 상관없이 항상 적용됩니다.
        </p>
        {autoState?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{autoState.error}</div>}
        {autoState?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}
        <button type="submit" disabled={autoPending}
          style={{ height: 40, border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: autoPending ? "default" : "pointer", opacity: autoPending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 20px" }}>
          {autoPending ? "저장 중..." : "저장"}
        </button>
      </form>

      {/* 정부 API 지금 갱신 */}
      <form action={syncAction} style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>공휴일 데이터</div>
        <p style={{ fontSize: 12, color: "var(--text-sub)", margin: 0, lineHeight: 1.6 }}>
          {initial.syncedCount > 0
            ? <>저장된 공휴일 <b>{initial.syncedCount}건</b>{initial.syncedYears ? ` (${initial.syncedYears})` : ""}. 정부(공공데이터포털)에서 받아온 값입니다.</>
            : <>아직 공휴일을 받아오지 않았습니다. 아래 버튼으로 <b>올해·내년</b> 공휴일을 받아오세요.</>}
        </p>
        {syncState?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{syncState.error}</div>}
        {syncState?.ok && syncState?.msg && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>{syncState.msg}</div>}
        <button type="submit" disabled={syncPending}
          style={{ height: 40, border: "1px solid var(--primary)", borderRadius: 8, background: "#fff", color: "var(--primary)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: syncPending ? "default" : "pointer", opacity: syncPending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 20px" }}>
          {syncPending ? "받아오는 중..." : "지금 갱신(올해·내년)"}
        </button>
      </form>

      {/* ② 회사 수동 휴무일 */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>회사 휴무일(수동)</div>
        <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "0 0 12px", lineHeight: 1.6 }}>
          창립기념일, 임시공휴일 등 <b>회사가 직접 쉬는 날</b>을 추가합니다. (자동 공휴일과 별개로 항상 적용)
        </p>

        <form action={addAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 12 }}>
          {/* 공용 단일 날짜 선택기(앱 공통 달력) — hidden input(name="date")으로 제출되어 서버액션은 그대로 동작 */}
          <div style={{ width: 170 }}>
            <DatePicker name="date" placeholder="날짜 선택" allowClear={false} />
          </div>
          <input name="name" type="text" required placeholder="휴무일 이름(예: 창립기념일)" maxLength={50} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
          <button type="submit" disabled={addPending}
            style={{ height: 44, border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: addPending ? "default" : "pointer", opacity: addPending ? 0.6 : 1, padding: "0 20px", whiteSpace: "nowrap" }}>
            {addPending ? "추가 중..." : "추가"}
          </button>
        </form>
        {addState?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 8 }}>{addState.error}</div>}
        {delState?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 8 }}>{delState.error}</div>}

        {initial.holidays.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-sub)" }}>등록된 회사 휴무일이 없습니다.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {initial.holidays.map((h) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 100 }}>{h.date}</span>
                <span style={{ fontSize: 14, flex: 1 }}>{h.name}</span>
                <form action={delAction}>
                  <input type="hidden" name="id" value={h.id} />
                  <button type="submit"
                    style={{ height: 32, border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "0 12px" }}>
                    삭제
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
