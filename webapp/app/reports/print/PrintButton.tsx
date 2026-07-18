"use client";
// 법정 근로기록부 인쇄 버튼 — 브라우저 인쇄 대화상자를 열어 "PDF로 저장"할 수 있게 한다.
// PDF 파일명은 브라우저가 document.title을 기본값으로 쓰므로, 기간을 담은 제목을 지정한다.
import { useEffect } from "react";

export function PrintButton({ title }: { title: string }) {
  // 인쇄/저장 시 파일명이 되도록 문서 제목을 설정(마운트 시 1회, setState 아님).
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{ height: 38, padding: "0 16px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit" }}
    >
      🖨 인쇄 / PDF로 저장
    </button>
  );
}
