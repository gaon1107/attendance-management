"use client";
// 회사 로고 — 사이드바(왼쪽 메뉴) 위에 표시할 이미지. 업로드/미리보기/삭제.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCompanyLogo } from "@/app/actions/company";

const cardStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 };

export function CompanyLogoForm({ hasLogo, version }: { hasLogo: boolean; version: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/company-logo/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setMsg({ text: j.message || "업로드에 실패했습니다.", ok: false });
      } else {
        setMsg({ text: "로고가 반영되었습니다. 왼쪽 메뉴 위를 확인하세요.", ok: true });
        router.refresh();
      }
    } catch {
      setMsg({ text: "네트워크 오류로 업로드하지 못했습니다.", ok: false });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete() {
    if (!confirm("회사 로고를 삭제할까요? (사이드바가 '근' 글자로 돌아갑니다)")) return;
    const r = await deleteCompanyLogo({});
    if (r.error) alert(r.error);
    else router.refresh();
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>회사 로고</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16 }}>
        왼쪽 메뉴(사이드바) 맨 위에 표시됩니다. PNG·JPG, 2MB 이하. 정사각형 이미지를 권장합니다.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* 미리보기 */}
        <div style={{ width: 56, height: 56, borderRadius: 12, background: hasLogo ? "#fff" : "var(--primary)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/company-logo?v=${encodeURIComponent(version)}`} alt="회사 로고" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ color: "#fff", fontSize: 22, fontWeight: 700 }}>근</span>
          )}
        </div>

        {/* 업로드 버튼(라벨) — 클릭하면 파일 선택창이 열린다. input은 숨김. */}
        <label
          style={{ height: 44, padding: "0 18px", display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--primary)", borderRadius: 8, background: "#fff", color: "var(--primary)", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          📷 {hasLogo ? "로고 변경" : "로고 파일 선택"}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => onPick(e.target.files?.[0])}
            style={{ display: "none" }}
          />
        </label>

        {hasLogo && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            style={{ height: 44, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            삭제
          </button>
        )}
      </div>

      {busy && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 10 }}>업로드 중...</div>}
      {msg && <div style={{ fontSize: 13, fontWeight: 700, marginTop: 10, color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</div>}
    </div>
  );
}
