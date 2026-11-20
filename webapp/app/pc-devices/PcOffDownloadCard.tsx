"use client";
// [PC관리] 설치 주소 카드 — 관리자가 직원에게 보낼 내려받기 주소와 안내문을 보여주고 복사하게 한다(2026-11-20).
//  · 주소·문구는 lib/pcoff-download.ts 단일 출처. 전체 주소는 브라우저 주소(window.location.origin)로 만든다.
//  · 첫 그림(서버 렌더)에는 경로만 그리고, 화면이 뜬 뒤 브라우저 주소로 채운다(하이드레이션 불일치 방지).
import { useEffect, useState } from "react";
import { PC_OFF_DOWNLOAD_PATH, PC_OFF_IS_PREVIEW, pcOffGuideText } from "@/lib/pcoff-download";

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--bg)", fontFamily: "inherit", fontSize: 13, color: "var(--text)",
};
const btnStyle: React.CSSProperties = {
  height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff",
  fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap",
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // 복사가 막힌 환경(권한 없음 등) — 조용히 끝내지 않고 직접 복사하라고 알린다(검수 경미)
      setCopied(null);
      setFailed(true);
    }
  }
  return { copied, failed, copy };
}

export function PcOffDownloadCard() {
  const [origin, setOrigin] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 주소는 화면이 뜬 뒤에만 알 수 있다(1회)
  useEffect(() => setOrigin(window.location.origin), []);
  const { copied, failed, copy } = useCopy();
  const url = `${origin}${PC_OFF_DOWNLOAD_PATH}`;
  const guide = pcOffGuideText(origin);

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>직원에게 보낼 설치 주소</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 12px", lineHeight: 1.6, wordBreak: "keep-all" }}>
        아래 주소나 안내문을 복사해 카톡·문자로 보내 주세요. 직원이 회사 PC에서 내려받아 실행한 뒤,
        근태 앱 [계정 → 내 PC 연결]에서 받은 6자리 연결코드를 넣으면 연결됩니다.
        {PC_OFF_IS_PREVIEW && (
          <>
            <br />
            <span style={{ color: "#B45309", fontWeight: 700 }}>
              지금은 시험판입니다 — PC를 다시 켜면 프로그램을 다시 실행해야 하고, 서버 주소를 직접 입력해야 합니다(정식 설치 파일에서 자동으로 바뀝니다).
            </span>
          </>
        )}
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input readOnly value={origin ? url : PC_OFF_DOWNLOAD_PATH} onFocus={(e) => e.currentTarget.select()} aria-label="설치 주소" style={inputStyle} />
        <button type="button" onClick={() => copy("url", url)} disabled={!origin} style={btnStyle}>
          {copied === "url" ? "복사됨 ✓" : "주소 복사"}
        </button>
      </div>

      <textarea
        readOnly
        value={origin ? guide : ""}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="직원 안내문"
        rows={PC_OFF_IS_PREVIEW ? 13 : 11}
        style={{ ...inputStyle, width: "100%", height: "auto", padding: "10px 12px", lineHeight: 1.6, resize: "vertical", whiteSpace: "pre-wrap" }}
      />
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={() => copy("guide", guide)} disabled={!origin} style={btnStyle}>
          {copied === "guide" ? "복사됨 ✓" : "안내문 복사"}
        </button>
        {failed && (
          <span style={{ marginLeft: 10, fontSize: 12, color: "var(--danger)" }}>
            복사가 막혀 있습니다. 칸을 눌러 전체 선택한 뒤 Ctrl+C로 복사해 주세요.
          </span>
        )}
      </div>
    </div>
  );
}
