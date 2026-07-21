"use client";
// 승인 버튼 — 클릭하면 곧바로 처리하지 않고 확인 모달을 먼저 띄운다(관리자 실수 클릭 방지).
//  · 이 버튼이 쓰이는 6개 승인 화면(휴가·근태정정·외출/외근·재택·초과근무·출장)은 모두 관리자 전용이라,
//    여기서 누르는 승인은 항상 "관리자 대리 승인" = 남은 결재선(본부장·대표 등)을 모두 건너뛰고 즉시 최종 확정한다.
//    그래서 남은 결재선이 있으면 그 사실을 경고로 보여준 뒤 한 번 더 확인받는다.
//  · 서버 액션(approveLeave 등)을 action prop으로 받아 name="id"만 넘긴다(반려의 RejectButton과 쌍).
//  · progress: 대기 건의 결재 진행상황 문구(예: "부서장 결재 0/2 · 다음 본부장"). 있으면 = 남은 결재선 존재 → 건너뜀 경고.
//  · 팝업 형식은 공용 Modal(중앙정렬·딤·닫기)로 통일.
import { useState } from "react";
import { Modal } from "@/app/components/Modal";

export function ConfirmApproveButton({
  action,
  requestId,
  progress,
  compact = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  requestId: string;
  progress?: string; // 결재선 진행상황(있으면 건너뜀 경고 표시)
  compact?: boolean; // 표 안에서 쓰는 작은 버튼
}) {
  const [open, setOpen] = useState(false);
  const hasLine = !!(progress && progress.trim()); // 남은 결재선이 있는가

  const btnStyle: React.CSSProperties = {
    height: compact ? 34 : 38,
    padding: compact ? "0 14px" : "0 16px",
    border: "none",
    borderRadius: 8,
    background: "var(--primary)",
    color: "#fff",
    fontFamily: "inherit",
    fontSize: compact ? 14 : 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btnStyle}>
        승인
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="승인 확인" maxWidth={420}>
        {hasLine ? (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, lineHeight: 1.6, margin: 0, wordBreak: "keep-all" }}>
              ⚠️ 남은 결재를 모두 건너뛰고 즉시 최종 승인합니다.
            </p>
            <p style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6, margin: "6px 0 0", wordBreak: "keep-all" }}>
              현재 진행: <b style={{ color: "var(--text)" }}>{progress}</b>
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--text-sub)", lineHeight: 1.6, marginBottom: 12, wordBreak: "keep-all" }}>
            이 신청을 승인할까요?
          </p>
        )}

        <form action={action} onSubmit={() => setOpen(false)}>
          <input type="hidden" name="id" value={requestId} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              취소
            </button>
            <button
              type="submit"
              style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {hasLine ? "건너뛰고 최종 승인" : "승인"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
