"use client";
// 부서 관리(관리자) — 부서 추가/이름변경/삭제. 직원 배정은 각 직원 상세에서 한다.
// 부서를 삭제하면 소속 직원은 지워지지 않고 "미배정"으로 돌아간다.
import { useActionState } from "react";
import { createDepartment, renameDepartment, deleteDepartment } from "@/app/actions/departments";

type Dept = { id: string; name: string; memberCount: number };

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 14,
  outline: "none",
};

export function DepartmentManager({ departments }: { departments: Dept[] }) {
  const [state, formAction, pending] = useActionState(createDepartment, {});

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>부서 관리</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        회사 부서를 만들고 직원을 부서로 묶습니다. 직원의 부서는 <b>직원 이름 → 상세 화면</b>에서 지정합니다.
        부서를 삭제해도 소속 직원은 사라지지 않고 미배정으로 돌아갑니다.
      </p>

      {/* 부서 추가 */}
      <form action={formAction} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <input name="name" type="text" placeholder="부서 이름 (예: 영업팀)" style={{ ...inputStyle, flex: "1 1 200px" }} />
        <button
          type="submit"
          disabled={pending}
          style={{ height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, whiteSpace: "nowrap" }}
        >
          {pending ? "추가 중..." : "+ 부서 추가"}
        </button>
      </form>
      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>{state.error}</div>}

      {/* 부서 목록 */}
      {departments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {departments.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", flexWrap: "wrap" }}>
              {/* 이름 변경 폼 */}
              <form action={renameDepartment} style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 240px" }}>
                <input type="hidden" name="id" value={d.id} />
                <input name="name" type="text" defaultValue={d.name} style={{ ...inputStyle, flex: "1 1 140px" }} />
                <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>{d.memberCount}명</span>
                <button type="submit" style={{ height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  이름변경
                </button>
              </form>
              {/* 삭제 폼 */}
              <form
                action={deleteDepartment}
                onSubmit={(e) => {
                  if (!confirm(`'${d.name}' 부서를 삭제할까요? 소속 ${d.memberCount}명은 미배정으로 돌아갑니다.`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" style={{ height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  삭제
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
