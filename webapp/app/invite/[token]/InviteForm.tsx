"use client";
// 초대 수락 폼 — 직원이 이름·이메일·비밀번호를 직접 정해 가입한다.
import { useActionState } from "react";
import { acceptInvite } from "@/app/actions/invites";
import { DatePicker } from "@/app/components/DatePicker";

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
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function InviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvite, {});

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <input type="hidden" name="token" value={token} />
      <div>
        <label style={labelStyle}>이름</label>
        <input name="name" type="text" placeholder="홍길동" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>이메일</label>
        <input name="email" type="email" placeholder="me@company.co.kr" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>비밀번호 (8자 이상)</label>
        <input name="password" type="password" autoComplete="new-password" placeholder="비밀번호" style={inputStyle} />
      </div>

      {/* 인적정보(선택) — 모르는 항목은 비워도 됩니다. 관리자가 나중에 채우거나 고칠 수 있습니다. */}
      <div style={{ borderTop: "1px solid #EEF0F3", paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-sub)" }}>
          인적정보 <span style={{ fontWeight: 400 }}>(선택 — 비워도 됩니다)</span>
        </div>
        <div>
          <label style={labelStyle}>전화번호</label>
          <input name="phone" type="tel" autoComplete="tel" placeholder="010-1234-5678" style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>직급/직책</label>
            <input name="position" type="text" placeholder="예: 대리" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>사번</label>
            <input name="employeeNo" type="text" placeholder="예: 2024-017" style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>입사일</label>
          <DatePicker name="hireDate" placeholder="입사일 선택 (선택)" />
        </div>
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 52, marginTop: 4, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 16, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
      >
        {pending ? "가입 중..." : "가입하고 시작하기"}
      </button>
    </form>
  );
}
