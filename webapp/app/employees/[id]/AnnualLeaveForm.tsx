"use client";
// 직원 연차 수동조정 폼(관리자) — B-2.
//  기본은 입사일 기준 자동계산. 여기서 값을 저장하면 그 직원만 수동값(override)으로 고정,
//  "자동으로 되돌리기"를 누르면 다시 자동계산을 따른다.
import { useActionState, useState } from "react";
import { setAnnualLeave } from "@/app/actions/leave";

export function AnnualLeaveForm({
  id,
  autoDays,
  override,
  hasHireDate,
}: {
  id: string;
  autoDays: number; // 입사일 기준 자동 발생값
  override: number | null; // 관리자 수동값(null=자동 사용중)
  hasHireDate: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAnnualLeave, {});
  const [days, setDays] = useState(String(override ?? autoDays));
  const isManual = override !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 현재 상태 안내 */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7 }}>
        입사일 기준 자동 발생 <b style={{ color: "var(--text)" }}>{autoDays}일</b>
        {!hasHireDate && <span style={{ color: "var(--danger)" }}> (입사일 미입력 — 입력하면 정확히 계산됩니다. 현재 기본 15일)</span>}
        <br />
        현재 적용: {isManual
          ? <b style={{ color: "var(--warning, #B45309)" }}>수동 지정 {override}일</b>
          : <b style={{ color: "var(--primary)" }}>자동 계산 {autoDays}일</b>}
      </div>

      {/* 수동 지정 저장 */}
      <form action={formAction} style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <input type="hidden" name="id" value={id} />
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>수동 지정 (일)</label>
          <input
            name="days"
            type="number"
            min={0}
            max={365}
            step={0.5}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: 140 }}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          style={{ height: 46, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 22px" }}
        >
          {pending ? "저장 중..." : "수동 지정 저장"}
        </button>
      </form>

      {/* 자동으로 되돌리기 (수동값이 있을 때만) */}
      {isManual && (
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="auto" value="1" />
          <button
            type="submit"
            disabled={pending}
            style={{ height: 40, border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 18px" }}
          >
            자동 계산으로 되돌리기
          </button>
        </form>
      )}

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}
    </div>
  );
}
