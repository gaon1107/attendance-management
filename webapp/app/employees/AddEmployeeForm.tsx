"use client";
// 직원 추가 입력 폼 (관리자). 추가 성공 시 목록이 자동 갱신된다.
import { useActionState, useEffect, useRef } from "react";
import { addEmployee } from "@/app/actions/employees";

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  color: "var(--text)",
  outline: "none",
};

export function AddEmployeeForm() {
  const [state, formAction, pending] = useActionState(addEmployee, {});
  const formRef = useRef<HTMLFormElement>(null);

  // 추가 성공하면 입력칸 비우기
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>직원 추가</div>
      <form
        ref={formRef}
        action={formAction}
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        {/* ⚠️ autoComplete: 이 폼은 크롬 눈에 로그인 폼과 똑같이 생겨서(이메일+비밀번호),
            그냥 두면 **관리자 본인의 저장된 아이디·비밀번호가 채워진다.**
            모르고 [추가]를 누르면 직원 계정 비밀번호가 관리자 비밀번호가 되고,
            채워진 칸에 덧입력하면 아무도 모르는 비밀번호가 된다(2026-08-05 검수 지적).
            · 비밀번호 new-password = 실제로 막는 규칙(크롬이 이 폼을 로그인 폼으로 안 봄).
            · 이메일은 **off**를 쓴다 — 여긴 **남의 계정**을 만드는 화면이라, 가입 화면과 달리
              관리자 브라우저가 이 아이디를 저장할 이유가 없다(가입 화면은 username). */}
        <input name="name" type="text" placeholder="이름" style={{ ...inputStyle, width: 120 }} />
        <input name="email" type="email" autoComplete="off" placeholder="이메일" style={{ ...inputStyle, width: 220 }} />
        <input name="password" type="password" autoComplete="new-password" placeholder="임시 비밀번호(8자+)" style={{ ...inputStyle, width: 180 }} />
        <button
          type="submit"
          disabled={pending}
          style={{
            height: 44,
            padding: "0 20px",
            border: "none",
            borderRadius: 8,
            background: "var(--primary)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 700,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "추가 중..." : "추가"}
        </button>
      </form>
      {state?.error && (
        <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700, marginTop: 10, wordBreak: "keep-all" }}>
          직원이 추가되었습니다. 여기서 정한 비밀번호는 <b>임시</b>입니다 — 직원이 처음 로그인하면 곧바로
          새 비밀번호를 정하는 화면으로 이동합니다.
        </div>
      )}
    </div>
  );
}
