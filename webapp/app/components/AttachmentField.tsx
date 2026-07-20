"use client";
// 신청 폼용 첨부파일 선택기 — 파일을 골라 두었다가, 신청(서버액션)이 성공해 신청 id가 나오면
// 그 id로 업로드 route에 올린다. (서버액션 4MB 한도를 피하려 파일은 별도 fetch 업로드)
//  · 클라이언트 사전검증(개수·크기·형식)은 UX용. 최종 검증·강제는 서버(업로드 route)가 한다.
//  · lib/request-attachment.ts는 fs 등을 import하므로 클라이언트에서 쓸 수 없어 상수를 여기 복제한다(서버와 값 일치 유지).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_FILES = 5;
const MAX_MB = 10;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const EXT_OK = /\.(pdf|jpe?g|png)$/i;

export function AttachmentField({
  requestType,
  submit,
}: {
  requestType: string;
  submit: { ok?: boolean; id?: string };
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const handledId = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // 신청이 성공(ok+id)하면, 골라둔 파일을 그 신청에 업로드한다. (id마다 1회)
  useEffect(() => {
    if (!submit.ok || !submit.id || handledId.current === submit.id) return;
    handledId.current = submit.id;
    const id = submit.id;
    if (files.length === 0) {
      router.refresh(); // 첨부 없이 신청만 — 목록 갱신
      return;
    }
    (async () => {
      setStatus("uploading");
      setStatusMsg("");
      const fd = new FormData();
      fd.set("requestType", requestType);
      fd.set("requestId", id);
      files.forEach((f) => fd.append("files", f));
      try {
        const res = await fetch("/api/request-attachment/upload", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        if (!res.ok) {
          setStatus("error");
          setStatusMsg(data.message || "첨부 업로드에 실패했습니다. 신청은 접수되었으니 취소 후 다시 시도하거나 관리자에게 문의하세요.");
          return;
        }
        setStatus("done");
        setFiles([]);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } catch {
        setStatus("error");
        setStatusMsg("첨부 업로드 중 오류가 발생했습니다. 신청은 접수되었습니다.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submit.ok, submit.id]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalError("");
    const picked = Array.from(e.target.files ?? []);
    const next = [...files];
    for (const f of picked) {
      if (!EXT_OK.test(f.name)) { setLocalError("PDF·JPG·PNG 파일만 첨부할 수 있습니다."); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { setLocalError(`파일당 최대 ${MAX_MB}MB까지 첨부할 수 있습니다.`); continue; }
      if (next.length >= MAX_FILES) { setLocalError(`첨부는 최대 ${MAX_FILES}개까지 가능합니다.`); break; }
      // 같은 이름·크기 중복은 건너뜀
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    setFiles(next);
    if (inputRef.current) inputRef.current.value = ""; // 같은 파일 다시 선택 가능하게 초기화
  }

  function removeAt(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

  return (
    <div>
      <label style={labelStyle}>첨부파일 (선택 · 최대 {MAX_FILES}개, 개당 {MAX_MB}MB · PDF·JPG·PNG)</label>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={onPick}
        style={{ fontSize: 13, color: "var(--text-sub)" }}
      />
      {files.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {f.name}</span>
              <span style={{ color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{(f.size / 1024 / 1024).toFixed(1)}MB</span>
              <button type="button" onClick={() => removeAt(i)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>제거</button>
            </li>
          ))}
        </ul>
      )}
      {localError && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{localError}</div>}
      {status === "uploading" && <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>첨부 업로드 중…</div>}
      {status === "done" && <div style={{ fontSize: 12, color: "var(--success)", fontWeight: 700, marginTop: 6 }}>첨부가 업로드되었습니다.</div>}
      {status === "error" && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{statusMsg}</div>}
    </div>
  );
}
