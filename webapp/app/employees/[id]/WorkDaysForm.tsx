"use client";
// 직원별 근무요일 예외 — '회사 기본 따름' 또는 '직접 지정'(요일 선택).
import { useActionState, useState } from "react";
import { updateEmployeeWorkDays } from "@/app/actions/employees";
import { WEEK_ORDER, DAY_LABELS, parseDays, daysToCsv } from "@/lib/workdays";

export function WorkDaysForm({
  id,
  initialDays,
  companyDaysLabel,
}: {
  id: string;
  initialDays: string | null; // null = 회사 기본 따름
  companyDaysLabel: string;
}) {
  const [state, formAction, pending] = useActionState(updateEmployeeWorkDays, {});
  const [custom, setCustom] = useState<boolean>(!!initialDays);
  const [days, setDays] = useState<Set<number>>(() => parseDays(initialDays ?? ""));

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  // 회사 기본 따름 → 빈 값(null 저장), 직접 지정 → 선택 요일 CSV
  const workDaysVal = custom ? daysToCsv(days) : "";

  const radio = (checked: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        padding: "12px 14px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700,
        border: `1px solid ${checked ? "var(--primary)" : "var(--border)"}`,
        background: checked ? "#EFF6FF" : "#fff", color: "var(--text)",
      }}
    >
      <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${checked ? "var(--primary)" : "#D1D5DB"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {checked && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)" }} />}
      </span>
      {label}
    </button>
  );

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="workDays" value={workDaysVal} />

      {radio(!custom, `회사 기본 따름 (${companyDaysLabel})`, () => setCustom(false))}
      {radio(custom, "이 직원만 직접 지정", () => setCustom(true))}

      {custom && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "4px 2px" }}>
          {WEEK_ORDER.map((d) => {
            const on = days.has(d);
            const weekend = d === 0 || d === 6;
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                style={{
                  width: 44, height: 40, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700,
                  border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                  background: on ? "var(--primary)" : "#fff",
                  color: on ? "#fff" : weekend ? "var(--danger)" : "var(--text)",
                }}
              >
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      )}

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 44, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 24px" }}
      >
        {pending ? "저장 중..." : "근무요일 저장"}
      </button>
    </form>
  );
}
