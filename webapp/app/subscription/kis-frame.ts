// KIS 결제창·카드 등록 창(덮개 iframe) 열기 — 화면(브라우저) 전용 공용 도우미.
//   2026-11-23 결제 2단계 PayButton.tsx 안에 있던 것을 3단계(자동결제 카드 등록)도 쓰도록 꺼냈다. 동작은 그대로다.
//
// 흐름(학원관리 PaymentPage.jsx submitToKis와 같은 방식 — 2026-10-25 실결제 시험에서 확인된 방식):
//   ① 서버 동작이 주문서(또는 카드 등록 행)를 만들고 창 값(action·fields)을 준다.
//   ② 화면 전체를 덮는 iframe에 form POST로 KIS 창을 연다.
//      🔴 화면 전체(_self)를 KIS로 넘기면 안 된다 — KIS 창은 끝나면 결과를 returnUrl로 직접 보내지 않고 감싼 화면에
//         쪽지(postMessage {resultCode, data})로 건넨다. 받을 화면이 없으면 KIS 빈 화면에서 멈춘다(학원관리 BUG-048).
//   ③ 쪽지를 받으면 data를 그대로 returnUrl로 form POST(_self) → 서버가 승인(등록 확정) → 결과 화면.
//      성공·실패 판단은 서버가 한다. 화면은 "번호가 있는 결과"만 넘기고, 없으면 취소로 보고 창을 닫는다.
//   🔴 쪽지는 **창을 연 주소(KIS)에서 온 것만** 믿는다. 운영은 https://…kispg.co.kr, 내 컴퓨터 시험은 그 가짜 KIS 주소.

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

/**
 * KIS 창을 연다. 끝나면 결과를 returnUrl로 넘기고(화면 이동), 결과 없이 닫히면 onClosed(안내 문구 — 빈 글자면 그냥 닫힘).
 * @returns 덮개·쪽지 받기를 지우는 함수(화면을 떠날 때 부른다)
 * @throws 창 주소가 KIS(또는 내 컴퓨터 가짜 KIS)가 아니면
 */
export function openKisFrame(
  action: string,
  fields: Record<string, string>,
  expectedOrdNo: string,
  opts: {
    title: string;
    /** 닫기 단추 글자(예: "결제창 닫기") */
    closeLabel: string;
    /** 결과 없이 끝났을 때 안내(예: "결제가 진행되지 않았습니다.") */
    notDoneText: string;
    onClosed: (notice: string) => void;
    onPostFail: () => void;
  }
): () => void {
  const actionOrigin = new URL(action).origin;
  const returnUrl = fields.returnUrl;
  const trusted = (origin: string) =>
    KISPG_ORIGIN.test(origin) || (LOCAL_ORIGIN.test(actionOrigin) && origin === actionOrigin); // 내 컴퓨터 가짜 KIS
  if (!(KISPG_ORIGIN.test(actionOrigin) || LOCAL_ORIGIN.test(actionOrigin)) || !returnUrl) {
    throw new Error("결제창 주소가 올바르지 않습니다.");
  }
  document.querySelectorAll("form[data-kispg-form], [data-kispg-layer]").forEach((el) => el.remove());

  const layer = document.createElement("div");
  layer.setAttribute("data-kispg-layer", "1");
  layer.style.cssText = "position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.6);";
  const frame = document.createElement("iframe");
  frame.name = `kispg_frame_${Date.now()}`;
  frame.title = opts.title;
  frame.setAttribute("allow", "payment");
  frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:#fff;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = opts.closeLabel;
  closeBtn.style.cssText =
    "position:absolute;left:12px;top:12px;z-index:1;padding:6px 12px;border:0;border-radius:6px;background:#fff;color:#333;font-size:14px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.3);";
  layer.appendChild(frame);
  layer.appendChild(closeBtn);
  document.body.appendChild(layer);

  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    layer.remove();
  };
  const closeWithout = (notice: string) => {
    cleanup();
    opts.onClosed(notice);
  };
  function onMessage(event: MessageEvent) {
    // 출처(KIS 주소)뿐 아니라 **우리가 연 그 창**에서 온 쪽지인지도 본다(2단계 검수 경미 6).
    if (!trusted(event.origin) || event.source !== frame.contentWindow) return;
    const read = readKisMessage(event.data);
    if (read && read.empty) {
      closeWithout("");
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
      closeWithout(`${opts.notDoneText}${why}`);
      return;
    }
    if (ordNo !== expectedOrdNo) return; // 지금 연 창의 결과가 아니면 넘기지 않는다(서버도 DB로 다시 확인한다)
    cleanup();
    try {
      postForm(returnUrl, data, "_self");
    } catch {
      opts.onPostFail();
    }
  }
  window.addEventListener("message", onMessage);
  closeBtn.addEventListener("click", () => closeWithout(""));
  postForm(action, fields, frame.name);
  return cleanup;
}
