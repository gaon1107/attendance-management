"use client";
// [결제하기] 버튼 + KIS 결제창(덮개 iframe) — 2026-11-23 결제 2단계.
//
// 흐름(학원관리 PaymentPage.jsx submitToKis와 같은 방식 — 2026-10-25 실결제 시험에서 확인된 방식):
//   ① 서버 동작 startCardPayment()가 주문서를 만들고 결제창 값(action·fields)을 준다.
//   ② 화면 전체를 덮는 iframe에 form POST로 KIS 결제창을 연다.
//      🔴 화면 전체(_self)를 KIS로 넘기면 안 된다 — KIS 창은 끝나면 결과를 returnUrl로 직접 보내지 않고 감싼 화면에
//         쪽지(postMessage {resultCode, data})로 건넨다. 받을 화면이 없으면 KIS 빈 화면에서 멈춘다(학원관리 BUG-048).
//   ③ 쪽지를 받으면 data를 그대로 returnUrl로 form POST(_self) → 서버가 승인·기간 반영 → 결과 화면.
//      성공·실패 판단은 서버가 한다. 화면은 "주문번호가 있는 결과"만 넘기고, 없으면 취소로 보고 창을 닫는다.
//   🔴 쪽지는 **결제창을 연 주소(KIS)에서 온 것만** 믿는다. 운영은 https://…kispg.co.kr, 내 컴퓨터 시험은 그 가짜 KIS 주소.
import { useEffect, useRef, useState } from "react";
import { startCardPayment } from "@/app/actions/billing";

const KISPG_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*kispg\.co\.kr$/i;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** 주소로 값을 form POST한다(target: iframe 이름 또는 "_self"). 값 이름이 submit이어도 원래 기능을 부른다. */
function postForm(action: string, fields: Record<string, unknown>, target: string) {
  const form = document.createElement("form");
  form.setAttribute("data-kispg-form", "1");
  form.method = "POST";
  form.action = action;
  form.acceptCharset = "UTF-8";
  form.target = target;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  HTMLFormElement.prototype.submit.call(form);
}

/** KIS 쪽지 읽기 → { empty } 빈 쪽지(창 닫힘) / { message, data } / null(모양 모름). 글자(JSON)로 와도 한 번 풀어 본다. */
function readKisMessage(raw: unknown): { empty: true } | { empty?: false; message: Record<string, unknown>; data: Record<string, unknown> | null } | null {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { empty: true };
  let message: unknown = raw;
  if (typeof message === "string") {
    try {
      message = JSON.parse(message);
    } catch {
      return null;
    }
  }
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  let data: unknown = m.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return { message: m, data: data && typeof data === "object" ? (data as Record<string, unknown>) : null };
}

export function PayButton({ ready, totalText }: { ready: boolean; totalText: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // 화면을 떠나면 덮개·쪽지 받기를 지운다(예전 쪽지 받기가 남아 결과를 두 번 보내지 않게).
  useEffect(() => () => cleanupRef.current?.(), []);

  function openKis(action: string, fields: Record<string, string>) {
    const actionOrigin = new URL(action).origin;
    const returnUrl = fields.returnUrl;
    const trusted = (origin: string) =>
      KISPG_ORIGIN.test(origin) || (LOCAL_ORIGIN.test(actionOrigin) && origin === actionOrigin); // 내 컴퓨터 가짜 KIS
    if (!(KISPG_ORIGIN.test(actionOrigin) || LOCAL_ORIGIN.test(actionOrigin)) || !returnUrl) {
      throw new Error("결제창 주소가 올바르지 않습니다.");
    }
    cleanupRef.current?.();
    document.querySelectorAll("form[data-kispg-form], [data-kispg-layer]").forEach((el) => el.remove());

    const layer = document.createElement("div");
    layer.setAttribute("data-kispg-layer", "1");
    layer.style.cssText = "position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.6);";
    const frame = document.createElement("iframe");
    frame.name = `kispg_frame_${Date.now()}`;
    frame.title = "카드 결제창";
    frame.setAttribute("allow", "payment");
    frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:#fff;";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "결제창 닫기";
    closeBtn.style.cssText =
      "position:absolute;left:12px;top:12px;z-index:1;padding:6px 12px;border:0;border-radius:6px;background:#fff;color:#333;font-size:14px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.3);";
    layer.appendChild(frame);
    layer.appendChild(closeBtn);
    document.body.appendChild(layer);

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      layer.remove();
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    const closeWithoutPayment = (notice: string) => {
      cleanup();
      setBusy(false);
      if (notice) setError(notice);
    };
    function onMessage(event: MessageEvent) {
      if (!trusted(event.origin)) return;
      const read = readKisMessage(event.data);
      if (read && read.empty) {
        closeWithoutPayment("");
        return;
      }
      if (!read || read.empty) return;
      // 결과로 보는 쪽지: 바깥에 resultCode가 있거나, data 안에 resultCd·ordNo가 있을 때(KIS 샘플 모양). 그 밖(진행 알림 등)은 무시.
      const looksLikeResult = "resultCode" in read.message || (!!read.data && ("resultCd" in read.data || "ordNo" in read.data));
      if (!looksLikeResult) return;
      const data = read.data ?? {};
      const ordNo = typeof data.ordNo === "string" ? data.ordNo.trim() : "";
      if (!ordNo) {
        const why = typeof data.resultMsg === "string" && data.resultMsg.trim() ? ` (${data.resultMsg.trim()})` : "";
        closeWithoutPayment(`결제가 진행되지 않았습니다.${why}`);
        return;
      }
      cleanup();
      try {
        postForm(returnUrl, data, "_self");
      } catch {
        setBusy(false);
        setError("결제 결과를 받는 중 문제가 생겼습니다. 아래 결제 내역을 확인해 주세요.");
      }
    }
    window.addEventListener("message", onMessage);
    closeBtn.addEventListener("click", () => closeWithoutPayment(""));
    postForm(action, fields, frame.name);
  }

  async function onClick() {
    setError(null);
    setBusy(true);
    const r = await startCardPayment();
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    try {
      openKis(r.action, r.fields);
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
        {busy ? "결제창 여는 중…" : `카드로 1개월 결제하기 (${totalText})`}
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
