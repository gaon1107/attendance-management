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

  // 성공하면 폼을 접는다. 입력칸은 **비제어**로 두고 key로 새로 그려 값이 남지 않게 한다
  // (남아 있으면 다시 눌렀을 때 "지금 등록된 연락처와 같습니다"가 뜬다 — 검수 경미 3).
  const doneKey = state?.ok ? "done" : "editing";

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
              안 나간다(검수 M-1). 서버가 실제 발송 여부를 알려주면 그대로 표시한다. */}
          <div style={{ fontWeight: 400, color: "#166534", marginTop: 4 }}>
            {state.notified
              ? "이전 번호로 변경 안내 문자를 보냈습니다."
              : "이전 번호로 안내 문자는 나가지 않았습니다(최초 등록이거나 문자 발송이 아직 연결되지 않았습니다)."}
          </div>
          <div style={{ fontWeight: 400, color: "#166534", marginTop: 4 }}>
            보안을 위해 다른 기기의 로그인은 모두 해제했습니다.
          </div>
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
        <form key={doneKey} action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>새 휴대폰 번호</label>
            {/* 비제어 입력 — 성공하면 위 key가 바뀌며 새로 그려져 값이 남지 않는다(검수 경미 3). */}
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="010-1234-5678"
              autoComplete="tel"
              style={inputStyle}
            />
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6 }}>
              문자를 받을 수 있는 휴대폰만 됩니다(회사 대표번호·인터넷전화 불가). 하루에 한 번만 바꿀 수
              있습니다.
            </div>
          </div>
          <div>
            <label style={labelStyle}>현재 비밀번호</label>
            <input name="current" type="password" placeholder="본인 확인용" autoComplete="current-password" style={inputStyle} />
          </div>

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
              {pending ? "변경 중..." : missing ? "등록하기" : "변경하기"}
            </button>
            {!missing && (
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
            )}
          </div>
        </form>
      )}
    </div>
  );
}
