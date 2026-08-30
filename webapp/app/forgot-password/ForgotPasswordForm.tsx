"use client";
// 비밀번호 찾기 화면 본체.
//  [A] 문자 인증코드: ①이메일+전화번호 뒷4자리 → ②인증번호 → ③새 비밀번호
//  [B] 관리자 승인(기존): 이메일만 접수 → 관리자가 임시비번 발급
//
// ⚠️ 이메일·인증번호는 다음 단계로 넘길 때 화면 상태로 들고 간다(숨은 입력칸으로 함께 전송).
//    서버는 ③에서 인증번호를 **한 번 더** 확인하므로, 화면 값을 조작해도 통과하지 못한다.
import { useActionState, useState } from "react";
import Link from "next/link";
import {
  requestPasswordReset,
  sendResetCode,
  verifyResetCode,
  completeResetWithCode,
} from "@/app/actions/password-reset";
// 숫자를 화면에 직접 적지 않는다(검수 M-3).
import { PASSWORD_MIN_HINT } from "@/lib/password-policy";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 16,
  color: "var(--text)",
  outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 8,
};
const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 440,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "36px 36px 32px",
};
const primaryBtn = (pending: boolean): React.CSSProperties => ({
  height: 52,
  marginTop: 4,
  border: "none",
  borderRadius: 10,
  background: "var(--primary)",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 16,
  fontWeight: 700,
  cursor: pending ? "default" : "pointer",
  opacity: pending ? 0.6 : 1,
});
const noticeStyle: React.CSSProperties = {
  background: "#EFF6FF",
  border: "1px solid #BFDBFE",
  borderRadius: 8,
  padding: "11px 13px",
  fontSize: 12,
  color: "#1E40AF",
  lineHeight: 1.6,
  marginBottom: 20,
  wordBreak: "keep-all",
};
const errStyle: React.CSSProperties = { fontSize: 13, color: "var(--danger)", fontWeight: 700 };

/** 회사 계정은 이 경로로 되찾을 수 없다는 안내(두 방식 모두에 해당) — 검수 2차 치명 1. */
function OwnerNotice() {
  return (
    <div
      style={{
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        borderRadius: 8,
        padding: "11px 13px",
        fontSize: 12,
        color: "#92400E",
        lineHeight: 1.6,
        marginBottom: 24,
        wordBreak: "keep-all",
      }}
    >
      <b>회사 계정(가입할 때 만든 계정)</b>은 보안상 이 방법으로 되찾을 수 없습니다. 회사에{" "}
      <b>관리자로 지정된 직원</b>이 있으면 그분이 계속 관리할 수 있고, 회사 계정 자체를 되찾으셔야 하면{" "}
      <b>고객지원으로 사업자등록증을 확인한 뒤</b> 처리해 드립니다.
    </div>
  );
}

function BackToLogin() {
  return (
    <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 24 }}>
      <Link href="/login" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
        로그인으로 돌아가기
      </Link>
    </div>
  );
}

export function ForgotPasswordForm({ smsEnabled }: { smsEnabled: boolean }) {
  // 문자 발송이 꺼져 있으면 선택지가 없다 — 처음부터 관리자 승인 방식만 보여준다.
  const [mode, setMode] = useState<"code" | "admin">(smsEnabled ? "code" : "admin");

  if (mode === "admin") {
    return <AdminRequestPanel canSwitchBack={smsEnabled} onSwitchBack={() => setMode("code")} />;
  }
  return <CodePanel onSwitchToAdmin={() => setMode("admin")} />;
}

