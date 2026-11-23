// [개발 전용] 가짜 KIS 서버 — 결제 시험용(2026-11-23 결제 2단계). 운영과 무관하다. 실제 결제를 하지 않는다.
// 쓰는 법: node scripts/fake-kis.cjs  → http://localhost:4599
//   개발 .env에 임시로: KISPG_MID=fakekis00m / KISPG_MERCHANT_KEY=fake-merchant-key / KISPG_API_URL=http://localhost:4599
//                      KISPG_RETURN_URL=http://localhost:3000/api/billing/return   (시험 뒤 반드시 지운다)
//   동작 바꾸기: http://localhost:4599/__mode?approve=ok|slow|mismatch|drop|reject&inquire=approved|not_found|cancelled
// 가짜 KIS 서버(개발 검증 전용) — http://localhost:4599
//  /v2/auth   (form POST)  가짜 결제창 HTML: [승인]·[취소] → window.parent.postMessage({resultCode, data})
//  /v2/payment·/v2/order·/v2/cancel (JSON) 승인·조회·취소 — 동작은 /__mode?approve=ok|mismatch|drop|reject&inquire=approved|not_found|cancelled 로 바꾼다
const http = require("http");
const crypto = require("crypto");
const KEY = process.env.FAKE_KEY || "fake-merchant-key";
const enc = (mid, edi, amt) => crypto.createHash("sha256").update(mid + edi + amt + KEY).digest("hex");
let mode = { approve: "ok", inquire: "approved" };
const tx = new Map(); // tid → { ordNo, amt, status }
const log = [];

function readBody(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
}
function json(res, obj) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:4599");
  if (url.pathname === "/__mode") {
    for (const k of ["approve", "inquire"]) if (url.searchParams.get(k)) mode[k] = url.searchParams.get(k);
    return json(res, { mode, log: log.slice(-20) });
  }
  const raw = await readBody(req);
  if (url.pathname === "/v2/auth") {
    const f = Object.fromEntries(new URLSearchParams(raw));
    const tid = "FAKE" + Date.now().toString(36).toUpperCase();
    const edi = f.ediDate;
    tx.set(tid, { ordNo: f.ordNo, amt: f.goodsAmt, status: "auth" });
    log.push(`auth ${f.ordNo} ${f.goodsAmt} mid=${f.mid} encOk=${f.encData === enc(f.mid, f.ediDate, f.goodsAmt)}`);
    const ok = { resultCode: "0000", data: { resultCd: "0000", resultMsg: "정상처리", payMethod: "CARD", tid, ordNo: f.ordNo, amt: f.goodsAmt, ediDate: edi, encData: enc(f.mid, edi, f.goodsAmt), mbsReserved: "" } };
    const cancel = { resultCode: "9999", data: { resultCd: "9999", resultMsg: "사용자 취소" } };
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:60px;text-align:center">
<h2>가짜 KIS 결제창</h2><p>${f.goodsNm} · ${Number(f.goodsAmt).toLocaleString()}원</p>
<button id="ok" style="font-size:18px;padding:10px 24px">승인</button> <button id="no" style="font-size:18px;padding:10px 24px">취소</button>
<script>document.getElementById("ok").onclick=()=>parent.postMessage(${JSON.stringify(JSON.stringify(ok))},"*");
document.getElementById("no").onclick=()=>parent.postMessage(${JSON.stringify(JSON.stringify(cancel))},"*");</script>`);
  }
  let b = {};
  try { b = JSON.parse(raw || "{}"); } catch {}
  if (url.pathname === "/v2/payment") {
    const t = tx.get(b.tid) || { ordNo: "", amt: b.goodsAmt };
    log.push(`approve ${b.tid} ${b.goodsAmt} mode=${mode.approve} encOk=${b.encData === enc(b.mid, b.ediDate, b.goodsAmt)}`);
    if (mode.approve === "drop") { t.status = "approved"; tx.set(b.tid, t); req.socket.destroy(); return; } // 승인은 됐는데 응답이 끊김
    if (mode.approve === "reject") return json(res, { resultCd: "9999", resultMsg: "한도 초과(가짜)", tid: b.tid });
    if (mode.approve === "slow") await new Promise((r) => setTimeout(r, 4000)); // 승인은 되지만 응답이 4초 늦음
    const amt = mode.approve === "mismatch" ? String(Number(b.goodsAmt) + 100) : b.goodsAmt;
    t.status = "approved"; t.amt = amt; tx.set(b.tid, t);
    return json(res, { resultCd: "3001", resultMsg: "카드 결제 성공", payMethod: "CARD", tid: b.tid, ordNo: t.ordNo, amt, appNo: "12345678", fnNm: "가짜카드", cardNo: "1234-****-****-5678", cardType: "01" });
  }
  if (url.pathname === "/v2/order") {
    const t = tx.get(b.tid);
    log.push(`inquire ${b.tid} mode=${mode.inquire}`);
    if (mode.inquire === "not_found" || !t) return json(res, { resultCd: "OR02", resultMsg: "주문 정보 없음" });
    if (mode.inquire === "cancelled" || t.status === "cancelled") return json(res, { resultCd: "0000", trxStatus: "취소", tid: b.tid, ordNo: t.ordNo, amt: t.amt, payMethod: "CARD", cancelYN: "Y" });
    return json(res, { resultCd: "0000", trxStatus: "승인", tid: b.tid, ordNo: t.ordNo, amt: t.amt, payMethod: "CARD", appNo: "12345678", cancelYN: "N" });
  }
  if (url.pathname === "/v2/cancel") {
    const t = tx.get(b.tid);
    log.push(`cancel ${b.tid} ${b.canAmt}`);
    if (t) t.status = "cancelled";
    return json(res, { resultCd: "2001", resultMsg: "취소 성공", tid: b.tid, amt: b.canAmt });
  }
  res.writeHead(404); res.end();
}).listen(4599, () => console.log("fake KIS on 4599"));
