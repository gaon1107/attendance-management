"use client";
// 비밀번호 변경 폼 — 현재/새/새 확인. 성공하면 입력칸을 비운다.
import { useActionState, useEffect, useRef } from "react";
import { changePassword } from "@/app/actions/account";

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

  return (
    <form ref={formRef} action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>현재 비밀번호</label>
        <input name="current" type="password" autoComplete="current-password" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 (8자 이상)</label>
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
