// [개발 전용] 가짜 KIS 서버 — 결제 시험용(2026-11-23 결제 2단계). 운영과 무관하다. 실제 결제를 하지 않는다.
// 쓰는 법: node scripts/fake-kis.cjs  → http://localhost:4599
//   개발 .env에 임시로: KISPG_MID=fakekis00m / KISPG_MERCHANT_KEY=fake-merchant-key / KISPG_API_URL=http://localhost:4599
//                      KISPG_RETURN_URL=http://localhost:3000/api/billing/return   (시험 뒤 반드시 지운다)
//   동작 바꾸기: http://localhost:4599/__mode?approve=ok|slow|mismatch|drop|reject&inquire=approved|not_found|cancelled
//   자동결제(2026-11-23 결제 3단계) — 개발 .env에 임시로 KISPG_BILLING_MID=fakebil00m / KISPG_BILLING_MERCHANT_KEY=fake-merchant-key
//     카드 등록 확정: /__mode?issue=ok|reject|drop      빌키 결제: /__mode?bpay=ok|reject|drop|mismatch      빌키 삭제: /__mode?bdel=ok|fail
// 가짜 KIS 서버(개발 검증 전용) — http://localhost:4599
//  /v2/auth   (form POST)  가짜 결제창 HTML: [승인]·[취소] → window.parent.postMessage({resultCode, data})
//  /v2/payment·/v2/order·/v2/cancel (JSON) 승인·조회·취소 — 동작은 /__mode?approve=ok|mismatch|drop|reject&inquire=approved|not_found|cancelled 로 바꾼다
const http = require("http");
const crypto = require("crypto");
const KEY = process.env.FAKE_KEY || "fake-merchant-key";
const enc = (mid, edi, amt) => crypto.createHash("sha256").update(mid + edi + amt + KEY).digest("hex");
// 취소(일반·빌링 공통, 2026-11-23 결제 6단계 운영자 취소 시험): /__mode?cancel=ok|fail|drop (drop = 취소는 됐는데 응답이 끊김)
let mode = { approve: "ok", inquire: "approved", issue: "ok", bpay: "ok", bdel: "ok", cancel: "ok" };
const tx = new Map(); // tid → { ordNo, amt, status, billing }
const bids = new Set(); // 살아 있는 가짜 빌키
const log = [];

