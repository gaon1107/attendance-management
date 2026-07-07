"use client";
// 공지 작성 폼(관리자) — 제목 + 내용.
import { useActionState, useRef } from "react";
import { createNotice } from "@/app/actions/notice";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0 12px", height: 44, border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, color: "var(--text)", outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function NoticeForm() {
  const [state, formAction, pending] = useActionState(createNotice, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await formAction(fd);
        formRef.current?.reset();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div>
        <label style={labelStyle}>제목</label>
        <input name="title" type="text" placeholder="예: 7월 워크샵 안내" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>내용</label>
        <textarea name="body" rows={4} placeholder="공지 내용을 입력하세요." style={{ ...inputStyle, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }} />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>공지를 등록했습니다.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 46, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 26px" }}
      >
        {pending ? "등록 중..." : "공지 등록"}
      </button>
    </form>
  );
}
