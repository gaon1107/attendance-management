"use client";
// 회사 회원가입 화면 — 디자인 시안 "회사 회원가입"의 담백한 카드 폼.
import { useActionState, useState } from "react";
import Link from "next/link";
import { signup } from "@/app/actions/auth";

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
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 8,
};
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-sub)",
  marginTop: 6,
  lineHeight: 1.5,
};
const checkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  fontSize: 13,
  color: "var(--text)",
  cursor: "pointer",
};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, {});

  // 입력값을 화면이 들고 있는다(controlled).
  //  · 왜: 가입에 실패하면 화면이 다시 그려지는데, 그때 **입력한 것이 전부 지워졌다**.
  //    항목이 6개로 늘어 처음부터 다시 치는 부담이 크다(실제 브라우저 검증에서 확인, 2026-07-27).
  //  · 값은 화면에만 남는다 — 서버가 비밀번호를 되돌려 보내지 않는다(그게 더 안전하다).
  const [form, setForm] = useState({
    companyName: "", bizRegNo: "", managerName: "", managerPhone: "", email: "", password: "",
  });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      {/* 로고 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          근
        </div>
        <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
      </div>

      {/* 카드 */}
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 36px 32px",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>회사 회원가입</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 24, lineHeight: 1.6, wordBreak: "keep-all" }}>
          회사와 <b>회사 계정</b>을 만듭니다. 회사 계정은 사람이 아니라 <b>회사의 마스터 열쇠</b>입니다.
          <br />
          가입한 뒤 직원을 등록하고, 그중에서 <b>관리자를 지정</b>해 실무를 맡기시면 됩니다.
        </div>

        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={labelStyle}>회사명</label>
            <input name="companyName" type="text" placeholder="㈜하늘테크" style={inputStyle} value={form.companyName} onChange={set("companyName")} />
          </div>
          <div>
            <label style={labelStyle}>사업자등록번호</label>
            <input name="bizRegNo" type="text" inputMode="numeric" placeholder="123-45-67890" style={inputStyle} value={form.bizRegNo} onChange={set("bizRegNo")} />
            <div style={hintStyle}>국세청에 등록된 사업자인지 자동으로 확인합니다.</div>
          </div>
          <div>
            <label style={labelStyle}>담당자 이름</label>
            <input name="managerName" type="text" placeholder="홍길동" style={inputStyle} value={form.managerName} onChange={set("managerName")} />
          </div>
          <div>
            <label style={labelStyle}>담당자 연락처</label>
            <input name="managerPhone" type="tel" inputMode="tel" placeholder="010-1234-5678" style={inputStyle} value={form.managerPhone} onChange={set("managerPhone")} />
          </div>
          <div>
            <label style={labelStyle}>회사 계정 이메일 (로그인 아이디)</label>
            <input name="email" type="email" placeholder="admin@skytech.co.kr" style={inputStyle} value={form.email} onChange={set("email")} />
          </div>
          <div>
            <label style={labelStyle}>비밀번호</label>
            <input name="password" type="password" placeholder="8자 이상" style={inputStyle} value={form.password} onChange={set("password")} />
          </div>

          {/* 동의는 법적 필수(개인정보보호법). 체크하지 않으면 서버가 가입을 거부한다. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 2 }}>
            <label style={checkRowStyle}>
              <input name="agreeTerms" type="checkbox" style={{ width: 18, height: 18, flexShrink: 0 }} checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
              <span>
                <b>[필수]</b> 이용약관에 동의합니다.
              </span>
            </label>
            <label style={checkRowStyle}>
              <input name="agreePrivacy" type="checkbox" style={{ width: 18, height: 18, flexShrink: 0 }} checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
              <span>
                <b>[필수]</b> 개인정보 수집·이용에 동의합니다.
              </span>
            </label>
          </div>

          {state?.error && (
            <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            style={{
              height: 52,
              marginTop: 4,
              border: "none",
              borderRadius: 10,
              background: "var(--primary)",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 16,
              fontWeight: 700,
              cursor: pending ? "default" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? "가입 중..." : "가입하기"}
          </button>
        </form>

        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 24 }}>
          이미 계정이 있으세요?{" "}
          <Link href="/login" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
