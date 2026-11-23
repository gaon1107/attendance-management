"use client";
// 직원 추가 입력 폼 (관리자). 추가 성공 시 목록이 자동 갱신된다.
import { useActionState, useRef, useState } from "react";
import { addEmployee } from "@/app/actions/employees";
import { TempPasswordBox } from "./TempPasswordBox";
import { useSeatConsent } from "./SeatConsent";

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  color: "var(--text)",
  outline: "none",
};

export function AddEmployeeForm() {
  const [state, formAction, pending] = useActionState(addEmployee, {});
  const formRef = useRef<HTMLFormElement>(null);
  // 2026-11-23 결제 4단계: 입력칸을 제어형으로 바꿨다 — 요금 동의 창을 거쳐 같은 폼을 다시 보낼 때,
  //  React가 폼을 보낸 뒤 비제어 입력칸을 비워 버려 이름·이메일이 사라지기 때문이다.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const seat = useSeatConsent(state, formRef, pending);

  // 추가 성공하면 입력칸 비우기 — 서버 답이 바뀐 그 렌더에서 한 번(React 권장 방식: 효과 안에서 상태를 바꾸지 않는다).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) {
      setName("");
      setEmail("");
    }
  }

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>직원 추가</div>
      <form
        ref={formRef}
        action={formAction}
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        {/* 🔴 2026-08-09: **비밀번호 입력칸을 없앴다.** 서버가 무작위로 만들어 아래에 보여준다.
            예전엔 관리자가 직접 타이핑했고, 크롬이 이 폼을 로그인 폼으로 보고(이메일+비밀번호)
            **관리자 본인의 저장된 비밀번호를 채워 넣는** 사고가 있었다(2026-08-05 검수 지적).
            칸 자체가 사라졌으니 그 사고는 이제 일어날 수 없다. autoComplete 방어도 필요 없어졌다.
            ⚠️ 이메일 칸의 autoComplete="off"는 남겨 둔다 — 여긴 **남의 계정**을 만드는 화면이라
               관리자 브라우저가 이 아이디를 저장할 이유가 없다(가입 화면은 username을 쓴다). */}
        <input name="name" type="text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: 120 }} />
        <input name="email" type="email" autoComplete="off" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, width: 240 }} />
        {seat.hidden}
        <button
          type="submit"
          disabled={pending}
          style={{
            height: 44,
            padding: "0 20px",
            border: "none",
            borderRadius: 8,
            background: "var(--primary)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 700,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "추가 중..." : "추가"}
        </button>
      </form>
      {state?.error && (
        <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>
          {state.error}
        </div>
      )}
      {seat.dialog}
      {state?.ok && state.tempPassword && (
        <TempPasswordBox
          password={state.tempPassword}
          name={state.name}
          hint="직원이 이 비밀번호로 처음 로그인하면 곧바로 새 비밀번호를 정하는 화면으로 이동합니다."
        />
      )}
    </div>
  );
}
