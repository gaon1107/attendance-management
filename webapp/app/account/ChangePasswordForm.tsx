"use client";
// 비밀번호 변경 폼 — 현재/새/새 확인. 성공하면 입력칸을 비운다.
import { useActionState, useEffect, useRef } from "react";
import { changePassword } from "@/app/actions/account";
// 숫자를 화면에 직접 적지 않는다 — 서버 기준과 어긋나면 "화면 말대로 넣었는데 거부"가 된다(검수 M-3).
import { PASSWORD_MIN_HINT } from "@/lib/password-policy";

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  outline: "none",
  width: "100%",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, {});
  const formRef = useRef<HTMLFormElement>(null);

  // 성공하면 입력칸 초기화
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  // 🔴 비밀번호는 바뀌었는데 로그인 상태만 끊긴 경우 — **폼을 아예 치운다**(재검수 질문3).
  //    남겨두면 사용자가 다시 눌러 보고, 그때는 세션이 없어 "로그인이 필요합니다"라는 빨간 오류로
  //    안내가 덮인다. 그러면 "역시 안 바뀌었구나" 하고 옛 비밀번호를 계속 시도하게 된다.
  if (state?.ok && state.relogin) {
    return (
      <div style={{ fontSize: 14, color: "#B45309", fontWeight: 700, lineHeight: 1.7, wordBreak: "keep-all" }}>
        비밀번호가 변경되었습니다. 다만 로그인 상태를 유지하지 못했습니다 —{" "}
        <a href="/login" style={{ color: "#B45309", textDecoration: "underline" }}>
          <b>새 비밀번호로 다시 로그인</b>
        </a>
        해 주세요.
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>현재 비밀번호</label>
        <input name="current" type="password" autoComplete="current-password" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 ({PASSWORD_MIN_HINT})</label>
        <input name="next" type="password" autoComplete="new-password" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 확인</label>
        <input name="confirm" type="password" autoComplete="new-password" style={inputStyle} />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>비밀번호가 변경되었습니다.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
      >
        {pending ? "변경 중..." : "비밀번호 변경"}
      </button>
    </form>
  );
}
