"use client";
// 발급된 임시 비밀번호를 관리자에게 한 번 보여주는 상자 — [직원 추가]와 [비밀번호 재설정]이 함께 쓴다.
//
// 왜 화면에 평문으로 띄우나: 관리자가 직원에게 전달해야 하는 값이라 한 번은 보여야 한다.
//   DB에는 해시만 저장되므로 **이 화면을 벗어나면 아무도 다시 볼 수 없다.** 그래서 그 사실을 함께 알린다.
// ⚠️ 이 값은 화면 밖으로 나가면 끝이라, 복사 버튼을 크게 둔다(관리자가 옮겨 적다 틀리는 것을 막는다).
import { useEffect, useRef, useState } from "react";

export function TempPasswordBox({ password, name, hint }: { password: string; name?: string; hint: string }) {
  // 복사 결과를 **어느 비밀번호에 대한 것인지와 함께** 담는다.
  //  · 이렇게 두면 새 비밀번호가 발급됐을 때 표시가 저절로 사라진다. 상태를 따로 지우는 효과(useEffect)를
  //    쓰면 React 19가 막는다(effect 안에서 setState 금지 — 연쇄 렌더 유발).
  //  · 안 그러면 "복사됨"이 남아 **새 값도 복사한 줄 착각**하게 된다.
  const [result, setResult] = useState<{ pw: string; state: "copied" | "failed" } | null>(null);
  const copyState = result && result.pw === password ? result.state : "idle";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 화면을 떠날 때 예약된 타이머를 정리한다(사라진 컴포넌트에 상태를 쓰지 않게).
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    let state: "copied" | "failed";
    try {
      // ⚠️ 클립보드는 https(또는 localhost)에서만 동작한다. 사내에서 http로 쓰면 여기서 실패한다.
      await navigator.clipboard.writeText(password);
      state = "copied";
    } catch {
      // 🔴 [검수 중간 7] 조용히 넘어가면 안 된다. 관리자가 "복사됐겠지" 하고 붙여넣으면
      //    **엉뚱한 값이 직원에게 전달**된다. 실패를 눈에 보이게 알리고 직접 복사하도록 안내한다.
      state = "failed";
    }
    setResult({ pw: password, state });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), 4000);
  };

  return (
    <div
      style={{
        marginTop: 12, padding: "14px 16px", borderRadius: 10,
        background: "#F0FDF4", border: "1px solid #BBF7D0",
        wordBreak: "keep-all", overflowWrap: "break-word",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 10 }}>
        {name ? `${name} 님의 임시 비밀번호` : "임시 비밀번호"}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* 사람이 옮겨 적는 값이라 고정폭 글꼴로 — l·1·O·0을 구분하기 쉽다
            (생성기가 헷갈리는 글자를 이미 빼지만, 글꼴로 한 겹 더 안전하게 한다). */}
        <code
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 20, fontWeight: 700, letterSpacing: "0.08em",
            background: "#fff", border: "1px solid #BBF7D0", borderRadius: 8,
            padding: "8px 14px", userSelect: "all",
          }}
        >
          {password}
        </code>
        <button
          type="button"
          onClick={copy}
          style={{
            height: 40, padding: "0 16px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${copyState === "failed" ? "#B91C1C" : "#16A34A"}`,
            background: copyState === "copied" ? "#16A34A" : "#fff",
            color: copyState === "copied" ? "#fff" : copyState === "failed" ? "#B91C1C" : "#166534",
            fontFamily: "inherit", fontSize: 14, fontWeight: 700,
          }}
        >
          {/* 색만으로 성공·실패를 구분하지 않는다(색약 사용자) — 글자도 함께 바뀐다. */}
          {copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "복사"}
        </button>
      </div>

      {/* aria-live — 버튼 글자 변화를 화면낭독기가 읽어준다(눈으로만 알 수 있으면 안 된다). */}
      <div aria-live="polite" style={{ fontSize: 13, marginTop: 8, minHeight: 18, color: copyState === "failed" ? "#B91C1C" : "#166534", fontWeight: 700 }}>
        {copyState === "copied" && "복사했습니다."}
        {copyState === "failed" && "복사하지 못했습니다. 위 값을 직접 선택해 복사해 주세요."}
      </div>

      <div style={{ fontSize: 13, color: "#166534", marginTop: 2, lineHeight: 1.6 }}>
        {hint}
        <br />
        <b>이 창을 벗어나면 다시 볼 수 없습니다.</b> 지금 직원에게 전달해 주세요.
      </div>
    </div>
  );
}
