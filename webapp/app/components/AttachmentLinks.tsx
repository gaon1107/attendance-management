"use client";
// 첨부파일 표시 — 다운로드 링크 목록 + (신청자 본인·대기 신청에 한해) 제거 버튼.
//  · 다운로드는 인증 route(/api/request-attachment/[id])가 회사격리·권한을 확인한다.
import { useState } from "react";
import { useRouter } from "next/navigation";

export type AttachmentInfo = { id: string; originalName: string; size: number; mimeType: string };

export function AttachmentLinks({ items, canDelete = false }: { items: AttachmentInfo[]; canDelete?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items || items.length === 0) return null;

  async function del(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await fetch(`/api/request-attachment/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
      {items.map((a) => (
        <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", maxWidth: 220 }}>
          <a
            href={`/api/request-attachment/${a.id}`}
            target="_blank"
            rel="noreferrer"
            title={a.originalName}
            style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            📎 {a.originalName}
          </a>
          {canDelete && (
            <button
              type="button"
              onClick={() => del(a.id)}
              disabled={busy === a.id}
              title="첨부 제거"
              style={{ border: "none", background: "none", color: "var(--danger)", cursor: busy === a.id ? "default" : "pointer", fontSize: 13, fontWeight: 800, lineHeight: 1, opacity: busy === a.id ? 0.5 : 1 }}
            >
              ✕
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
