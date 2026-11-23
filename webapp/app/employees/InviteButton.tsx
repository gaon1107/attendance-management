"use client";
// [+ 초대 링크 만들기] — 2026-11-23 결제 4단계에서 서버 폼을 화면 부품으로 바꿨다.
//  요금 구간이 오르면 서버가 { seatConsent } 를 돌려주고, 확인 창(SeatConsent)에서 동의해야 링크가 만들어진다.
import { useActionState, useRef } from "react";
import { createInvite, type CreateInviteState } from "@/app/actions/invites";
import { useSeatConsent } from "./SeatConsent";

export function InviteButton() {
  const [state, formAction, pending] = useActionState<CreateInviteState, FormData>(createInvite, {});
  const formRef = useRef<HTMLFormElement>(null);
  const seat = useSeatConsent(state, formRef, pending);
  return (
    <form ref={formRef} action={formAction}>
      {seat.hidden}
      <button
        type="submit"
        disabled={pending}
        style={{ height: 44, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
      >
        {pending ? "만드는 중..." : "+ 초대 링크 만들기"}
      </button>
      {state.error ? (
        <div role="alert" style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 8, wordBreak: "keep-all" }}>{state.error}</div>
      ) : null}
      {seat.dialog}
    </form>
  );
}
