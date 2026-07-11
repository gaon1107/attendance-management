"use client";
// 본인 확인 재검토 기준 설정 폼 — 출퇴근 사진 판독의 "진짜 확률"이 이 값 미만이면
// 관리자 근태 상세에 "재검토 필요" 배지가 붙는다. 출퇴근을 막는 값이 아니다(조용한 표시).
import { useActionState, useState } from "react";
import { saveLivenessRule } from "@/app/actions/settings";

export function LivenessRuleForm({ initialPercent }: { initialPercent: number }) {
  const [state, formAction, pending] = useActionState(saveLivenessRule, {});
  const [percent, setPercent] = useState(initialPercent);

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>본인 확인 재검토 기준</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        출퇴근 때 촬영한 사진을 위조 여부로 판독한 <b>&quot;진짜 확률&quot;이 이 값보다 낮으면</b> 관리자 근태 상세에
        &quot;본인 확인 재검토 필요&quot; 표시가 붙습니다. <b>출퇴근 자체를 막지는 않습니다.</b>
        <br />
        숫자가 <b>클수록 더 엄격</b>해져 표시가 늘어납니다. (기본 50%)
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            진짜 확률 <b style={{ color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{percent}%</b> 미만이면 재검토 표시
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min={30}
              max={90}
              step={5}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              name="livenessPercent"
              type="number"
              min={30}
              max={90}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              style={{ width: 80, height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
            <span>30% (느슨함 — 표시 적음)</span>
            <span>90% (엄격함 — 표시 많음)</span>
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

        <button
          type="submit"
          disabled={pending}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}