function readBody(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
}
function json(res, obj) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:4599");
  if (url.pathname === "/__mode") {
    for (const k of ["approve", "inquire", "issue", "bpay", "bdel", "cancel"]) if (url.searchParams.get(k)) mode[k] = url.searchParams.get(k);
    return json(res, { mode, log: log.slice(-30) });
  }
  const raw = await readBody(req);
  if (url.pathname === "/v2/auth") {
    const f = Object.fromEntries(new URLSearchParams(raw));
    const tid = "FAKE" + Date.now().toString(36).toUpperCase();
    const edi = f.ediDate;
    tx.set(tid, { ordNo: f.ordNo, amt: f.goodsAmt, status: "auth", billing: String(f.ordNo || "").startsWith("HRB-") });
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
  if (url.pathname === "/v2/payment" && tx.get(b.tid) && tx.get(b.tid).billing) {
    // 카드 등록 확정(돈 안 빠짐) — 빌키를 준다
    const t = tx.get(b.tid);
    log.push(`issue ${b.tid} ${b.goodsAmt} mode=${mode.issue} encOk=${b.encData === enc(b.mid, b.ediDate, b.goodsAmt)}`);
    if (mode.issue === "drop") { req.socket.destroy(); return; }
    if (mode.issue === "reject") return json(res, { resultCd: "F113", resultMsg: "카드 등록 불가(가짜)", tid: b.tid });
    const bid = "fakebid" + crypto.randomBytes(8).toString("hex");
    bids.add(bid);
    return json(res, { resultCd: "0000", resultMsg: "정상처리", tid: b.tid, ordNo: t.ordNo, bid, fnNm: "가짜카드", cardNo: "1234-****-****-9999", cardType: "01" });
  }
  if (url.pathname === "/v2/billing/payment") {
    const tid = "FAKEB" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex");
    log.push(`bpay ${b.ordNo} ${b.goodsAmt} mode=${mode.bpay} bidOk=${bids.has(b.bid)} encOk=${b.encData === enc(b.mid, b.ediDate, b.goodsAmt)}`);
    if (!bids.has(b.bid)) return json(res, { resultCd: "F201", resultMsg: "없는 빌키(가짜)" });
    if (mode.bpay === "reject") return json(res, { resultCd: "F112", resultMsg: "잔액 부족(가짜)", ordNo: b.ordNo });
    const amt = mode.bpay === "mismatch" ? String(Number(b.goodsAmt) + 100) : b.goodsAmt;
    tx.set(tid, { ordNo: b.ordNo, amt, status: "approved" });
    if (mode.bpay === "drop") { req.socket.destroy(); return; } // 결제는 됐는데 응답이 끊김
    return json(res, { resultCd: "0000", resultMsg: "정상처리", payMethod: "CARD", tid, ordNo: b.ordNo, amt, appNo: "87654321", fnNm: "가짜카드", cardNo: "1234-****-****-9999", cardType: "01", cancelYN: "N" });
  }
  if (url.pathname === "/v2/billing/cancel") {
    const t = tx.get(b.tid);
    log.push(`bcancel ${b.tid} ${b.canAmt} mode=${mode.cancel}`);
    if (mode.cancel === "fail") return json(res, { resultCd: "9999", resultMsg: "취소 실패(가짜)", tid: b.tid });
    if (t) t.status = "cancelled";
    if (mode.cancel === "drop") { req.socket.destroy(); return; }
    return json(res, { resultCd: "2001", resultMsg: "취소 성공", tid: b.tid, amt: b.canAmt });
  }
  if (url.pathname === "/v2/billing/delete") {
    log.push(`bdel mode=${mode.bdel} known=${bids.has(b.bid)} encOk=${b.encData === enc(b.mid, b.ediDate, b.bid)}`);
    if (mode.bdel === "fail") return json(res, { resultCd: "9999", resultMsg: "삭제 실패(가짜)" });
    bids.delete(b.bid);
    return json(res, { resultCd: "0000", resultMsg: "삭제 성공" });
  }
  if (url.pathname === "/__bids") return json(res, { count: bids.size });
  if (url.pathname === "/__addbid") { bids.add(url.searchParams.get("bid") || ""); return json(res, { ok: true }); } // 시험 라우트가 알려진 빌키를 심을 때
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
    let t = b.tid ? tx.get(b.tid) : undefined;
    let foundTid = b.tid;
    if (!t && b.ordNo) for (const [k, v] of tx) if (v.ordNo === b.ordNo && v.status !== "auth") { t = v; foundTid = k; }
    b.tid = foundTid;
    log.push(`inquire ${b.tid || b.ordNo} mode=${mode.inquire}`);
    // 인증만 된 거래(승인 전)·카드 등록은 결제가 아니다 → 결제 없음
    if (mode.inquire === "not_found" || !t || t.status === "auth") return json(res, { resultCd: "OR02", resultMsg: "주문 정보 없음" });
    if (mode.inquire === "cancelled" || t.status === "cancelled") return json(res, { resultCd: "0000", trxStatus: "취소", tid: b.tid, ordNo: t.ordNo, amt: t.amt, payMethod: "CARD", cancelYN: "Y" });
    return json(res, { resultCd: "0000", trxStatus: "승인", tid: b.tid, ordNo: t.ordNo, amt: t.amt, payMethod: "CARD", appNo: "12345678", cancelYN: "N" });
  }
  if (url.pathname === "/v2/cancel") {
    const t = tx.get(b.tid);
    log.push(`cancel ${b.tid} ${b.canAmt} mode=${mode.cancel}`);
    if (mode.cancel === "fail") return json(res, { resultCd: "9999", resultMsg: "취소 실패(가짜)", tid: b.tid });
    if (t) t.status = "cancelled";
    if (mode.cancel === "drop") { req.socket.destroy(); return; }
    return json(res, { resultCd: "2001", resultMsg: "취소 성공", tid: b.tid, amt: b.canAmt });
  }
  res.writeHead(404); res.end();
}).listen(4599, () => console.log("fake KIS on 4599"));
