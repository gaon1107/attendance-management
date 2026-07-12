"use client";
// 회사 첨부문서 — 종류별 슬롯(사업자등록증·인감·통장·공장등록증·기타).
// 업로드는 라우트(/api/company-doc/upload)로 전송(대용량), 삭제는 서버 액션. 완료 후 화면 새로고침.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCompanyDoc } from "@/app/actions/company";

// 종류 라벨(서버 lib과 동일 — lib은 fs를 import해 클라이언트에 못 넣으므로 여기 별도 선언)
const KINDS: { key: string; label: string }[] = [
  { key: "bizReg", label: "사업자등록증" },
  { key: "seal", label: "인감 스캔본" },
  { key: "bankbook", label: "통장 사본" },
  { key: "factory", label: "공장등록증" },
  { key: "etc", label: "기타 문서" },
];

export type DocView = { id: string; kind: string; originalName: string; sizeText: string; uploadedAtText: string };

const cardStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 };

export function CompanyDocsForm({ initialDocs }: { initialDocs: DocView[] }) {
  const router = useRouter();
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: string; text: string; ok: boolean } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const byKind = (k: string) => initialDocs.find((d) => d.kind === k);

  async function onPick(kind: string, file: File | undefined) {
    if (!file) return;
    setMsg(null);
    setBusyKind(kind);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch("/api/company-doc/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setMsg({ kind, text: j.message || "업로드에 실패했습니다.", ok: false });
      } else {
        setMsg({ kind, text: "업로드되었습니다.", ok: true });
        router.refresh();
      }
    } catch {
      setMsg({ kind, text: "네트워크 오류로 업로드하지 못했습니다.", ok: false });
    } finally {
      setBusyKind(null);
      if (inputs.current[kind]) inputs.current[kind]!.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
    }
  }

  async function onDelete(id: string) {
    if (!confirm("이 문서를 삭제할까요?")) return;
    const fd = new FormData();
    fd.append("id", id);
    const r = await deleteCompanyDoc({}, fd);
    if (r.error) alert(r.error);
    else router.refresh();
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>첨부 문서</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16 }}>
        PDF·JPG·PNG, 최대 10MB. 종류별 최신 1개만 보관됩니다(다시 올리면 교체). 관리자만 열람할 수 있습니다.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {KINDS.map(({ key, label }) => {
          const doc = byKind(key);
          const busy = busyKind === key;
          return (
            <div key={key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>

              {doc ? (
                <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5 }}>
                  <a href={`/api/company-doc/${doc.id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none", wordBreak: "break-all" }}>
                    {doc.originalName}
                  </a>
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>{doc.sizeText} · {doc.uploadedAtText}</div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#9CA3AF" }}>미등록</div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: "auto" }}>
                {/* 클릭하면 파일 선택창(윈도우 탐색기)이 열리는 버튼. 실제 input은 숨김. */}
                <label
                  style={{ flex: 1, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: "1px solid var(--primary)", borderRadius: 8, background: doc ? "#fff" : "#EFF6FF", color: "var(--primary)", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, whiteSpace: "nowrap" }}
                >
                  📎 {doc ? "파일 변경" : "파일 선택"}
                  <input
                    ref={(el) => { inputs.current[key] = el; }}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    disabled={busy}
                    onChange={(e) => onPick(key, e.target.files?.[0])}
                    style={{ display: "none" }}
                  />
                </label>
                {doc && (
                  <button
                    type="button"
                    onClick={() => onDelete(doc.id)}
                    disabled={busy}
                    style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: "0 12px", height: 38, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    삭제
                  </button>
                )}
              </div>

              {busy && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>업로드 중...</div>}
              {msg?.kind === key && (
                <div style={{ fontSize: 12, fontWeight: 700, color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
