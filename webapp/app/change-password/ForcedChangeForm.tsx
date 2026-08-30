"use client";
// 강제 비밀번호 변경 폼 — 기존 changePassword 동작을 그대로 쓴다.
// 성공하면 원래 쓰던 화면(home)으로 이동한다.
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/app/actions/account";
// 숫자를 화면에 직접 적지 않는다(검수 M-3). ⚠️ 이 화면에서 새 비밀번호를 못 정하면 그 직원은 갇힌다.
import { PASSWORD_MIN_HINT } from "@/lib/password-policy";

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

export function ForcedChangeForm({ home }: { home: string }) {
  const [state, formAction, pending] = useActionState(changePassword, {});
  const router = useRouter();

  // 변경 성공하면 원래 화면으로 이동.
  //  ⚠️ 세션 재발급까지 실패한 경우(relogin)에는 home으로 보내면 안 된다 — 로그인 상태가 아니라서
  //     아무 설명 없이 로그인 화면으로 튕긴다. 사용자는 "비밀번호가 안 바뀌었나?" 하고 옛 비밀번호를
  //     다시 넣어 보다가 계정을 잃었다고 오해한다. 사실을 보여준 뒤 본인이 로그인하게 한다.
  useEffect(() => {
    if (state?.ok && !state.relogin) router.replace(home);
  }, [state, home, router]);

  // 🔴 비밀번호는 바뀌었는데 로그인 상태만 끊긴 경우 — 폼을 치우고 안내만 남긴다(재검수 질문3).
  //    남겨두면 다시 눌렀을 때 "로그인이 필요합니다"가 안내를 덮어, 사용자가 "안 바뀌었구나"로 오해한다.
  if (state?.ok && state.relogin) {
    return (
      <div style={{ fontSize: 14, color: "#B45309", fontWeight: 700, lineHeight: 1.7, wordBreak: "keep-all" }}>
        비밀번호가 변경되었습니다. 다만 로그인 상태를 유지하지 못했습니다 —{" "}
        <a href="/login" style={{ color: "#B45309", textDecoration: "underline" }}>
          <b>새 비밀번호로 다시 로그인</b>
        </a>
        해 주세요.
      </div>
    );
  }

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <label style={labelStyle}>임시 비밀번호 (현재)</label>
        {/* ⚠️ autoComplete="off" 였다 — 비밀번호 관리자가 채워주지 못해 10자리 무작위 문자열을
            가린 채 손으로 쳐야 했다. 이번에 오타 5번의 대가가 "10분 잠금"이 됐으므로,
            오타 자체를 줄이는 것이 가장 싼 완화책이다(재검수 경미 3). */}
        <input name="current" type="password" placeholder="전달받은 임시 비밀번호" style={inputStyle} autoComplete="current-password" />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 ({PASSWORD_MIN_HINT})</label>
        <input name="next" type="password" placeholder="새 비밀번호" style={inputStyle} autoComplete="new-password" />
      </div>
      <div>
        <label style={labelStyle}>새 비밀번호 확인</label>
        <input name="confirm" type="password" placeholder="새 비밀번호 다시 입력" style={inputStyle} autoComplete="new-password" />
      </div>

      {state?.error && (
        <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>
      )}
      {state?.ok && (
        <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>변경되었습니다. 이동 중...</div>
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
        {pending ? "변경 중..." : "새 비밀번호로 변경"}
      </button>
    </form>
  );
}
