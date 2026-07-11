"use client";
// 본인 확인 재검토 기준 설정 폼 — 출퇴근 사진을 연속 3장 위조 판독할 때, 핵심 판별 AI(모델 B)의
// "진짜 확률"이 이 값 미만인 장이 하나라도 있으면 관리자 근태 상세에 "재검토 필요" 배지가 붙는다.
// 출퇴근을 막는 값이 아니다(조용한 표시). ※ 함께 쓰는 모델 A 기준(60%)은 저조도 오탐 방지용 고정값이라 화면에 두지 않는다.
import { useActionState, useState } from "react";
import { saveLivenessRule } from "@/app/actions/settings";

export function LivenessRuleForm({ initialPercent }: { initialPercent: number }) {
  const [state, formAction, pending] = useActionState(saveLivenessRule, {});
  // 옛 기준(70 미만으로 저장된 값)은 모델 B 기준으로는 너무 느슨하므로 안전 기본 85%로 표시(서버 폴백과 동일).
  const [percent, setPercent] = useState(initialPercent >= 70 && initialPercent <= 95 ? initialPercent : 85);

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>본인 확인 재검토 기준</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        출퇴근 때 <b>연속 3장</b>을 촬영해 위조 여부를 판독합니다. 핵심 판별 AI의 <b>&quot;진짜 확률&quot;이 이 값보다 낮은 장이
        하나라도 있으면</b> 관리자 근태 상세에 &quot;본인 확인 재검토 필요&quot; 표시가 붙습니다. <b>출퇴근 자체를 막지는 않습니다.</b>
        <br />
        숫자가 <b>클수록 더 엄격</b>해져 표시가 늘어납니다. (기본 85% — 진짜 얼굴은 대개 93% 이상, 위조는 60% 이하로 갈립니다.)
        바꾼 값은 <b>이후 촬영분부터</b> 적용되고, 이미 기록된 과거 표시는 바뀌지 않습니다.
        <br />
        <b>※ 기준값은 데모 카메라 실측값입니다.</b> 현장 카메라·조명에서 진짜 통과·위조 차단을 확인한 뒤 확정하세요.
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            진짜 확률 <b style={{ color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{percent}%</b> 미만인 장이 있으면 재검토 표시
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min={70}
              max={95}
              step={5}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              name="livenessPercent"
              type="number"
              min={70}
              max={95}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              style={{ width: 80, height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
            <span>70% (느슨함 — 표시 적음)</span>
            <span>95% (엄격함 — 표시 많음)</span>
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
