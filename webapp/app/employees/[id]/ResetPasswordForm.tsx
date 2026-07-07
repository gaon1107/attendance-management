"use client";
// 관리자가 직원 비밀번호를 재설정하는 폼 — 직원이 비번을 잊었을 때 새 임시 비번을 정해준다.
// 재설정하면 그 직원은 기존 로그인이 풀리고, 알려준 새 비번으로 다시 로그인한다.
import { useActionState, useState } from "react";
import { resetEmployeePassword } from "@/app/actions/employees";

export function ResetPasswordForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(resetEmployeePassword, {});
  const [pw, setPw] = useState("");

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={() => setPw("")}
    >
      <input type="hidden" name="id" value={id} />
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>새 비밀번호 (8자 이상)</label>
        <input
          name="password"
          type="text"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="직원에게 알려줄 임시 비밀번호"
          autoComplete="off"
          style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%" }}
        />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>비밀번호를 재설정했습니다. 직원에게 새 비밀번호를 전달하세요.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 46, border: "1px solid var(--danger)", borderRadius: 10, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 26px" }}
      >
        {pending ? "재설정 중..." : "비밀번호 재설정"}
      </button>
    </form>
  );
}
