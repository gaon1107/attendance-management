"use client";
// 비밀번호 찾기 — 직원이 이메일을 넣어 재설정을 요청한다.
// 접수되면 관리자가 확인 후 임시 비밀번호를 전달한다. (자동 메일·문자 인증은 2차)
import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/password-reset";

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

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, {});

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
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>비밀번호 찾기</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          가입한 이메일을 입력하면 재설정 요청이 접수됩니다. 관리자가 확인 후 임시 비밀번호를 전달해 드립니다.
        </div>
        {/* 회사 계정(가입할 때 만든 마스터 열쇠)은 이 경로로 되찾을 수 없다 — 관리자가 승인해 주는 방식이라
            회사 계정 비번을 관리자가 바꿀 수 있으면 열쇠를 빼앗는 통로가 되기 때문. 잃어버린 사람이 실제로
            보는 화면은 여기이므로, 여기서 안내한다(검수 2차 치명 1). */}
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "11px 13px", fontSize: 12, color: "#92400E", lineHeight: 1.6, marginBottom: 24, wordBreak: "keep-all" }}>
          <b>회사 계정(가입할 때 만든 계정)</b>은 보안상 이 방법으로 되찾을 수 없습니다.
          회사에 <b>관리자로 지정된 직원</b>이 있으면 그분이 계속 관리할 수 있고,
          회사 계정 자체를 되찾으셔야 하면 <b>고객지원으로 사업자등록증을 확인한 뒤</b> 처리해 드립니다.
        </div>

        {state?.ok ? (
          <div>
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 10,
                padding: "16px 18px",
                fontSize: 14,
                color: "#15803D",
                fontWeight: 700,
                lineHeight: 1.7,
              }}
            >
              요청이 접수되었습니다.
              <div style={{ fontWeight: 400, color: "#166534", marginTop: 6 }}>
                등록된 이메일인 경우, 관리자가 확인 후 임시 비밀번호를 전달합니다. 임시 비밀번호로 로그인하면
                곧바로 새 비밀번호를 정하게 됩니다.
              </div>
            </div>
            <Link
              href="/login"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 22,
                height: 48,
                lineHeight: "48px",
                borderRadius: 10,
                background: "var(--primary)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              로그인으로 돌아가기
            </Link>
          </div>
        ) : (
          <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={labelStyle}>이메일</label>
              <input name="email" type="email" placeholder="가입한 이메일" style={inputStyle} />
            </div>

            {state?.error && (
              <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>
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
              {pending ? "접수 중..." : "재설정 요청하기"}
            </button>
          </form>
        )}

        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 24 }}>
          <Link href="/login" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
