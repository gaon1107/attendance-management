"use client";
// 이상접속 감지 기준 설정 폼(접속/보안 6단계) — 어떤 접속을 "수상하다"고 볼지 정한다.
// 판정 결과는 [보안로그 → 이상 접속]과 대시보드 배지에 나온다. 접속을 막지는 않는다(보여주기만).
import { useActionState, useState } from "react";
import { saveAlertRules } from "@/app/actions/settings";

const numInput: React.CSSProperties = {
  width: 72, height: 40, padding: "0 10px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, outline: "none", textAlign: "center",
};

export function AlertRulesForm({
  initial,
}: {
  initial: { nightOn: boolean; nightStart: number; nightEnd: number; failOn: boolean; failCount: number };
}) {
  const [state, formAction, pending] = useActionState(saveAlertRules, {});
  const [nightOn, setNightOn] = useState(initial.nightOn);
  const [nightStart, setNightStart] = useState(initial.nightStart);
  const [nightEnd, setNightEnd] = useState(initial.nightEnd);
  const [failOn, setFailOn] = useState(initial.failOn);
  const [failCount, setFailCount] = useState(initial.failCount);

  // 시작 = 끝이면 하루 종일이 심야가 된다 — 저장 전에 미리 알려준다(서버도 한 번 더 막음).
  const sameHour = nightOn && nightStart === nightEnd;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>이상접속 감지 기준</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        수상한 접속을 골라 <b>[보안로그 → 이상 접속]</b>과 대시보드에 표시합니다. <b>접속을 막지는 않습니다</b>(보여주기만).
        <br />
        <b>차단한 IP가 다시 로그인을 시도하는 경우는 항상 알립니다</b> — 직접 막으신 IP라 잘못 잡을 일이 없어 끄는 기능을 두지 않았습니다.
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* 심야 로그인 */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            <input type="checkbox" name="alertNightOn" checked={nightOn} onChange={(e) => setNightOn(e.target.checked)} style={{ width: 16, height: 16 }} />
            심야 시간 로그인 알림
          </label>
          <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "6px 0 10px", lineHeight: 1.6 }}>
            정해진 시간대에 로그인이 성공하면 알립니다. <b>24시간 교대 근무 회사라면 꺼주세요</b> — 정상 출근이 전부 알림으로 뜹니다.
          </p>
          {/* ⚠️ 규칙이 꺼졌을 때 disabled를 쓰면 안 된다 — 비활성 input은 폼 전송에서 통째로 빠져
              서버가 "값 없음"으로 보고 저장을 거부한다(규칙을 끄는 순간 저장 불가). 흐리게+클릭만 막고 값은 그대로 보낸다. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", opacity: nightOn ? 1 : 0.45, pointerEvents: nightOn ? "auto" : "none" }}>
            <input name="alertNightStart" type="number" min={0} max={23} value={nightStart} onChange={(e) => setNightStart(Number(e.target.value))} style={numInput} />
            <span style={{ fontSize: 14 }}>시부터</span>
            <input name="alertNightEnd" type="number" min={0} max={23} value={nightEnd} onChange={(e) => setNightEnd(Number(e.target.value))} style={numInput} />
            <span style={{ fontSize: 14 }}>시까지</span>
          </div>
          {nightOn && !sameHour && (
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
              → 밤 {nightStart}시부터 {nightStart > nightEnd ? "다음날 " : ""}
              {nightEnd}시 사이 로그인을 알립니다.
            </div>
          )}
          {sameHour && (
            <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>
              시작과 끝이 같으면 하루 종일이 심야가 됩니다. 다르게 정해주세요.
            </div>
          )}
        </div>

        {/* 로그인 실패 반복 */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            <input type="checkbox" name="alertFailOn" checked={failOn} onChange={(e) => setFailOn(e.target.checked)} style={{ width: 16, height: 16 }} />
            로그인 실패 반복 알림
          </label>
          <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "6px 0 10px", lineHeight: 1.6 }}>
            같은 곳(IP)에서 하루에 이 횟수 이상 비밀번호를 틀리면 알립니다. 남의 비밀번호를 찍어보는 공격의 전형입니다.
            <br />
            숫자가 <b>작을수록 예민</b>해집니다(직원이 진짜 까먹어도 뜸).
          </p>
          {/* 위와 같은 이유로 disabled 금지 — 끄면 값이 전송되지 않아 저장이 막힌다. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: failOn ? 1 : 0.45, pointerEvents: failOn ? "auto" : "none" }}>
            <span style={{ fontSize: 14 }}>하루</span>
            <input name="alertFailCount" type="number" min={3} max={50} value={failCount} onChange={(e) => setFailCount(Number(e.target.value))} style={numInput} />
            <span style={{ fontSize: 14 }}>회 이상 실패하면 알림</span>
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

        <button
          type="submit"
          disabled={pending || sameHour}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending || sameHour ? "default" : "pointer", opacity: pending || sameHour ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}
