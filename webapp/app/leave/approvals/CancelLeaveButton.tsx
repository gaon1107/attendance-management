"use client";
// 승인 취소 버튼 — 이미 승인된 휴가를 되돌린다(검수 M-2). [휴가 승인] 화면의 "처리 내역"에서만 쓴다.
//  · 반려 버튼(RejectButton)과 같은 형식: 클릭 → 사유 입력 모달 → 사유를 적어야 확정.
//  · 다른 점 ①: 이미 확정된 근태를 되돌리는 일이라 **무엇이 바뀌는지 먼저 정확히 보여주고** 확인을 받는다.
//    - 연차를 깎지 않는 종류(병가·경조·공가·특별·조퇴)는 "연차가 돌아온다"고 말하면 거짓말이 된다(검수 C-2).
//    - 작년 휴가는 **올해 잔여가 늘지 않는다** — 잔여는 "휴가 시작일의 연도"로 귀속되기 때문(검수 C-1, lib/leave.ts).
//    - 지난 날짜는 결근으로 바뀌고, 출근한 날이면 지각·조퇴 면제가 풀린다(검수 M-1).
//  · 다른 점 ②: 되돌릴 수 없는 작업이라 **실패를 조용히 넘기지 않는다** — 서버가 거부하면 모달을 닫지 않고 이유를 보여준다.
import { useState, useTransition } from "react";
import { Modal } from "@/app/components/Modal";

export function CancelLeaveButton({
  action,
  requestId,
  name,
  summary,
  hasPastDate,
  deducts,
  leaveYear,
  serverYear,
}: {
  action: (prev: { error?: string; ok?: boolean }, formData: FormData) => Promise<{ error?: string; ok?: boolean }>;
  requestId: string;
  name: string; // 신청자 이름(누구 휴가를 되돌리는지 확인용)
  summary: string; // 예: "연차 (08/01 ~ 08/03) · 3일"
  hasPastDate: boolean; // 휴가 기간에 오늘 이전 날짜가 들어있는가(결근 전환 경고용)
  deducts: boolean; // 연차에서 깎이는 종류인가(연차·반차만 true)
  leaveYear: number; // 이 휴가가 귀속되는 해(=시작일 연도). 잔여 계산이 이 기준이다
  serverYear: number; // 화면을 그릴 때의 연도(대비용 기본값)
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nowYear, setNowYear] = useState<number | null>(null); // 모달을 열 때 다시 잰다
  const [pending, startTransition] = useTransition();
  const canSubmit = reason.trim().length > 0 && !pending;

  // 화면을 밤새 열어둔 채 자정을 넘기면 서버가 준 연도가 어제 것이 된다 → 모달을 열 때 지금 연도를 다시 잰다(검수 M-N3).
  const openModal = () => {
    setNowYear(new Date().getFullYear());
    setError(null); // 지난 시도의 오류가 새 시도에 남아 오해를 주지 않게(검수 M-N2)
    setOpen(true);
  };
  // 처리 중에는 닫지 않는다 — 닫아버리면 뒤늦게 온 실패 메시지가 사라져 "닫혔으니 됐겠지"가 된다(검수 C-N2).
  const closeModal = () => {
    if (!pending) setOpen(false);
  };

  // 성공했을 때만 닫는다. 실패하면 적어둔 사유를 그대로 둔 채 이유를 보여준다(저장 안 됐다는 사실을 알려야 한다).
  const submit = (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await action({}, formData);
        if (res?.error) setError(res.error);
        else {
          setReason("");
          setOpen(false);
        }
      } catch {
        // 통신 끊김·서버 재시작 등. 그냥 던지면 화면 전체가 오류 페이지로 바뀌어 실행 여부조차 알 수 없다(검수 M-N1).
        setError("통신에 실패했습니다. 화면을 새로고침해 취소가 됐는지 먼저 확인해주세요.");
      }
    });
  };

  // 연차 복원 안내는 종류·연도에 따라 사실이 달라진다 — 거짓 안내를 하지 않도록 문장을 갈라 쓴다.
  //  ⚠️ 지난 해 휴가: 이 제품에 "지난 해 잔여"라는 값은 없다(연차정산은 과거 연도의 잔여를 '—'로 둔다).
  //     되살아나는 것은 그 해 '사용일수'뿐이고, 올해 쓸 수 있는 연차는 늘지 않는다 — 그대로 말한다(검수 C-N1).
  const isOtherYear = leaveYear !== (nowYear ?? serverYear);
  const restoreText = !deducts
    ? "이 종류는 연차를 깎지 않으므로 잔여 연차는 변하지 않습니다."
    : isOtherYear
      ? `이 휴가는 ${leaveYear}년 몫이라 ${leaveYear}년 사용일수에서만 빠집니다. 올해 쓸 수 있는 연차는 늘지 않고, 그 연차를 다시 쓸 수도 없습니다.`
      : "차감됐던 연차는 자동으로 돌아옵니다.";

  return (
    <>
      <button
        type="button"
        onClick={openModal}
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

      {/* onClose는 딤 클릭·✕·ESC가 모두 거쳐 간다 → closeModal 하나로 "처리 중엔 안 닫힘"이 세 경로 전부에 걸린다 */}
      <Modal open={open} onClose={closeModal} title="휴가 승인 취소" maxWidth={460}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          {name} · {summary}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 12, lineHeight: 1.6, wordBreak: "keep-all" }}>
          이 휴가의 승인을 되돌립니다. {restoreText} 그 날짜에 다시 휴가를 신청할 수 있게 되고, 기록은 지워지지 않고{" "}
          <b>&ldquo;승인 취소&rdquo;</b>로 남습니다. <b>되돌릴 수 없습니다</b> — 다시 살리려면 직원이 새로 신청하고 다시 승인해야 합니다.
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
            ⚠ 이미 지난 날짜가 들어 있습니다. 취소하면 그날은 휴가가 아니게 되어 <b>출근 기록이 없으면 결근</b>,{" "}
            <b>출근했다면 지각·조퇴 면제가 풀립니다.</b> 근태현황·리포트의 지난 숫자도 함께 바뀝니다.
          </p>
        )}
        <form action={submit}>
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
          {/* 서버가 거부한 이유 — 저장되지 않았다는 사실을 반드시 보여준다 */}
          {error && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--danger)", fontWeight: 700, lineHeight: 1.5, wordBreak: "keep-all" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              onClick={closeModal}
              disabled={pending}
              style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: pending ? "var(--text-sub)" : "var(--text)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: pending ? "default" : "pointer" }}
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
              {pending ? "처리 중…" : "승인 취소 확정"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
