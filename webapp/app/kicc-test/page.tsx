"use client";
// 아이원(ione24) 결제 연동 — 1단계 테스트 화면
//
// 목적: 정소장님이 준 주소를 실제로 호출해서 "어떤 값(JSON)이 돌아오는지" 눈으로 확인한다.
//  - 근태관리 본체와 분리된 별도 테스트 페이지다. (주소: /kicc-test)
//  - 버튼을 누르면 우리 서버(/api/kicc-test)를 거쳐 아이원 서버를 호출하고, 응답을 그대로 보여준다.
//
// 이 화면은 사이드바에 넣지 않았다. 테스트가 끝나면 통째로 지워도 근태관리에 영향이 없다.

import { useState } from "react";

// 정소장님이 준 기본 호출 주소
const DEFAULT_URL = "http://tapprsys.ione24.com/_appr/card_appr.ashx?pkind=appr";

// 보낼 내용 예시 — ⚠️ 정소장님께 받은 실제 값으로 바꿔서 테스트하세요.
// (KICC 앱카드 승인 API 예시를 기준으로 넣어둠. 1단계에서는 에러 응답이 와도 정상입니다)
const SAMPLE_BODY = `{
  "shopTransactionId": "20260709000000000001",
  "approvalReqDate": "20260709",
  "vanTid": "0788888",
  "certControlNo": "테스트"
}`;

const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 14,
  color: "var(--text)",
  outline: "none",
};
const mono: React.CSSProperties = {
  fontFamily: "'D2Coding', 'Consolas', monospace",
  fontSize: 13,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  margin: 0,
};

type Result = {
  ok: boolean;
  calledUrl?: string;
  method?: string;
  httpStatus?: number;
  httpStatusText?: string;
  responseContentType?: string | null;
  charset?: string;
  json?: unknown;
  jsonError?: string | null;
  rawText?: string;
  error?: string;
  durationMs?: number;
};

export default function KiccTestPage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [method, setMethod] = useState("POST");
  const [contentType, setContentType] = useState("application/json");
  const [authorization, setAuthorization] = useState("");
  const [body, setBody] = useState(SAMPLE_BODY);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function call() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/kicc-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method, contentType, authorization, body }),
      });
      const data = (await res.json()) as Result;
      setResult(data);
    } catch (e) {
      setResult({
        ok: false,
        error: `화면→서버 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  function copyResult() {
    if (!result) return;
    const text = result.rawText ?? result.error ?? JSON.stringify(result, null, 2);
    navigator.clipboard?.writeText(text);
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px 80px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>
        아이원 결제 연동 — 1단계 호출 테스트
      </h1>
      <p style={{ color: "var(--text-sub)", fontSize: 14, margin: "0 0 20px", lineHeight: 1.6 }}>
        정소장님이 준 주소를 실제로 호출해서 <b>어떤 값이 돌아오는지</b> 확인하는 화면입니다.
        <br />
        아래 <b>「아이원 서버 호출하기」</b> 버튼을 누르면 결과가 아래에 그대로 표시됩니다.
        (에러 응답이 와도 1단계는 정상입니다 — 값이 읽히는지 보는 게 목적)
      </p>

      {/* 입력 영역 */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>호출 주소 (정소장님이 준 URL)</label>
          <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 130px" }}>
            <label style={label}>요청 방식</label>
            <select
              style={{ ...input, padding: "0 8px" }}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={label}>Content-Type</label>
            <input
              style={input}
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>
            Authorization <span style={{ fontWeight: 400, color: "var(--text-sub)" }}>(선택 — 필요 시 정소장님 안내대로)</span>
          </label>
          <input
            style={input}
            value={authorization}
            placeholder="비워두어도 됩니다"
            onChange={(e) => setAuthorization(e.target.value)}
          />
        </div>

        <div>
          <label style={label}>
            보낼 내용 (Body){" "}
            <span style={{ fontWeight: 400, color: "var(--danger)" }}>
              ⚠️ 정소장님께 받은 실제 값으로 바꿔서 테스트하세요
            </span>
          </label>
          <textarea
            style={{ ...input, height: 180, padding: "10px 12px", ...mono }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={call}
        disabled={loading}
        style={{
          width: "100%",
          height: 50,
          borderRadius: 10,
          border: "none",
          background: loading ? "#93C5FD" : "var(--primary)",
          color: "#fff",
          fontSize: 16,
          fontWeight: 800,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "호출 중… (최대 30초)" : "아이원 서버 호출하기 →"}
      </button>

      {/* 결과 영역 */}
      {result && (
        <div style={{ ...card, marginTop: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: result.ok ? "var(--success)" : "var(--danger)",
              }}
            >
              {result.ok ? "✅ 호출 완료 — 응답을 받았습니다" : "❌ 호출 실패"}
            </span>
            <button
              onClick={copyResult}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              결과 복사
            </button>
          </div>

          {/* 실패(네트워크 등) 메시지 */}
          {!result.ok && result.error && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: 12,
                marginBottom: 14,
                color: "var(--danger)",
                fontSize: 14,
              }}
            >
              {result.error}
            </div>
          )}

          {/* 호출 요약 */}
          <dl style={{ margin: 0, fontSize: 13, lineHeight: 1.9 }}>
            <Row k="호출한 주소" v={result.calledUrl} />
            <Row k="요청 방식" v={result.method} />
            {result.httpStatus !== undefined && (
              <Row k="HTTP 상태" v={`${result.httpStatus} ${result.httpStatusText ?? ""}`} />
            )}
            {result.responseContentType && (
              <Row k="응답 형식" v={`${result.responseContentType} (해석: ${result.charset})`} />
            )}
            {result.durationMs !== undefined && (
              <Row k="걸린 시간" v={`${result.durationMs} ms`} />
            )}
          </dl>

          {/* JSON 값 (정소장님이 body에 떨어뜨리는 결과값) */}
          {result.json != null && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>📦 돌아온 값 (JSON — 이게 정소장님이 준 결과값)</div>
              <pre
                style={{
                  ...mono,
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 8,
                  padding: 14,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(result.json, null, 2)}
              </pre>
            </div>
          )}

          {result.jsonError && (
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--warning)" }}>
              (참고: 본문이 완전한 JSON은 아닙니다 — {result.jsonError})
            </p>
          )}

          {/* 원본 응답 (그대로) */}
          {result.rawText !== undefined && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>📄 원본 응답 (서버가 보낸 그대로)</div>
              <pre
                style={{
                  ...mono,
                  background: "#F9FAFB",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 14,
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                {result.rawText || "(응답 본문이 비어 있습니다)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 결과 요약 한 줄 (라벨 : 값)
function Row({ k, v }: { k: string; v?: string | null }) {
  if (v == null || v === "") return null;
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <dt style={{ flex: "0 0 100px", color: "var(--text-sub)", fontWeight: 700 }}>{k}</dt>
      <dd style={{ margin: 0, wordBreak: "break-all" }}>{v}</dd>
    </div>
  );
}
