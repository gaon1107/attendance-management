"use client";
// [인원 증가 동의] 확인 창 — 2026-11-23 결제 4단계(lib/seat-consent.ts).
//  · 서버 동작이 { seatConsent } 를 돌려주면(요금 구간이 오름) 이 창을 띄운다. [동의하고 진행]을 누르면 같은 폼을
//    "동의한 구간" 값과 함께 **다시 보낸다** — 서버가 그 값을 지금 계산과 다시 대조한다(그사이 금액이 바뀌면 또 묻는다).
//  · 쓰는 곳: 초대 링크 만들기 · 직원 추가 · 복직 · 관리자 해제. 확인 창은 공용 Modal(디자인 규칙 §5.7).
//  · 문구의 금액·인원은 전부 서버가 계산해 준 값이다(이 화면은 계산하지 않는다).
import { useEffect, useRef, useState, type RefObject } from "react";
import { Modal } from "@/app/components/Modal";
import type { SeatPreview } from "@/lib/seat-consent";
import { QUOTE_OVER } from "@/lib/pricing";

const QUOTE_FROM = QUOTE_OVER + 1; // 공개 요금표 다음 인원 — 요금표 한 곳(lib/pricing.ts)에서 가져온다(4단계 검수 경미 8)
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 폼 하나에 동의 흐름을 붙인다.
 * @returns hidden(폼 안에 넣을 숨은 칸) · dialog(확인 창) · resubmitting()(onSubmit에서 true면 브라우저 확인창을 건너뛴다 — 이미 물었다)
 */
export function useSeatConsent(
  state: { seatConsent?: SeatPreview } | undefined,
  formRef: RefObject<HTMLFormElement | null>,
  pending: boolean
) {
  const tokenRef = useRef<HTMLInputElement>(null);
  const resubmitRef = useRef(false);
  const [closedFor, setClosedFor] = useState<object | null>(null);
  const preview = state?.seatConsent && state !== closedFor ? state.seatConsent : null;

  // 서버 답이 바뀌면(성공·오류·다시 동의 요청) 지난 동의 값을 지운다 — 다음 등록은 처음부터 다시 판단한다.
  useEffect(() => {
    if (tokenRef.current) tokenRef.current.value = "";
  }, [state]);

  const [oldBrowser, setOldBrowser] = useState(false);
  const confirm = () => {
    const form = formRef.current;
    if (!preview || !preview.needsConsent || !tokenRef.current || !form) return;
    // requestSubmit이 없는 오래된 브라우저(사파리 16 미만)는 다시 보낼 수 없다 — 표시를 세우기 **전에** 막는다
    //  (세운 채 실패하면 다음 [관리자 해제]·[복직]이 "할까요?" 확인 없이 남은 동의 값으로 통과한다 — 4단계 검수 경미 2).
    if (typeof form.requestSubmit !== "function") {
      setOldBrowser(true);
      return;
    }
    tokenRef.current.value = preview.token;
    resubmitRef.current = true;
    setClosedFor(state ?? null);
    try {
      form.requestSubmit();
    } catch {
      resubmitRef.current = false;
      tokenRef.current.value = "";
    }
  };
  const cancel = () => setClosedFor(state ?? null);

  const hidden = <input ref={tokenRef} type="hidden" name="seatConsent" defaultValue="" />;
  const dialog = (
    <Modal open={!!preview?.needsConsent} onClose={cancel} title="요금 변경 확인" maxWidth={440}>
      {preview && preview.needsConsent ? (
        <div style={{ fontSize: 14, lineHeight: 1.7, wordBreak: "keep-all" }}>
          {preview.quote ? (
            <p style={{ margin: "0 0 12px" }}>
              요금 대상 인원이 <strong>{preview.projected}명</strong>이 되어 공개 요금표를 넘습니다. {QUOTE_FROM}명부터는{" "}
              <strong>별도 협의 요금</strong>이라 고객센터에서 연락드리며, 협의 전까지 자동결제는 멈춥니다.
            </p>
          ) : (
            <p style={{ margin: "0 0 12px" }}>
              요금 대상 인원이 <strong>{preview.projected}명</strong>이 되어 요금이{" "}
              <strong>월 {won(preview.fromTotal)}</strong>({preview.fromLabel}) → <strong>월 {won(preview.toTotal)}</strong>({preview.toLabel})으로
              오릅니다(부가세 포함).
            </p>
          )}
          {oldBrowser ? (
            <p role="alert" style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>
              이 브라우저에서는 진행할 수 없습니다. 크롬·엣지 최신 버전에서 다시 해 주세요.
            </p>
          ) : null}
          <ul style={{ margin: "0 0 16px", paddingLeft: 18, fontSize: 13, color: "var(--text-sub)" }}>
            <li>새 금액은 다음 결제부터 적용되며, 이미 결제한 기간의 차액은 받지 않습니다.</li>
            <li>아직 가입하지 않은 초대 링크도 인원에 넣어 계산합니다.</li>
            <li>동의하지 않으시면 이 작업은 진행되지 않습니다.</li>
          </ul>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button" onClick={cancel} disabled={pending}
              style={{ height: 40, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              취소
            </button>
            <button
              type="button" onClick={confirm} disabled={pending}
              style={{ height: 40, padding: "0 16px", border: 0, borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
            >
              동의하고 진행
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );

  /** 동의 뒤 다시 보내는 중이면 true(한 번만) — 폼의 onSubmit이 브라우저 확인창을 다시 띄우지 않게. */
  const resubmitting = () => {
    const r = resubmitRef.current;
    resubmitRef.current = false;
    return r;
  };
  return { hidden, dialog, resubmitting };
}
