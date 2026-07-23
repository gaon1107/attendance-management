"use client";
// 휴게시간 기준 설정 폼 — 관리자. 법정 최소 이상으로만 설정 가능.
//  · ⚠️ 이 값은 "준수 점검"에만 쓰인다(자동 차감 없음) — 화면에서 분명히 알린다.
import { useActionState, useState } from "react";
import { saveBreakRule } from "@/app/actions/settings";
import { LEGAL_BREAK_MIN_4H, LEGAL_BREAK_MIN_8H, MAX_BREAK_RULE_MIN } from "@/lib/break-rule";

const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const numInput: React.CSSProperties = { width: 110, height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none" };

export function BreakRuleForm({
  initial,
}: {
  initial: { checkOn: boolean; min4h: number; min8h: number };
}) {
  const [state, formAction, pending] = useActionState(saveBreakRule, {});
  const [checkOn, setCheckOn] = useState(initial.checkOn);
  const [min4h, setMin4h] = useState(String(initial.min4h));
  const [min8h, setMin8h] = useState(String(initial.min8h));

  // 서버가 다시 불러온 값(initial)이 바뀌면 입력칸을 맞춘다 — 저장 후 화면과 DB가 어긋나지 않게.
  //  · effect 대신 렌더 중 이전값 비교(연쇄 렌더 회피 — usePagination·BlockedIpClient와 같은 패턴).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial.checkOn !== prevInitial.checkOn || initial.min4h !== prevInitial.min4h || initial.min8h !== prevInitial.min8h) {
    setPrevInitial(initial);
    setCheckOn(initial.checkOn);
    setMin4h(String(initial.min4h));
    setMin8h(String(initial.min8h));
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>휴게 기준</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.7, wordBreak: "keep-all" }}>
        근로기준법은 근로시간이 <b>4시간을 넘으면 30분 이상</b>, <b>8시간을 넘으면 1시간 이상</b>의 휴게시간을 주도록 정하고 있습니다.
        회사가 더 넉넉히 주도록 올릴 수는 있지만 법정 최소보다 낮출 수는 없습니다.
        <br />
        <b>휴게시간은 직원이 [외출]→[복귀]를 누른 시간</b>으로 집계합니다.
        <b style={{ color: "var(--warning)" }}> 이 설정은 점검·표시용이며, 근무시간에서 자동으로 빼지 않습니다.</b>
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" name="checkOn" value="1" checked={checkOn} onChange={(e) => setCheckOn(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>휴게시간 준수 점검 사용</span>
          <span style={{ fontSize: 13, color: "var(--text-sub)" }}>끄면 아래 현황에서 부족 표시를 하지 않습니다.</span>
        </label>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div>
            <label style={label} htmlFor="min4h">4시간 초과 근무 시 최소 휴게</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input id="min4h" name="min4h" type="number" min={LEGAL_BREAK_MIN_4H} max={MAX_BREAK_RULE_MIN} value={min4h} onChange={(e) => setMin4h(e.target.value)} style={numInput} />
              <span style={{ fontSize: 14, color: "var(--text-sub)" }}>분 (법정 {LEGAL_BREAK_MIN_4H}분)</span>
            </div>
          </div>
          <div>
            <label style={label} htmlFor="min8h">8시간 초과 근무 시 최소 휴게</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input id="min8h" name="min8h" type="number" min={LEGAL_BREAK_MIN_8H} max={MAX_BREAK_RULE_MIN} value={min8h} onChange={(e) => setMin8h(e.target.value)} style={numInput} />
              <span style={{ fontSize: 14, color: "var(--text-sub)" }}>분 (법정 {LEGAL_BREAK_MIN_8H}분)</span>
            </div>
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, lineHeight: 1.6, wordBreak: "keep-all" }}>{state.error}</div>}
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
