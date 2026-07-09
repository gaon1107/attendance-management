"use client";
// 아이원(ione24) 결제 연동 — 호출 테스트 화면
//
// 목적: 아이원이 준 실제 파라미터로 서버를 호출해서
//   ① 응답 값(및 message)을 확인하고
//   ② 실제 카드 결제 화면이 뜨는지까지 확인한다.
//  - 근태관리 본체와 분리된 별도 테스트 페이지다. (주소: /kicc-test)
//  - 테스트가 끝나면 통째로 지워도 근태관리에 영향이 없다.

import { useEffect, useState } from "react";

// 기본 호출 주소 (파라미터는 아래에서 따로 보냄)
const DEFAULT_URL = "http://tapprsys.ione24.com/_appr/card_appr.ashx";

// 14자리 유니크 요청번호 생성: 연월일시분초(12) + 순번 2자리
function genRequestKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts =
    String(d.getFullYear()).slice(2) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds());
  const seq = p(Math.floor(Math.random() * 100));
  return ts + seq; // 12 + 2 = 14자리
}

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
  // 호출 주소
  const [url, setUrl] = useState(DEFAULT_URL);

  // 매번 바뀌는 값
  const [amt, setAmt] = useState("11000");
  const [requestkey, setRequestkey] = useState("");

  // 고정 값 (아이원/학원 정보)
  const [pkind, setPkind] = useState("appr");
  const [sitekey, setSitekey] = useState("2008");
  const [terminal, setTerminal] = useState("0788888");
  const [cpname, setCpname] = useState("gaon");
  const [cpnum, setCpnum] = useState("1178119949");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // 화면 처음 열릴 때 requestkey 자동 생성 (서버/브라우저 시간 차이로 인한 오류 방지 위해 마운트 후 생성)
  useEffect(() => {
    setRequestkey(genRequestKey());
  }, []);

  // 보낼 파라미터 7개를 한 곳에서 만든다
  function buildParams(): Record<string, string> {
    return { pkind, sitekey, amt, requestkey, terminal, cpname, cpnum };
  }

  // ① 값 확인 — 우리 서버를 거쳐 호출하고 응답을 보여준다
  async function checkValue() {
    setLoading(true);
    setResult(null);
    try {
      const body = new URLSearchParams(buildParams()).toString();
      const res = await fetch("/api/kicc-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          method: "POST",
          contentType: "application/x-www-form-urlencoded",
          body,
        }),
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

  // ② 실제 결제화면 열기 — 브라우저가 직접 그 주소로 폼을 보내 진짜 결제 화면을 새 창에 띄운다
  function openPaymentScreen() {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    form.target = "_blank"; // 새 탭에서 결제 화면 열기
    Object.entries(buildParams()).forEach(([k, v]) => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = k;
      inp.value = v;
      form.appendChild(inp);
    });
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  function copyResult() {
    if (!result) return;
    const text = result.rawText ?? result.error ?? JSON.stringify(result, null, 2);
    navigator.clipboard?.writeText(text);
  }

  // 응답 JSON에서 message 뽑기 (에러 시 사용자에게 보여줄 내용)
  const message =
    result?.json && typeof result.json === "object" && result.json !== null
      ? (result.json as Record<string, unknown>).message
      : null;
  const messageText = typeof message === "string" && message.trim() ? message : null;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px 80px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>
        아이원 결제 연동 — 호출 테스트
      </h1>
      <p style={{ color: "var(--text-sub)", fontSize: 14, margin: "0 0 20px", lineHeight: 1.6 }}>
        아래 값으로 아이원 서버를 호출합니다.
        <br />
        <b>「실제 결제화면 열기」</b>를 누르면 새 창에 진짜 카드 결제 화면이 뜨고,
        <b>「값 확인」</b>을 누르면 서버가 돌려준 응답을 아래에서 볼 수 있습니다.
      </p>

      {/* 결제 정보 — 매번 바뀌는 값 */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>결제 정보</div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>금액 (amt) · 원</label>
          <input
            style={input}
            value={amt}
            inputMode="numeric"
            onChange={(e) => setAmt(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>

        <div>
          <label style={label}>요청 고유번호 (requestkey) · 14자리, 매 결제마다 새로</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
              value={requestkey}
              onChange={(e) => setRequestkey(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setRequestkey(genRequestKey())}
              style={{
                flex: "0 0 auto",
                height: 42,
                padding: "0 16px",
                borderRadius: 8,
                border: "1px solid var(--primary)",
                background: "#fff",
                color: "var(--primary)",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              새로 생성
            </button>
          </div>
        </div>
      </div>

      {/* 고정 정보 — 아이원/학원 정보 */}
      <div style={{ ...card, marginBottom: 16, background: "#F9FAFB" }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>고정 정보</div>
        <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 14 }}>
          아이원·학원 정보라 평소엔 바꾸지 않습니다. (안내가 있을 때만 수정)
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="pkind (처리종류)" value={pkind} onChange={setPkind} />
          <Field label="sitekey (사이트키)" value={sitekey} onChange={setSitekey} />
          <Field label="terminal (터미널ID)" value={terminal} onChange={setTerminal} />
          <Field label="cpname (학원명)" value={cpname} onChange={setCpname} />
          <Field label="cpnum (사업자번호)" value={cpnum} onChange={setCpnum} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={label}>호출 주소</label>
          <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
      </div>

      {/* 두 개의 실행 버튼 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={checkValue}
          disabled={loading}
          style={{
            flex: 1,
            minWidth: 200,
            height: 50,
            borderRadius: 10,
            border: "1px solid var(--primary)",
            background: "#fff",
            color: "var(--primary)",
            fontSize: 16,
            fontWeight: 800,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "호출 중… (최대 30초)" : "값 확인 (응답 보기)"}
        </button>
        <button
          onClick={openPaymentScreen}
          style={{
            flex: 1,
            minWidth: 200,
            height: 50,
            borderRadius: 10,
            border: "none",
            background: "var(--primary)",
            color: "#fff",
            fontSize: 16,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          실제 결제화면 열기 →
        </button>
      </div>

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

          {/* 사용자에게 보여줄 message (아이원 지시: message에 내용 있으면 사용자에게 표시) */}
          {messageText && (
            <div
              style={{
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                borderRadius: 8,
                padding: 14,
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", marginBottom: 4 }}>
                🔔 사용자에게 보여줄 안내(message)
              </div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{messageText}</div>
            </div>
          )}

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

          {/* JSON 값 */}
          {result.json != null && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...label, marginBottom: 8 }}>📦 돌아온 값 (JSON — 서버가 준 결과값)</div>
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
              (참고: 본문이 완전한 JSON은 아닙니다 — 정상 결제 화면(HTML)일 수 있어요. 아래 원본 확인)
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

// 고정 정보 입력 한 칸
function Field({
  label: lbl,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label style={label}>{lbl}</label>
      <input style={input} value={value} onChange={(e) => onChange(e.target.value)} />
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
