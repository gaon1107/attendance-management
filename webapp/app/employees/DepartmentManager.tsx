"use client";
// 부서·결재선 관리(관리자) — 부서 추가/이름변경/삭제 + (결재선 켠 회사) 부서별 부서장·상위부서·대결자 지정.
// 직원 배정은 각 직원 상세에서 한다. 부서를 삭제하면 소속 직원은 "미배정"으로 돌아간다.
// 결재방식: 단일 승인(single, 기존=관리자 1명) ↔ 부서장 결재선(deptline, 소속 부서장→상위 부서장 순).
import { useActionState, useState } from "react";
import {
  createDepartment,
  renameDepartment,
  deleteDepartment,
  saveApprovalMode,
  saveDepartmentApproval,
} from "@/app/actions/departments";

type Dept = {
  id: string;
  name: string;
  memberCount: number;
  headUserId: string | null;
  parentId: string | null;
  deputyUserId: string | null;
  finalApproval: boolean;
};
type Emp = { id: string; name: string; employeeNo: string | null };

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 14,
  outline: "none",
};
const selectStyle: React.CSSProperties = { ...inputStyle, background: "#fff", cursor: "pointer" };
const smallBtn: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  color: "var(--text-sub)",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const empLabel = (e: Emp) => (e.employeeNo ? `${e.name} (${e.employeeNo})` : e.name);

// 부서별 결재설정 한 줄 — 부서장·상위부서·대결자 지정.
function DeptApprovalRow({ dept, employees, departments }: { dept: Dept; employees: Emp[]; departments: Dept[] }) {
  const others = departments.filter((d) => d.id !== dept.id); // 자기 자신은 상위부서 후보에서 제외
  // 현재 저장된 값(이름) — 저장 직후 select가 stale해도 여기서 진실을 보여준다.
  const headName = employees.find((e) => e.id === dept.headUserId)?.name;
  const parentName = departments.find((d) => d.id === dept.parentId)?.name;
  const deputyName = employees.find((e) => e.id === dept.deputyUserId)?.name;
  return (
    <form
      action={saveDepartmentApproval}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8, paddingTop: 10, borderTop: "1px dashed var(--border)", width: "100%" }}
    >
      <input type="hidden" name="id" value={dept.id} />
      <div style={{ width: "100%", fontSize: 12, color: "var(--text-sub)", marginBottom: 2 }}>
        현재 저장: 부서장 <b style={{ color: headName ? "var(--text)" : undefined }}>{headName ?? "없음"}</b>
        {" · "}상위부서 <b style={{ color: parentName ? "var(--text)" : undefined }}>{parentName ?? "없음"}</b>
        {" · "}대결자 <b style={{ color: deputyName ? "var(--text)" : undefined }}>{deputyName ?? "없음"}</b>
        {" · "}전결권자 <b style={{ color: dept.finalApproval ? "var(--primary)" : undefined }}>{dept.finalApproval ? "예(이 선에서 종결)" : "아니오"}</b>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
        <span style={{ fontSize: 11, color: "var(--text-sub)", fontWeight: 700 }}>부서장(1차 결재)</span>
        <select key={`head-${dept.headUserId ?? ""}`} name="headUserId" defaultValue={dept.headUserId ?? ""} style={selectStyle}>
          <option value="">— 없음(관리자 폴백) —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{empLabel(e)}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
        <span style={{ fontSize: 11, color: "var(--text-sub)", fontWeight: 700 }}>상위부서(다음 결재)</span>
        <select key={`parent-${dept.parentId ?? ""}`} name="parentId" defaultValue={dept.parentId ?? ""} style={selectStyle}>
          <option value="">— 없음(최상위) —</option>
          {others.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
        <span style={{ fontSize: 11, color: "var(--text-sub)", fontWeight: 700 }}>대결자(부서장 부재 시)</span>
        <select key={`deputy-${dept.deputyUserId ?? ""}`} name="deputyUserId" defaultValue={dept.deputyUserId ?? ""} style={selectStyle}>
          <option value="">— 없음 —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{empLabel(e)}</option>
          ))}
        </select>
      </label>
      <label key={`final-${dept.finalApproval}`} style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
        <span style={{ fontSize: 11, color: "var(--text-sub)", fontWeight: 700 }}>전결권자</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, height: 40, fontSize: 13 }}>
          <input type="checkbox" name="finalApproval" defaultChecked={dept.finalApproval} style={{ width: 16, height: 16, cursor: "pointer" }} />
          이 부서장 선에서 종결
        </span>
      </label>
      <button type="submit" style={{ ...smallBtn, height: 40, background: "var(--primary)", color: "#fff", border: "none" }}>
        결재설정 저장
      </button>
    </form>
  );
}