// ── [A] 문자 인증코드 방식 ────────────────────────────────────────────────
function CodePanel({ onSwitchToAdmin }: { onSwitchToAdmin: () => void }) {
  const [email, setEmail] = useState("");
  const [phoneTail, setPhoneTail] = useState("");
  const [code, setCode] = useState("");

  const [sendState, sendAction, sendPending] = useActionState(sendResetCode, {});
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyResetCode, {});
  const [doneState, doneAction, donePending] = useActionState(completeResetWithCode, {});
  // ⚠️ 2단계의 "다시 받기"는 **별도 상태**를 쓴다(검수 중간 7).
  //    1단계와 같은 상태를 쓰면, 재발송이 오류를 내는 순간 sendState.ok가 사라져
  //    입력 중이던 2단계 화면이 통째로 1단계로 되돌아간다.
  const [resendState, resendAction, resendPending] = useActionState(sendResetCode, {});

  // 지금 몇 단계인가는 **따로 저장하지 않고 계산한다.**
  //  · 저장하면 "화면이 기억하는 단계"와 "서버 응답"이 어긋날 수 있고, 상태를 effect에서 고치는
  //    금지 패턴(react-hooks/set-state-in-effect)이 필요해진다. 계산하면 항상 응답과 일치한다.
  const step: 1 | 2 | 3 | 4 = doneState.ok ? 4 : verifyState.ok ? 3 : sendState.ok ? 2 : 1;

  // 완료 화면
  if (step === 4) {
    return (
      <div style={cardStyle}>
        <div
          style={{
            background: "#F0FDF4",
            border: "1px solid #BBF7D0",
            borderRadius: 10,
            padding: "16px 18px",
            fontSize: 14,
            color: "#15803D",
            fontWeight: 700,
            lineHeight: 1.7,
          }}
        >
          비밀번호가 변경되었습니다.
          <div style={{ fontWeight: 400, color: "#166534", marginTop: 6 }}>
            보안을 위해 기존에 로그인돼 있던 기기는 모두 로그아웃되었습니다. 새 비밀번호로 다시 로그인해
            주세요.
          </div>
        </div>
        <Link
          href="/login"
          style={{
            display: "block",
            textAlign: "center",
            marginTop: 22,
            height: 48,
            lineHeight: "48px",
            borderRadius: 10,
            background: "var(--primary)",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          로그인하러 가기
        </Link>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>비밀번호 찾기</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        {step === 1 && "등록된 전화번호로 인증번호를 보내 드립니다. 관리자 승인 없이 바로 새 비밀번호를 정할 수 있습니다."}
        {step === 2 && "문자로 받은 6자리 인증번호를 입력해 주세요."}
        {step === 3 && "새로 사용할 비밀번호를 정해 주세요."}
      </div>

      {/* 단계 표시 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: step >= n ? "var(--primary)" : "var(--border)",
            }}
          />
        ))}
      </div>

      {step === 1 && (
        <>
          <OwnerNotice />
          <form action={sendAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={labelStyle}>이메일</label>
              <input
                name="email"
                type="email"
                placeholder="가입한 이메일"
                style={inputStyle}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>전화번호 뒷 4자리</label>
              <input
                name="phoneTail"
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="예시) 5678"
                style={inputStyle}
                value={phoneTail}
                onChange={(e) => setPhoneTail(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.6 }}>
                회사에 등록된 본인 전화번호의 마지막 4자리입니다. 등록된 번호가 없으면 아래 방법을 이용해
                주세요.
              </div>
            </div>

            {sendState?.error && <div style={errStyle}>{sendState.error}</div>}

            <button type="submit" disabled={sendPending} style={primaryBtn(sendPending)}>
              {sendPending ? "보내는 중..." : "인증번호 받기"}
            </button>
          </form>
        </>
      )}

      {step === 2 && (
        <>
          <div style={noticeStyle}>
            등록된 전화번호로 인증번호를 보냈습니다. <b>5분 이내</b>에 입력해 주세요.
            <br />
            (입력하신 이메일과 전화번호가 모두 일치하는 계정이 있을 때만 발송됩니다.)
          </div>
          <form action={verifyAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <input type="hidden" name="email" value={email} />
            <div>
              <label style={labelStyle}>인증번호 6자리</label>
              <input
                name="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                autoComplete="one-time-code"
                style={{ ...inputStyle, letterSpacing: 6, fontWeight: 700 }}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>

            {verifyState?.error && <div style={errStyle}>{verifyState.error}</div>}

            <button type="submit" disabled={verifyPending} style={primaryBtn(verifyPending)}>
              {verifyPending ? "확인 중..." : "다음"}
            </button>
          </form>

          {/* 재발송 — 서버가 1분 1건·하루 5건으로 제한한다(문자는 건당 비용). */}
          <form action={resendAction} style={{ marginTop: 14, textAlign: "center" }}>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="phoneTail" value={phoneTail} />
            <button
              type="submit"
              disabled={resendPending}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-sub)",
                textDecoration: "underline",
                cursor: resendPending ? "default" : "pointer",
              }}
            >
              {resendPending ? "보내는 중..." : "인증번호 다시 받기"}
            </button>
            {resendState?.error && <div style={{ ...errStyle, marginTop: 8 }}>{resendState.error}</div>}
            {/* 눌렸다는 사실은 알려준다(검수 중간 6). 안 알려주면 "눌렸나?" 싶어 계속 누르게 되고,
                누를 때마다 하루 발송 한도만 깎인다. 성공·실패를 구분하지 않는 고정 문구라 안전하다. */}
            {resendState?.ok && (
              <div style={{ fontSize: 12, color: "#15803D", fontWeight: 700, marginTop: 8 }}>
                인증번호를 다시 보냈습니다.
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
              문자가 오지 않으면 1분 뒤에 다시 눌러 주세요. 계속 오지 않으면 아래에서 관리자에게 요청해
              주세요.
            </div>
          </form>
        </>
      )}

      {step === 3 && (
        <form action={doneAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="code" value={code} />
          <div>
            <label style={labelStyle}>새 비밀번호</label>
            <input name="next" type="password" placeholder={PASSWORD_MIN_HINT} autoComplete="new-password" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>새 비밀번호 확인</label>
            <input name="confirm" type="password" placeholder="한 번 더 입력" autoComplete="new-password" style={inputStyle} />
          </div>

          {doneState?.error && <div style={errStyle}>{doneState.error}</div>}

          <button type="submit" disabled={donePending} style={primaryBtn(donePending)}>
            {donePending ? "변경 중..." : "비밀번호 변경하기"}
          </button>
        </form>
      )}

      {/* 인증번호가 만료·무효가 되면 1단계로 돌아갈 길이 있어야 한다. 화면을 새로 여는 것이 가장 확실하다. */}
      {(step === 2 || step === 3) && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text-sub)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            처음부터 다시 시작
          </button>
        </div>
      )}

      {/* 문자를 받을 수 없는 직원(전화번호 미등록 등)의 대체 경로 — 반드시 남겨 둔다. */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 24, paddingTop: 18, textAlign: "center" }}>
        <button
          type="button"
          onClick={onSwitchToAdmin}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--primary)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          문자를 받을 수 없나요? 관리자에게 요청하기
        </button>
      </div>

      <BackToLogin />
    </div>
  );
}

