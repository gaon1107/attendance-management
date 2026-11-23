"use client";
// [결제하기] 버튼 + KIS 결제창(덮개 iframe) — 2026-11-23 결제 2단계.
//
// 창 열기 흐름은 kis-frame.ts 머리말(3단계에서 공용으로 꺼냄). 아래는 2단계 당시 설명:
//   ① 서버 동작 startCardPayment()가 주문서를 만들고 결제창 값(action·fields)을 준다.
//   ② 화면 전체를 덮는 iframe에 form POST로 KIS 결제창을 연다.
//      🔴 화면 전체(_self)를 KIS로 넘기면 안 된다 — KIS 창은 끝나면 결과를 returnUrl로 직접 보내지 않고 감싼 화면에
//         쪽지(postMessage {resultCode, data})로 건넨다. 받을 화면이 없으면 KIS 빈 화면에서 멈춘다(학원관리 BUG-048).
//   ③ 쪽지를 받으면 data를 그대로 returnUrl로 form POST(_self) → 서버가 승인·기간 반영 → 결과 화면.
//      성공·실패 판단은 서버가 한다. 화면은 "주문번호가 있는 결과"만 넘기고, 없으면 취소로 보고 창을 닫는다.
//   🔴 쪽지는 **결제창을 연 주소(KIS)에서 온 것만** 믿는다. 운영은 https://…kispg.co.kr, 내 컴퓨터 시험은 그 가짜 KIS 주소.
import { useEffect, useRef, useState } from "react";
import { startCardPayment } from "@/app/actions/billing";
import { openKisFrame } from "./kis-frame";

export function PayButton({ ready, totalText, label }: { ready: boolean; totalText: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // 화면을 떠나면 덮개·쪽지 받기를 지운다(예전 쪽지 받기가 남아 결과를 두 번 보내지 않게).
  useEffect(() => () => cleanupRef.current?.(), []);

  function openKis(action: string, fields: Record<string, string>, orderNo: string) {
    cleanupRef.current?.();
    // 창 열기·쪽지 받기는 kis-frame.ts 공용(3단계에서 꺼냄 — 동작은 2단계 그대로).
    cleanupRef.current = openKisFrame(action, fields, orderNo, {
      title: "카드 결제창",
      closeLabel: "결제창 닫기",
      notDoneText: "결제가 진행되지 않았습니다.",
      onClosed: (notice) => {
        cleanupRef.current = null;
        setBusy(false);
        if (notice) setError(notice);
      },
      onPostFail: () => {
        cleanupRef.current = null;
        setBusy(false);
        setError("결제 결과를 받는 중 문제가 생겼습니다. 아래 결제 내역을 확인해 주세요.");
      },
    });
  }

  async function onClick() {
    setError(null);
    setBusy(true);
    let r: Awaited<ReturnType<typeof startCardPayment>>;
    try {
      r = await startCardPayment();
    } catch {
      // 네트워크가 끊겨도 버튼이 "여는 중…"에서 멈추지 않게(2단계 검수 경미 6).
      setBusy(false);
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    try {
      openKis(r.action, r.fields, r.orderNo);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "결제창을 열 수 없습니다.");
    }
  }

  if (!ready) {
    return (
      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7, wordBreak: "keep-all" }}>
        <strong>카드 결제를 준비 중입니다.</strong> 결제사 심사가 끝나면 이 자리에서 바로 결제하실 수 있습니다.
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          height: 44, padding: "0 22px", border: 0, borderRadius: 8, background: "var(--primary)", color: "#fff",
          fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "결제창 여는 중…" : `${label ?? "카드로 1개월 결제하기"} (${totalText})`}
      </button>
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, lineHeight: 1.6, wordBreak: "keep-all" }}>
        카드사 인증 창이 뜨지 않으면 주소창 오른쪽의 팝업 차단 표시를 눌러 &quot;항상 허용&quot;을 고른 뒤 다시 결제해 주세요.
      </div>
      {error ? (
        <div role="alert" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: "var(--danger)", wordBreak: "keep-all" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
