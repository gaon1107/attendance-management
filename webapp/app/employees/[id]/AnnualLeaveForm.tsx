"use client";
// 직원 연차 부여 폼(관리자) — 올해 부여할 연차 총 일수를 정한다.
import { useActionState, useState } from "react";
import { setAnnualLeave } from "@/app/actions/leave";

export function AnnualLeaveForm({ id, initialDays }: { id: string; initialDays: number }) {
  const [state, formAction, pending] = useActionState(setAnnualLeave, {});
  const [days, setDays] = useState(String(initialDays));

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input type="hidden" name="id" value={id} />
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>부여 연차 (일)</label>
        <input
          name="days"
          type="number"
          min={0}
          max={365}
          step={0.5}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: 160 }}
        />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 46, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 26px" }}
      >
        {pending ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
