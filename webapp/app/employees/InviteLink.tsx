"use client";
// 초대 링크 표시 + 복사 — 전체 URL(도메인 포함)은 브라우저에서 만든다(어디에 배포되든 맞게).
import { useEffect, useState } from "react";

export function InviteLink({ path }: { path: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.origin + path);
  }, [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        style={{ flex: 1, minWidth: 0, height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", fontFamily: "inherit", fontSize: 13, color: "var(--text-sub)" }}
      />
      <button
        type="button"
        onClick={copy}
        style={{ height: 38, padding: "0 14px", border: "1px solid var(--primary)", borderRadius: 8, background: copied ? "var(--primary)" : "#fff", color: copied ? "#fff" : "var(--primary)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
      >
        {copied ? "복사됨 ✓" : "복사"}
      </button>
    </div>
  );
}
