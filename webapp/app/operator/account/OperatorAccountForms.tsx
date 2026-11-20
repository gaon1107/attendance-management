"use client";
// [내 계정] 입력 폼 2개(비밀번호 변경 · 이름 변경). 서버 액션은 app/actions/operator.ts.
//
// ⚠️ `type="password"` 칸에는 반드시 autoComplete 를 지정한다(디자인 규칙 §5.5.1).
//    안 하면 크롬이 **다른 계정의 저장된 비밀번호를 채워 넣는다** — 운영자 계정은 되찾기
//    어려우므로 특히 위험하다. 현재 비밀번호는 current-password, 새 비밀번호는 new-password.
import { useActionState } from "react";
import { changeOperatorPassword, changeOperatorName } from "@/app/actions/operator";

const card = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "18px 20px",
} as const;

const label = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 } as const;

const input = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  fontFamily: "inherit",
  fontSize: 15,
  background: "#fff",
} as const;

const button = {
  height: 40,
  padding: "0 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--primary)",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const msg = { fontSize: 13, marginTop: 10, wordBreak: "keep-all" as const, lineHeight: 1.6 };

export function OperatorNameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(changeOperatorName, {} as { error?: string; ok?: boolean });
  return (
    <form action={action} style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>이름</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 14px", wordBreak: "keep-all", lineHeight: 1.6 }}>
        운영자 화면 상단과 접속 기록에 표시되는 이름입니다.
      </p>
      <label style={label} htmlFor="op-name">새 이름</label>
      <input id="op-name" name="name" defaultValue={current} maxLength={30} required style={input} autoComplete="off" />
      <div style={{ marginTop: 14 }}>
        <button type="submit" disabled={pending} style={{ ...button, opacity: pending ? 0.6 : 1 }}>
          {pending ? "바꾸는 중..." : "이름 바꾸기"}
        </button>
      </div>
      {state?.error ? <p style={{ ...msg, color: "var(--danger)" }}>{state.error}</p> : null}
      {state?.ok ? <p style={{ ...msg, color: "var(--success)", fontWeight: 700 }}>이름을 바꿨습니다.</p> : null}
    </form>
  );
}

export function OperatorPasswordForm({ minLen }: { minLen: number }) {
  const [state, action, pending] = useActionState(
    changeOperatorPassword,
    {} as { error?: string; ok?: boolean; relogin?: boolean }
  );
  return (
    <form action={action} style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>비밀번호 변경</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 14px", wordBreak: "keep-all", lineHeight: 1.6 }}>
        바꾸면 <strong>다른 기기에서 로그인한 상태가 모두 끊어집니다.</strong> 지금 보고 계신 이 기기는
        그대로 유지됩니다.
      </p>

      <label style={label} htmlFor="op-cur">현재 비밀번호</label>
      <input id="op-cur" name="current" type="password" required autoComplete="current-password" style={input} />

      <div style={{ height: 12 }} />
      <label style={label} htmlFor="op-new">새 비밀번호 ({minLen}자 이상)</label>
      <input id="op-new" name="next" type="password" required autoComplete="new-password" style={input} />

      <div style={{ height: 12 }} />
      <label style={label} htmlFor="op-con">새 비밀번호 확인</label>
      <input id="op-con" name="confirm" type="password" required autoComplete="new-password" style={input} />

      <div style={{ marginTop: 14 }}>
        <button type="submit" disabled={pending} style={{ ...button, opacity: pending ? 0.6 : 1 }}>
          {pending ? "바꾸는 중..." : "비밀번호 바꾸기"}
        </button>
      </div>
      {state?.error ? <p style={{ ...msg, color: "var(--danger)" }}>{state.error}</p> : null}
      {/* ⚠️ relogin 은 "바뀌었지만 이 기기 로그인 유지에 실패한" 경우다. 빨간 실패 글씨로 보이면
          "실패했구나, 옛 비밀번호로 다시 해보자"로 읽혀 위험하다 — 성공색으로 안내한다(검수 중간 5). */}
      {state?.ok ? (
        <p style={{ ...msg, color: "var(--success)", fontWeight: 700 }}>
          {state.relogin
            ? "비밀번호를 바꿨습니다. 로그인이 풀렸으니 새 비밀번호로 다시 로그인해주세요."
            : "비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요."}
        </p>
      ) : null}
    </form>
  );
}
