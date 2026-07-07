"use client";
// 초대 수락 폼 — 직원이 이름·이메일·비밀번호를 직접 정해 가입한다.
import { useActionState } from "react";
import { acceptInvite } from "@/app/actions/invites";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 16,
  color: "var(--text)",
  outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function InviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvite, {});

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <input type="hidden" name="token" value={token} />
      <div>
        <label style={labelStyle}>이름</label>
        <input name="name" type="text" placeholder="홍길동" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>이메일</label>
        <input name="email" type="email" placeholder="me@company.co.kr" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>비밀번호 (8자 이상)</label>
        <input name="password" type="password" autoComplete="new-password" placeholder="비밀번호" style={inputStyle} />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 52, marginTop: 4, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 16, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
      >
        {pending ? "가입 중..." : "가입하고 시작하기"}
      </button>
    </form>
  );
}