// ── [B] 관리자 승인 방식(기존) ────────────────────────────────────────────
function AdminRequestPanel({ canSwitchBack, onSwitchBack }: { canSwitchBack: boolean; onSwitchBack: () => void }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, {});

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>관리자에게 요청하기</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        가입한 이메일을 입력하면 재설정 요청이 접수됩니다. 관리자가 확인 후 임시 비밀번호를 전달해 드립니다.
      </div>

      <OwnerNotice />

      {state?.ok ? (
        <div>
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              padding: "16px 18px",
              fontSize: 14,
              color: "#15803D",
              fontWeight: 700,
              lineHeight: 1.7,
            }}
          >
            요청이 접수되었습니다.
            <div style={{ fontWeight: 400, color: "#166534", marginTop: 6 }}>
              등록된 이메일인 경우, 관리자가 확인 후 임시 비밀번호를 전달합니다. 임시 비밀번호로 로그인하면
              곧바로 새 비밀번호를 정하게 됩니다.
            </div>
          </div>
          <Link
            href="/login"
            style={{
              display: "block",
              textAlign: "center",
              marginTop: 22,
              height: 48,
              lineHeight: "48px",
              borderRadius: 10,
              background: "var(--primary)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            로그인으로 돌아가기
          </Link>
        </div>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={labelStyle}>이메일</label>
            <input name="email" type="email" placeholder="가입한 이메일" style={inputStyle} />
          </div>

          {state?.error && <div style={errStyle}>{state.error}</div>}

          <button type="submit" disabled={pending} style={primaryBtn(pending)}>
            {pending ? "접수 중..." : "재설정 요청하기"}
          </button>
        </form>
      )}

      {canSwitchBack && !state?.ok && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 24, paddingTop: 18, textAlign: "center" }}>
          <button
            type="button"
            onClick={onSwitchBack}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--primary)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            문자 인증으로 바로 되찾기
          </button>
        </div>
      )}

      <BackToLogin />
    </div>
  );
}
