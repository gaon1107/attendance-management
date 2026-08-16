"use client";
// 회사 계정 전용 — 복구용 연락처 확인·변경 카드.
//
// 실서비스에서 이 카드가 하는 일
//  · 회사 계정은 평소에 안 쓰는 계정이라, 정작 필요한 순간(관리자 전원 퇴사 등)에야 로그인한다.
//    그때 "복구용 번호가 지금도 받을 수 있는 번호인가"를 아무도 확인해 본 적이 없으면 회사가 잠긴다.
//    → 번호가 없거나 확인이 필요할 때는 **경고 색으로 눈에 띄게** 띄운다(그냥 두면 아무도 안 본다).
import { useActionState, useState } from "react";
import { changeRecoveryPhone } from "@/app/actions/account";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  color: "var(--text)",
  outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function RecoveryPhoneCard({
  maskedPhone,
  usable,
  recoveryEnabled,
}: {
  maskedPhone: string | null; // null = 등록된 번호 없음
  /** 등록된 번호가 **문자를 받을 수 있는 휴대폰**인가. 유선번호가 이미 저장돼 있을 수 있다. */
  usable: boolean;
  /** 회사 계정 복구 기능이 실제로 켜져 있는가(lib/owner-recovery.ts). 문자 설정 여부와 다르다. */
  recoveryEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(changeRecoveryPhone, {});
  // 번호가 없거나 문자를 못 받는 번호면 처음부터 펼쳐 둔다.
  const missing = !maskedPhone;
  const unusable = !!maskedPhone && !usable;
  const needsFix = missing || unusable;
  const [open, setOpen] = useState(needsFix);

  // 🔴 입력칸은 **React 상태로 관리한다(제어 컴포넌트).** 비제어로 두면 안 되는 이유:
  //    React 19는 폼 액션이 끝나면 **입력칸을 자동으로 비운다.** 그래서 1단계(확인) 응답이 오는
  //    순간 번호와 비밀번호가 사라져, 2단계 "네, 저장합니다"가 빈 값으로 제출된다.
  //    → 브라우저 검증에서 실제로 재현됐다(서버 단위 검증만으로는 절대 안 잡히는 결함).
  //    성공하면 아래에서 직접 비운다(남아 있으면 다시 눌렀을 때 "같은 번호" 오류 — 검수 경미 3).
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [clearedFor, setClearedFor] = useState<unknown>(null);
  if (state?.ok && clearedFor !== state) {
    // 렌더 중 setState — 같은 렌더 패스에서 즉시 반영되는 React 공식 패턴(파생 상태 초기화).
    setClearedFor(state);
    setPhone("");
    setPw("");
  }

  // ── 확인 단계 ──────────────────────────────────────────────────────────
  // 저장 전에 **가리지 않은 전체 번호**를 보여주고 한 번 더 확인받는다(검수 N-1).
  // 저장된 번호는 010-****-5678로 가려 보이기 때문에, 여기서 못 잡은 오타는 나중에도 못 잡는다.
  // "다시 입력"을 누르면 그 답변에 대해서만 확인 패널을 접는다.
  //  · 접었다는 표시를 **그때의 응답 객체 자체**로 들고 있는다. 서버가 새 답을 주면 새 객체가 오므로
  //    (같은 번호를 다시 넣어도 객체는 다르다) 확인 패널이 정확히 다시 뜬다.
  //    boolean + useEffect로 되돌리는 방식은 렌더 도중 setState가 되어 금지돼 있다(eslint).
  const [dismissedFor, setDismissedFor] = useState<typeof state | null>(null);
  const confirming = !!state?.confirm && dismissedFor !== state;

  return (
    <div
      style={{
        background: "var(--card)",
        border: needsFix ? "1px solid #FDE68A" : "1px solid var(--border)",
        borderRadius: 12,
        padding: 24,
        marginTop: 16,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
        복구용 연락처 {needsFix && <span style={{ color: "#B45309" }}>· 확인 필요</span>}
      </div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        회사 계정의 비밀번호를 잊었을 때 <b>인증번호를 받을 휴대폰</b>입니다. 회사 계정은 관리자도 대신
        되찾아 줄 수 없어, 이 번호가 유일한 복구 수단이 됩니다.
      </p>

      {/* 지금 상태 */}
      <div
        style={{
          background: needsFix ? "#FFFBEB" : "#F9FAFB",
          border: `1px solid ${needsFix ? "#FDE68A" : "var(--border)"}`,
          borderRadius: 8,
          padding: "13px 15px",
          marginBottom: 16,
          fontSize: 14,
          lineHeight: 1.6,
          wordBreak: "keep-all",
        }}
      >
        {missing && (
          <span style={{ color: "#92400E", fontWeight: 700 }}>
            아직 등록된 번호가 없습니다. 지금 등록해 두지 않으면 비밀번호를 잊었을 때 되찾을 수 없습니다.
          </span>
        )}
        {!missing && (
          <>
            <span style={{ color: "var(--text-sub)", fontWeight: 700 }}>현재 </span>
            <b style={{ fontSize: 15 }}>{maskedPhone}</b>
            {unusable ? (
              // 가입할 때 유선번호(02·070 등)를 넣은 회사가 있을 수 있다. 그대로 두면 "등록돼 있으니
              // 안심"하다가 정작 필요할 때 문자를 못 받는다(검수 치명 3).
              <div style={{ fontSize: 13, color: "#92400E", fontWeight: 700, marginTop: 8 }}>
                이 번호로는 <b>문자를 받을 수 없습니다</b>(휴대폰이 아닙니다). 휴대폰 번호로 바꿔 주세요.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
                담당자가 바뀌었거나 지금 쓰지 않는 번호라면 반드시 바꿔 주세요.
              </div>
            )}
          </>
        )}
      </div>

      {!recoveryEnabled && (
        // 🔴 판정 기준이 "문자 설정 여부"가 아니라 **"회사 계정 복구 기능이 켜졌는가"**여야 한다.
        //    문자 설정은 초대·임시비번 발송에도 쓰이므로, 다른 이유로 .env를 채우는 순간 이 경고가
        //    사라져 "이제 되찾을 수 있다"는 거짓 안심을 준다(검수 치명 2).
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            padding: "11px 13px",
            marginBottom: 16,
            fontSize: 12,
            color: "#991B1B",
            lineHeight: 1.6,
            wordBreak: "keep-all",
          }}
        >
          <b>회사 계정 복구 기능은 아직 준비 중입니다.</b> 지금 번호를 등록해 두는 것은 나중을 위한
          준비이며, <b>현재는 이 번호로도 비밀번호를 되찾을 수 없습니다.</b> 준비가 끝나면 이 안내가
          사라집니다.
        </div>
      )}

      {state?.ok && (
        <div
          style={{
            background: "#F0FDF4",
            border: "1px solid #BBF7D0",
            borderRadius: 8,
            padding: "11px 13px",
            marginBottom: 16,
            fontSize: 13,
            color: "#15803D",
            fontWeight: 700,
            lineHeight: 1.6,
          }}
        >
          복구용 연락처를 변경했습니다.
          {/* ⚠️ "보냈습니다"를 무조건 쓰면 거짓말이 된다 — 최초 등록·문자 미연동·발송 실패일 때는
              안 나간다(검수 M-1). 서버가 실제 발송 여부를 알려주면 그대로 표시한다.
              ⚠️ 발송은 화면 응답 뒤에 이뤄지므로 "도착했다"가 아니라 **"요청했다"**까지만 말한다(검수 경미 1). */}
          {/* 🔴 "안 보냈다"의 이유를 뭉뚱그리면 안 된다(재검수 중간 2). 우리 쪽 오류로 못 보낸 것을
              "최초 등록이라 안 보냄"이라고 하면, **탐지 장치가 꺼진 사실이 정상처럼 보여** 아무도 조사하지 않는다. */}
          {state.notified === "failed" ? (
            <div style={{ fontWeight: 700, color: "#B45309", marginTop: 4 }}>
              ⚠️ 이전 번호로 안내 문자를 <b>보내지 못했습니다</b>(시스템 오류). 번호는 정상적으로 바뀌었지만,
              원래 담당자에게 변경 사실이 전달되지 않았습니다.
            </div>
          ) : (
            <div style={{ fontWeight: 400, color: "#166534", marginTop: 4 }}>
              {state.notified === "sent"
                ? "이전 번호로 변경 안내 문자를 발송 요청했습니다(도착까지 몇 분 걸릴 수 있습니다)."
                : "이전 번호로 안내 문자는 나가지 않았습니다(최초 등록이거나, 이전 번호가 문자를 받을 수 없는 번호이거나, 문자 발송이 아직 연결되지 않았습니다)."}
            </div>
          )}
          {/* 🔴 번호는 바뀌었는데 세션 재발급만 실패한 경우 — "실패"라고 하면 거짓말이고,
              가만히 두면 사용자는 로그아웃된 줄도 모른다(검수 N-4). 사실대로 안내한다. */}
          {state.relogin ? (
            <div style={{ fontWeight: 400, color: "#166534", marginTop: 4 }}>
              보안을 위해 <b>모든 기기의 로그인이 해제</b>되었습니다. 이 기기도 포함이니{" "}
              <a href="/login" style={{ color: "#15803D", fontWeight: 700, textDecoration: "underline" }}>
                다시 로그인
              </a>
              해 주세요.
            </div>
          ) : (
            <div style={{ fontWeight: 400, color: "#166534", marginTop: 4 }}>
              보안을 위해 다른 기기의 로그인은 모두 해제했습니다.
            </div>
          )}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            height: 44,
            padding: "0 18px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "#fff",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-sub)",
            cursor: "pointer",
          }}
        >
          연락처 변경
        </button>
      ) : (
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>새 휴대폰 번호</label>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="010-1234-5678"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              readOnly={confirming}
              style={{ ...inputStyle, background: confirming ? "#F9FAFB" : "#fff" }}
            />
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
              문자를 받을 수 있는 휴대폰만 됩니다(회사 대표번호·인터넷전화 불가).
            </div>
          </div>
          <div>
            <label style={labelStyle}>현재 비밀번호</label>
            <input
              name="current"
              type="password"
              placeholder="본인 확인용"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              readOnly={confirming}
              style={{ ...inputStyle, background: confirming ? "#F9FAFB" : "#fff" }}
            />
          </div>

          {/* 🔴 확인 단계 — 저장 전에 **가리지 않은 전체 번호**를 보여준다(검수 N-1).
              저장하고 나면 010-****-5678로 가려지므로, 가운데 네 자리 오타는 여기서만 잡을 수 있다. */}
          {confirming && (
            <div
              style={{
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                borderRadius: 8,
                padding: "14px 16px",
                lineHeight: 1.6,
                wordBreak: "keep-all",
              }}
            >
              <input type="hidden" name="confirmed" value={state?.confirm ?? ""} />
              <div style={{ fontSize: 13, color: "#92400E", fontWeight: 700 }}>
                이 번호가 맞습니까? 저장한 뒤에는 가운데 자리가 가려져 확인할 수 없습니다.
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, margin: "8px 0 4px" }}>
                {state?.confirm}
              </div>
              <div style={{ fontSize: 12, color: "#92400E" }}>
                이 번호가 틀리면 <b>회사 계정을 되찾을 수 없습니다.</b> 문자를 받을 수 있는 본인 휴대폰인지
                꼭 확인해 주세요.
              </div>
            </div>
          )}

          {state?.error && (
            <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={pending}
              style={{
                height: 46,
                padding: "0 20px",
                border: "none",
                borderRadius: 8,
                background: "var(--primary)",
                color: "#fff",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: 700,
                cursor: pending ? "default" : "pointer",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? "처리 중..." : confirming ? "네, 이 번호로 저장합니다" : missing ? "등록하기" : "변경하기"}
            </button>
            {confirming ? (
              <button
                type="button"
                onClick={() => setDismissedFor(state)}
                style={{
                  height: 46,
                  padding: "0 18px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "#fff",
                  fontFamily: "inherit",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text-sub)",
                  cursor: "pointer",
                }}
              >
                다시 입력
              </button>
            ) : (
              !missing && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    height: 46,
                    padding: "0 18px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "#fff",
                    fontFamily: "inherit",
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--text-sub)",
                    cursor: "pointer",
                  }}
                >
                  취소
                </button>
              )
            )}
          </div>
        </form>
      )}
    </div>
  );
}
