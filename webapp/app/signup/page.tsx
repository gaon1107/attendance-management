"use client";
// 회사 회원가입 화면 — 디자인 시안 "회사 회원가입"의 담백한 카드 폼.
import { useActionState } from "react";
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

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, {});

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
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 28 }}>
          회사와 관리자 계정을 함께 만듭니다.
        </div>

        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={labelStyle}>회사명</label>
            <input name="companyName" type="text" placeholder="㈜하늘테크" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>이름 (관리자)</label>
            <input name="name" type="text" placeholder="홍길동" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>이메일</label>
            <input name="email" type="email" placeholder="admin@skytech.co.kr" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>비밀번호</label>
            <input name="password" type="password" placeholder="8자 이상" style={inputStyle} />
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
