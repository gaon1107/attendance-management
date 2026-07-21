"use client";
// 첫 사용 안내(온보딩 투어) — 처음 로그인한 직원에게 사용법을 3단계로 안내한다.
// 닫거나 "시작하기"를 누르면 다시 뜨지 않는다(markTourSeen).
import { useState, useTransition } from "react";
import { markTourSeen } from "@/app/actions/tour";
import { Modal } from "@/app/components/Modal";

const STEPS = [
  {
    emoji: "👋",
    title: "근태관리에 오신 걸 환영합니다",
    body: "여기서 매일 출퇴근을 기록하고, 실제로 일한 시간을 자동으로 계산해 드려요. 잠깐이면 사용법을 익힐 수 있어요.",
  },
  {
    emoji: "🕘",
    title: "출근·퇴근, 그리고 외출",
    body: "가운데 큰 버튼으로 출근하고 퇴근해요. 점심·자리비움은 [외출] 버튼으로 기록하면 그 시간은 실근무에서 빠집니다.",
  },
  {
    emoji: "📌",
    title: "더 많은 기능",
    body: "왼쪽 메뉴에서 [내근태](표·달력 보기), [휴가] 신청, [정정] 요청, [공지] 확인을 할 수 있어요. 출퇴근 방식(얼굴/GPS)은 [인증방식]에서 고릅니다.",
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [, startTransition] = useTransition();

  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  function close() {
    setOpen(false);
    startTransition(() => { markTourSeen(); });
  }

  return (
    <Modal open={open} onClose={close} showClose={false} escClose={false} maxWidth={420}>
      <div style={{ fontSize: 44, textAlign: "center", marginBottom: 12 }}>{s.emoji}</div>
      <div style={{ fontSize: 19, fontWeight: 700, textAlign: "center", marginBottom: 10 }}>{s.title}</div>
      <p style={{ fontSize: 14, color: "var(--text-sub)", lineHeight: 1.7, textAlign: "center", marginBottom: 22 }}>{s.body}</p>

      {/* 단계 점 */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
        {STEPS.map((_, i) => (
          <span key={i} style={{ width: i === step ? 20 : 7, height: 7, borderRadius: 999, background: i === step ? "var(--primary)" : "#D1D5DB", transition: "width .2s" }} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {!last ? (
          <>
            <button
              onClick={close}
              style={{ flex: "0 0 auto", height: 48, padding: "0 18px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              건너뛰기
            </button>
            <button
              onClick={() => setStep((v) => v + 1)}
              style={{ flex: 1, height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              다음
            </button>
          </>
        ) : (
          <button
            onClick={close}
            style={{ flex: 1, height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            시작하기
          </button>
        )}
      </div>
    </Modal>
  );
}
