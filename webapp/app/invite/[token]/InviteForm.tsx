"use client";
// 초대 수락 폼 — 직원이 이름·이메일·비밀번호를 직접 정해 가입한다.
import { useActionState, useState } from "react";
import { acceptInvite } from "@/app/actions/invites";
// 숫자를 화면에 직접 적지 않는다(검수 M-3).
import { PASSWORD_MIN_HINT } from "@/lib/password-policy";
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
  // 입력값을 화면이 들고 있는다(controlled) — 회사 가입 화면(app/signup/page.tsx)과 같은 방식.
  //  · 왜: 가입에 실패하면(비밀번호가 너무 흔함, 이미 가입된 이메일 등) 입력칸이 **전부 지워져** 처음부터 다시 쳐야 했다
  //    (2026-11-19 사장님 휴대폰 실시험에서 발견). 이제 틀린 칸만 고치면 된다.
  //  · 값은 이 화면(브라우저)에만 남는다 — 서버가 비밀번호를 되돌려 보내지 않는다.
  //  · 입사일(DatePicker)은 부품이 스스로 값을 지켜서 여기 넣지 않는다.
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", employeeNo: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <input type="hidden" name="token" value={token} />
      <div>
        <label style={labelStyle}>이름</label>
        <input name="name" type="text" placeholder="예시) 홍길동" style={inputStyle} value={form.name} onChange={set("name")} />
      </div>
      <div>
        <label style={labelStyle}>이메일</label>
        <input name="email" type="email" placeholder="예시) me@company.co.kr" style={inputStyle} value={form.email} onChange={set("email")} />
      </div>
      <div>
        <label style={labelStyle}>비밀번호 ({PASSWORD_MIN_HINT})</label>
        <input name="password" type="password" autoComplete="new-password" placeholder="비밀번호" style={inputStyle} value={form.password} onChange={set("password")} />
      </div>

      {/* 인적정보(선택) — 모르는 항목은 비워도 됩니다. 관리자가 나중에 채우거나 고칠 수 있습니다. */}
      <div style={{ borderTop: "1px solid #EEF0F3", paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-sub)" }}>
          인적정보 <span style={{ fontWeight: 400 }}>(선택 — 비워도 됩니다)</span>
        </div>
        <div>
          <label style={labelStyle}>전화번호</label>
          <input name="phone" type="tel" autoComplete="tel" placeholder="예시) 010-1234-5678" style={inputStyle} value={form.phone} onChange={set("phone")} />
        </div>
        <div>
          <label style={labelStyle}>사번</label>
          <input name="employeeNo" type="text" placeholder="예시) 2024-017" style={inputStyle} value={form.employeeNo} onChange={set("employeeNo")} />
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
