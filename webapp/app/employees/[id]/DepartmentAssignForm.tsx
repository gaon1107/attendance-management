"use client";
// 직원 부서 배정 폼(관리자) — 드롭다운에서 부서를 골라 저장한다. "미배정"도 선택 가능.
import { useActionState, useState } from "react";
import { assignEmployeeDepartment } from "@/app/actions/departments";

type Dept = { id: string; name: string };

export function DepartmentAssignForm({
  id,
  initialDepartmentId,
  departments,
}: {
  id: string;
  initialDepartmentId: string | null;
  departments: Dept[];
}) {
  const [state, formAction, pending] = useActionState(assignEmployeeDepartment, {});
  const [value, setValue] = useState(initialDepartmentId ?? "");

  return (
    <form action={formAction} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={id} />
      <select
        name="departmentId"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", flex: "1 1 200px", background: "#fff" }}
      >
        <option value="">미배정</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        style={{ height: 44, border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 22px", whiteSpace: "nowrap" }}
      >
        {pending ? "저장 중..." : "저장"}
      </button>
      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, width: "100%" }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700, width: "100%" }}>부서를 저장했습니다.</div>}
    </form>
  );
}
