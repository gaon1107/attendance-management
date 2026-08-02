"use client";
// 승인 취소 버튼 — 이미 승인된 휴가를 되돌린다(검수 M-2). [휴가 승인] 화면의 "처리 내역"에서만 쓴다.
//  · 반려 버튼(RejectButton)과 같은 형식: 클릭 → 사유 입력 모달 → 사유를 적어야 확정.
//  · 다른 점: 이미 확정된 근태를 되돌리는 일이라 **무엇이 바뀌는지 먼저 보여주고** 확인을 받는다.
//    특히 지난 날짜면 그날이 휴가에서 **결근으로 바뀌므로** 빨간 경고를 띄운다.
import { useState } from "react";
import { Modal } from "@/app/components/Modal";

export function CancelLeaveButton({
  action,
  requestId,
  name,
  summary,
  hasPastDate,
}: {
  action: (formData: FormData) => void | Promise<void>;
  requestId: string;
  name: string; // 신청자 이름(누구 휴가를 되돌리는지 확인용)
  summary: string; // 예: "연차 (08/01 ~ 08/03) · 3일"
  hasPastDate: boolean; // 휴가 기간에 오늘 이전 날짜가 들어있는가(결근 전환 경고용)
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const canSubmit = reason.trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          height: 30,
          padding: "0 12px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "#fff",
          color: "var(--danger)",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        승인 취소
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="휴가 승인 취소" maxWidth={460}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          {name} · {summary}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 12, lineHeight: 1.6, wordBreak: "keep-all" }}>
          이 휴가의 승인을 되돌립니다. <b>차감됐던 연차는 자동으로 돌아오고</b>, 그 날짜에 다시 휴가를 신청할 수 있게 됩니다.
          기록은 지워지지 않고 <b>&ldquo;승인 취소&rdquo;</b>로 남습니다.
        </p>
        {hasPastDate && (
          <p
            style={{
              fontSize: 13,
              color: "var(--danger)",
              fontWeight: 700,
              lineHeight: 1.6,
              wordBreak: "keep-all",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 12,
            }}
          >
            ⚠ 이미 지난 날짜가 들어 있습니다. 취소하면 그날은 휴가가 아니게 되어 <b>출근 기록이 없으면 결근으로 바뀝니다.</b>{" "}
            근태현황·리포트의 숫자도 함께 바뀝니다.
          </p>
        )}
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
            placeholder="예: 결재자가 잘못 승인하여 취소합니다."
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
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>
            취소 사유는 <b>신청자에게 그대로 표시</b>됩니다 · {reason.length}/500
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              닫기
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
              승인 취소 확정
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
