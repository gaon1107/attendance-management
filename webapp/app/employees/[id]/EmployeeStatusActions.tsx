"use client";
// 직원 퇴사(비활성화)/복직 버튼 — 관리자만. 실수 방지를 위해 확인창을 띄운다.
// 퇴사해도 과거 근태 기록은 리포트에 그대로 남고, 언제든 복직할 수 있다.
import { deactivateEmployee, reactivateEmployee } from "@/app/actions/employees";

export function EmployeeStatusActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  if (active) {
    return (
      <form
        action={deactivateEmployee}
        onSubmit={(e) => {
          if (!confirm(`${name} 님을 퇴사 처리할까요?\n\n로그인이 막히고 직원 목록에서 내려갑니다.\n과거 근태 기록은 리포트에 그대로 보존되며, 나중에 복직할 수 있습니다.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          style={{ height: 44, padding: "0 20px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          퇴사 처리(비활성화)
        </button>
      </form>
    );
  }

  return (
    <form
      action={reactivateEmployee}
      onSubmit={(e) => {
        if (!confirm(`${name} 님을 복직시킬까요?\n다시 로그인할 수 있게 됩니다.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{ height: 44, padding: "0 20px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        복직시키기
      </button>
    </form>
  );
}
