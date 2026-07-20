"use client";
// 직원 인적정보 수정 폼(관리자 전용) — 전화번호·직급·사번·입사일.
// 전부 선택 항목이라 빈 칸으로 저장하면 해당 값을 지운다. 입사일은 "YYYY-MM-DD" 문자열로 주고받는다.
import { useActionState, useState } from "react";
import { updateEmployeeProfile } from "@/app/actions/employees";
import { DatePicker } from "@/app/components/DatePicker";

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  outline: "none",
  width: "100%",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function ProfileForm({
  id,
  initialPhone,
  initialPosition,
  initialEmployeeNo,
  initialHireDate,
  grades,
  initialJobGradeId,
}: {
  id: string;
  initialPhone: string;
  initialPosition: string;
  initialEmployeeNo: string;
  initialHireDate: string; // "YYYY-MM-DD" 또는 빈 문자열
  grades: { id: string; name: string }[]; // 회사 직급(상급이 위)
  initialJobGradeId: string; // 현재 직급 id 또는 빈 문자열
}) {
  const [state, formAction, pending] = useActionState(updateEmployeeProfile, {});
  // 직급 select는 controlled로 둔다 — 저장 후 폼 리셋 시 uncontrolled면 "미지정"으로 돌아가
  // 재저장 때 jobGradeId가 조용히 null로 지워질 수 있다(직급 서열은 결재선이 쓰는 값이라 치명적).
  const [gradeValue, setGradeValue] = useState(initialJobGradeId);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input type="hidden" name="id" value={id} />
      <div>
        <label style={labelStyle}>전화번호</label>
        <input name="phone" type="tel" defaultValue={initialPhone} placeholder="010-1234-5678" style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>직급/직책 (표시용)</label>
          <input name="position" type="text" defaultValue={initialPosition} placeholder="예: 대리" style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>사번</label>
          <input name="employeeNo" type="text" defaultValue={initialEmployeeNo} placeholder="예: 2024-017" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>직급 서열 (결재선용)</label>
        <select name="jobGradeId" value={gradeValue} onChange={(e) => setGradeValue(e.target.value)} style={inputStyle}>
          <option value="">미지정</option>
          {grades.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
        </select>
        <p style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.5 }}>
          결재선에서 &ldquo;상급자&rdquo;를 판별하는 서열입니다. 직급 목록은 <b>[직원관리 → 직급 관리]</b>에서 등록합니다.
        </p>
      </div>
      <div>
        <label style={labelStyle}>입사일</label>
        <DatePicker name="hireDate" defaultValue={initialHireDate} placeholder="입사일 선택 (선택)" />
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
