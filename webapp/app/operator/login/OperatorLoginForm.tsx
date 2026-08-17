"use client";
// 운영자 로그인 폼. 화면 뼈대(로고·카드)는 page.tsx가 감싼다.
//
// ⚠️ 고객사 로그인 폼(app/login/LoginForm.tsx)과 **일부러 다른 점** 두 가지:
//   ① [비밀번호를 잊으셨나요?] 링크가 없다 — 운영자에게는 재설정 창구가 없다(actions/operator.ts 주석).
//   ② [회원가입] 링크가 없다 — 운영자 계정은 화면에서 만들 수 없다(서버에서 스크립트로만).
import { useActionState } from "react";
import { operatorLogin } from "@/app/actions/operator";

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

export function OperatorLoginForm() {
  const [state, formAction, pending] = useActionState(operatorLogin, {});

  return (
    <>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>운영자 로그인</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 28, lineHeight: 1.6 }}>
        회원사 현황을 확인하는 화면입니다. 고객사 계정으로는 로그인할 수 없습니다.
      </div>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label style={labelStyle}>이메일</label>
          {/* autoComplete off — 공용 PC에서 운영자 아이디가 자동완성 목록에 남지 않게 */}
          <input name="email" type="email" autoComplete="off" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>비밀번호</label>
          <input name="password" type="password" autoComplete="current-password" style={inputStyle} />
        </div>

        {state?.error && (
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{
            height: 52,
            marginTop: 4,
            border: "none",
            borderRadius: 10,
            background: "var(--rail)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 16,
            fontWeight: 700,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </>
  );
}
