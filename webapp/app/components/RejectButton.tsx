"use client";
// 반려 버튼 — 클릭하면 사유 입력 모달을 열고, 사유를 적어야 반려가 확정된다(사유 필수).
// 결재함·관리자 휴가승인·관리자 근태정정승인 등에서 공용으로 쓴다(레이아웃 무관: 모달이라 표/카드 어디든 안전).
// 서버 액션(rejectLeave/rejectCorrection 등)을 action prop으로 받아 name="id"·name="comment"를 넘긴다.
//  · 팝업 형식은 공용 Modal(중앙정렬·딤·닫기)로 통일(승인 확인창과 쌍).
import { useState } from "react";
import { Modal } from "@/app/components/Modal";

export function RejectButton({
  action,
  requestId,
  compact = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  requestId: string;
  compact?: boolean; // 표 안에서 쓰는 작은 버튼
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const canSubmit = reason.trim().length > 0;

  const btnStyle: React.CSSProperties = {
    height: compact ? 34 : 38,
    padding: compact ? "0 14px" : "0 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "#fff",
    color: "var(--danger)",
    fontFamily: "inherit",
    fontSize: compact ? 14 : 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btnStyle}>
        반려
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="반려 사유" maxWidth={420}>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 12, lineHeight: 1.6, wordBreak: "keep-all" }}>
          반려 사유를 입력해 주세요. <b>신청자에게 그대로 표시</b>됩니다.
        </p>
        <form action={action} onSubmit={() => setOpen(false)}>
          <input type="hidden" name="id" value={requestId} />
          <textarea
            name="comment"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
            autoFocus
            rows={3}
            placeholder="예: 해당 기간 인력이 부족하여 반려합니다."
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontFamily: "inherit",
              fontSize: 14,
              resize: "vertical",
            }}
          />
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>{reason.length}/500</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                height: 38,
                padding: "0 16px",
                border: "none",
                borderRadius: 8,
                background: canSubmit ? "var(--danger)" : "var(--border)",
                color: "#fff",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                cursor: canSubmit ? "pointer" : "default",
              }}
            >
              반려 확정
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
