"use client";
// 대시보드 "오늘 알림"의 최신 공지 — 클릭하면 페이지 이동 대신 모달로 본문을 보여준다.
//  · 공지 화면([공지] 메뉴)이 캘린더로 통합되면서, 여기서 바로 본문을 읽게 한다.
import { useState } from "react";
import { Modal } from "@/app/components/Modal";

export function LatestNoticeModal({
  notice,
}: {
  notice: { title: string; body: string; authorName: string; dateLabel: string };
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ width: "100%", textAlign: "left", padding: "12px 18px", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", fontFamily: "inherit" }}
      >
        <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 4 }}>📢 최신 공지</div>
        <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{notice.title}</div>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={460}
        title={
          <>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#B45309", marginRight: 6 }}>📢 공지</span>
            {notice.title}
          </>
        }
      >
        <div style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{notice.body}</div>
        <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 16 }}>{notice.authorName} · {notice.dateLabel}</div>
      </Modal>
    </>
  );
}
