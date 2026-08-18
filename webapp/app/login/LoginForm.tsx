"use client";
// 로그인 폼 — 회원가입과 같은 담백한 카드 폼.
// ※ 화면 뼈대(로고·카드)는 page.tsx(서버 컴포넌트)가 감싼다. 여기는 폼과 경고만 담당한다.
import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/app/actions/auth";

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

export function LoginForm({ signedInName, mustChange }: { signedInName: string | null; mustChange: boolean }) {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>로그인</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: signedInName ? 16 : 28 }}>
        계정 정보로 로그인하면 역할에 맞는 화면으로 이동합니다.
      </div>

      {/* 🔴 이미 다른 계정으로 로그인돼 있을 때의 경고(검수 M-15).
          이 제품은 출입증(세션)을 브라우저당 하나만 들고 있어서, 다른 계정으로 로그인하면
          앞서 열어둔 탭도 **조용히** 새 계정으로 바뀐다. 그 상태에서 [승인]을 누르면
          결재 기록에 처리자가 다른 사람으로 남는다 — 나중에 분쟁의 근거가 되는 기록이라 위험하다.
          구조를 바꾸는 대신(전 화면 회귀 위험) 사람이 알아채게 한다. */}
      {signedInName && (
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 8,
            padding: "11px 13px",
            fontSize: 12,
            color: "#92400E",
            lineHeight: 1.6,
            marginBottom: 24,
            wordBreak: "keep-all",
          }}
        >
          {mustChange ? (
            /* 임시 비밀번호 상태는 "로그인돼 있다"고만 하면 오해를 산다 — 실제로는 어떤 화면도 안 열린다
               (검수 경미 13). 무엇을 해야 하는지 알려준다. */
            <>
              <b>{signedInName}</b> 님은 임시 비밀번호로 로그인한 상태입니다.{" "}
              <b>새 비밀번호를 먼저 정해야</b> 화면이 열립니다. 임시 비밀번호로 다시 로그인하시면
              비밀번호 변경 화면으로 안내됩니다.
            </>
          ) : (
            <>
              지금 <b>{signedInName}</b> 님으로 로그인돼 있습니다. 다른 계정으로 로그인하면{" "}
              <b>기존 로그인이 해제되고, 열어둔 다른 탭도 새 계정으로 바뀝니다.</b> 다른 탭에서 승인·저장을
              하시려던 중이면 먼저 그 탭에서 마무리해 주세요.
            </>
          )}
        </div>
      )}

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label style={labelStyle}>이메일</label>
          <input name="email" type="email" placeholder="예시) admin@skytech.co.kr" style={inputStyle} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>비밀번호</label>
            <Link href="/forgot-password" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", textDecoration: "none" }}>
              비밀번호를 잊으셨나요?
            </Link>
          </div>
          <input name="password" type="password" placeholder="비밀번호" style={inputStyle} />
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
          {pending ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 24 }}>
        아직 계정이 없으세요?{" "}
        <Link href="/signup" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
          회사 회원가입
        </Link>
      </div>
    </>
  );
}