export function DepartmentManager({
  departments,
  employees,
  approvalMode,
  approvalStepCount,
}: {
  departments: Dept[];
  employees: Emp[];
  approvalMode: string;
  approvalStepCount: number;
}) {
  const [state, formAction, pending] = useActionState(createDepartment, {} as { error?: string; ok?: boolean });
  // 라디오 선택에 따라 단계수 표시를 즉시 바꾸기 위한 로컬 상태(저장 전 미리보기).
  const [modePreview, setModePreview] = useState(approvalMode === "deptline" ? "deptline" : approvalMode === "custom" ? "custom" : "single");
  // 부서장·상위부서(조직도)는 "부서장 결재선(deptline)"에서만 쓴다.
  //  상신자 지정(custom)은 직급 기준으로 직원이 직접 결재선을 고르므로 조직도 설정이 필요 없다.
  const showOrgSetup = approvalMode === "deptline";

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>부서·결재선 관리</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        회사 부서를 만들고 직원을 부서로 묶습니다. 직원의 부서는 <b>직원 이름 → 상세 화면</b>에서 지정합니다.
        부서를 삭제해도 소속 직원은 사라지지 않고 미배정으로 돌아갑니다.
      </p>

      {/* 결재방식 설정 */}
      <form
        action={saveApprovalMode}
        style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 16, background: "var(--bg, #fafafa)" }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>휴가·근태정정 결재방식</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="approvalMode" value="single" defaultChecked={modePreview === "single"} onChange={() => setModePreview("single")} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>
              <b>단일 승인</b> — 관리자 1명이 승인/반려하면 즉시 확정 (기본)
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="approvalMode" value="deptline" defaultChecked={modePreview === "deptline"} onChange={() => setModePreview("deptline")} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>
              <b>부서장 결재선</b> — 신청이 소속 부서장 → 상위 부서장 순서로 올라가 승인 (아래에서 부서마다 부서장 지정)
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="approvalMode" value="custom" defaultChecked={modePreview === "custom"} onChange={() => setModePreview("custom")} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>
              <b>상신자 지정 결재선</b> — 직원이 신청 종류마다 <b>자기 결재선을 한 번 저장</b>하면, 이후 신청은 저장된 순서로 자동 결재 (각 신청 화면의 &ldquo;내 결재선 설정&rdquo;에서 지정)
            </span>
          </label>
        </div>
        {modePreview === "deptline" && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>결재 단계 수</span>
            <select name="approvalStepCount" defaultValue={String(Math.max(1, Math.min(approvalStepCount, 3)))} style={{ ...selectStyle, width: 120 }}>
              <option value="1">1단계</option>
              <option value="2">2단계</option>
              <option value="3">3단계</option>
            </select>
            <span style={{ fontSize: 12, color: "var(--text-sub)" }}>(소속 부서장부터 위로 몇 단계까지)</span>
          </label>
        )}
        <button type="submit" style={{ ...smallBtn, height: 38, marginTop: 12, background: "var(--primary)", color: "#fff", border: "none" }}>
          결재방식 저장
        </button>
      </form>

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
                <button type="submit" style={smallBtn}>이름변경</button>
              </form>
              {/* 삭제 폼 */}
              <form
                action={deleteDepartment}
                onSubmit={(e) => {
                  if (!confirm(`'${d.name}' 부서를 삭제할까요? 소속 ${d.memberCount}명은 미배정으로 돌아갑니다.`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" style={{ ...smallBtn, color: "var(--danger)" }}>삭제</button>
              </form>
              {/* 부서장 결재선/상신자 지정 회사: 부서별 부서장·상위부서·대결자(조직도 상향 연결용) */}
              {showOrgSetup && <DeptApprovalRow dept={d} employees={employees} departments={departments} />}
            </div>
          ))}
        </div>
      )}
      {showOrgSetup && departments.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12 }}>부서를 먼저 추가한 뒤 부서장을 지정하세요.</p>
      )}
    </div>
  );
}
