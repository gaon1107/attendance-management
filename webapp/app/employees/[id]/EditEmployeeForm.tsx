"use client";
// 직원 이름 수정 폼 — 관리자만. (인증방식·생체동의는 직원 본인이 정하므로 여기선 표시만)
import { useActionState, useState } from "react";
import { updateEmployeeName } from "@/app/actions/employees";

export function EditEmployeeForm({ id, initialName }: { id: string; initialName: string }) {
  const [state, formAction, pending] = useActionState(updateEmployeeName, {});
  const [name, setName] = useState(initialName);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input type="hidden" name="id" value={id} />
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>이름</label>
        <input
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%" }}
        />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 46, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 26px" }}
      >
        {pending ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
