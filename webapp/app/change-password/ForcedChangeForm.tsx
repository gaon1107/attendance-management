"use client";
// 강제 비밀번호 변경 폼 — 기존 changePassword 동작을 그대로 쓴다.
// 성공하면 원래 쓰던 화면(home)으로 이동한다.
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/app/actions/account";

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
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 8,
};

export function ForcedChangeForm({ home }: { home: string }) {
  const [state, formAction, pending] = useActionState(changePassword, {});
  const router = useRouter();

  // 변경 성공하면 원래 화면으로 이동.
  useEffect(() => {
    if (state?.ok) router.replace(home);
  }, [state, home, router]);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <label style={labelStyle}>임시 비밀번호 (현재)</label>
        <input name="current" type="password" placeholder="전달받은 임시 비밀번호" style={inputStyle} autoComplete="off" />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 (8자 이상)</label>
        <input name="next" type="password" placeholder="새 비밀번호" style={inputStyle} autoComplete="new-password" />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 확인</label>
        <input name="confirm" type="password" placeholder="새 비밀번호 다시 입력" style={inputStyle} autoComplete="new-password" />
      </div>

      {state?.error && (
        <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>
      )}
      {state?.ok && (
        <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>변경되었습니다. 이동 중...</div>
      )}

      <button
        type="submit"
        disabled={pending}
        style={{
          height: 52,
          marginTop: 4,
          border: "none",
          borderRadius: 10,
          background: "var(--primary)",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 16,
          fontWeight: 700,
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "변경 중..." : "새 비밀번호로 변경"}
      </button>
    </form>
  );
}
