"use client";
// 관리자가 직원 비밀번호를 재설정하는 화면 — 직원이 비번을 잊었을 때 쓴다.
//
// 🔴 2026-08-09: **관리자가 새 비밀번호를 타이핑하지 않는다.** 버튼만 누르면 서버가 무작위로 만든다.
//    예전에는 관리자가 정한 글자가 그대로 **영구 비밀번호**가 됐다. 그러면
//    관리자가 직원 비밀번호를 알고 있게 되고, 그 계정으로 로그인해 **대신 출퇴근을 찍을 수 있다.**
//    "정직한 실근무시간"이 제품의 핵심 가치라 이 구멍은 그대로 둘 수 없었다.
// 재설정하면 그 직원의 기존 로그인은 모두 풀리고, 알려준 임시 비번으로 다시 로그인해
// 곧바로 새 비밀번호를 정하게 된다(48시간 안에).
import { useActionState } from "react";
import { resetEmployeePassword } from "@/app/actions/employees";
import { TempPasswordBox } from "../TempPasswordBox";

export function ResetPasswordForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(resetEmployeePassword, {});

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input type="hidden" name="id" value={id} />

      <p style={{ margin: 0, fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7, wordBreak: "keep-all" }}>
        버튼을 누르면 <b>서버가 임시 비밀번호를 무작위로 만들어</b> 화면에 한 번 보여줍니다.
        직원에게 전달하면 되고, 직원이 로그인하는 순간 새 비밀번호를 직접 정하게 됩니다.
      </p>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}

      <button
        type="submit"
        disabled={pending}
        style={{
          height: 46, border: "1px solid var(--danger)", borderRadius: 10, background: "#fff",
          color: "var(--danger)", fontFamily: "inherit", fontSize: 15, fontWeight: 700,
          cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1,
          alignSelf: "flex-start", padding: "0 26px",
        }}
      >
        {pending ? "발급 중..." : "임시 비밀번호 발급"}
      </button>

      {state?.ok && state.tempPassword && (
        <TempPasswordBox
          password={state.tempPassword}
          name={state.name}
          hint="이 직원의 기존 로그인은 모두 풀렸습니다. 48시간 안에 로그인해야 하며, 로그인하면 곧바로 새 비밀번호를 정하게 됩니다."
        />
      )}
    </form>
  );
}
