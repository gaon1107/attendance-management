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
        <input name="name" type="text" placeholder="이름" style={{ ...inputStyle, width: 120 }} />
        <input name="email" type="email" placeholder="이메일" style={{ ...inputStyle, width: 220 }} />
        <input name="password" type="password" placeholder="임시 비밀번호(8자+)" style={{ ...inputStyle, width: 180 }} />
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
        <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700, marginTop: 10 }}>
          직원이 추가되었습니다.
        </div>
      )}
    </div>
  );
}
