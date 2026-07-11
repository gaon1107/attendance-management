"use client";
// 얼굴 인식 기준 크기 설정 폼 — 얼굴 폭이 화면 폭의 몇 % 이상이어야 출퇴근 인식·등록이 통과되는지.
// 픽셀이 아닌 "비율(%)"이라 카메라 해상도가 달라도 같은 의미. 멀리 든 사진(작은 얼굴) 부정 차단용.
import { useActionState, useState } from "react";
import { saveFaceRule } from "@/app/actions/settings";

export function FaceRuleForm({ initialPercent }: { initialPercent: number }) {
  const [state, formAction, pending] = useActionState(saveFaceRule, {});
  const [percent, setPercent] = useState(initialPercent);

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>얼굴 인식 기준 크기</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        출퇴근 얼굴 확인·얼굴 등록 때 <b>얼굴이 화면에서 이 비율보다 작으면 다시 촬영</b>하게 합니다.
        멀리서 든 사진(작은 얼굴)으로 대신 인증하는 부정을 막습니다.
        <br />
        숫자가 <b>클수록 더 가까이</b> 와야 통과됩니다. (권장 30%)
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            얼굴 폭 기준: 화면 폭의 <b style={{ color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{percent}%</b> 이상
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <input
              name="faceMinPercent"
              type="number"
              min={10}
              max={50}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              style={{ width: 80, height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
            <span>10% (느슨함 — 멀어도 통과)</span>
            <span>50% (엄격함 — 아주 가까이)</span>
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
