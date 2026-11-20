"use client";
// 로그인 폼 — 회원가입과 같은 담백한 카드 폼.
// ※ 화면 뼈대(로고·카드)는 page.tsx(서버 컴포넌트)가 감싼다. 여기는 폼과 경고만 담당한다.
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { login } from "@/app/actions/auth";

// [아이디 저장] 2026-11-20 사장님 승인 — 이메일만 "이 기기의 브라우저"에 저장한다(서버·다른 기기로 안 감).
//   · 비밀번호는 절대 저장하지 않는다. 비밀번호 자동 입력은 휴대폰·브라우저의 비밀번호 관리자에 맡긴다(autoComplete 표시).
//   · 공용 PC에서는 체크를 풀면 저장된 이메일도 지운다.
//   · 저장소가 막힌 환경(사생활 보호 모드 등)에서도 로그인은 그대로 되게 모든 접근을 try로 감싼다.
const SAVED_EMAIL_KEY = "attend.savedEmail";

function readSavedEmail(): string | null {
  try {
    return window.localStorage.getItem(SAVED_EMAIL_KEY);
  } catch {
    return null;
  }
}

function writeSavedEmail(email: string | null): void {
  try {
    if (email) window.localStorage.setItem(SAVED_EMAIL_KEY, email);
    else window.localStorage.removeItem(SAVED_EMAIL_KEY);
  } catch {
    /* 저장 못 해도 로그인에는 영향 없음 */
  }
}

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

export function LoginForm({ signedInName, mustChange }: { signedInName: string | null; mustChange: boolean }) {
  const [state, formAction, pending] = useActionState(login, {});
  // 이메일은 "제어 입력"으로 둔다 — React 19 폼은 제출 뒤 입력칸을 비우므로, 로그인 실패 시 이메일까지 지워지던 문제 해결.
  //   (비밀번호는 그대로 비워진다 — 틀린 비밀번호가 남아 있을 이유가 없다)
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);

  // 저장된 이메일 불러오기 — 서버 화면과 첫 화면이 같아야 하므로(하이드레이션) 화면이 뜬 뒤에 읽는다.
  useEffect(() => {
    const saved = readSavedEmail();
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소는 화면이 뜬 뒤에만 읽을 수 있다(1회)
      setEmail(saved);
      setRemember(true);
    }
  }, []);

  // 제출 직전에 저장/삭제 — 로그인이 성공하면 곧바로 다른 화면으로 넘어가므로 여기서 처리한다.
  function onSubmit() {
    writeSavedEmail(remember ? email.trim() : null);
  }

  return (
    <>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>로그인</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: signedInName ? 16 : 28 }}>
        계정 정보로 로그인하면 역할에 맞는 화면으로 이동합니다.
      </div>

      {/* 🔴 이미 다른 계정으로 로그인돼 있을 때의 경고(검수 M-15).
          이 제품은 출입증(세션)을 브라우저당 하나만 들고 있어서, 다른 계정으로 로그인하면
          앞서 열어둔 탭도 **조용히** 새 계정으로 바뀐다. 그 상태에서 [승인]을 누르면
          결재 기록에 처리자가 다른 사람으로 남는다 — 나중에 분쟁의 근거가 되는 기록이라 위험하다.
          구조를 바꾸는 대신(전 화면 회귀 위험) 사람이 알아채게 한다. */}
      {signedInName && (
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
          {mustChange ? (
            /* 임시 비밀번호 상태는 "로그인돼 있다"고만 하면 오해를 산다 — 실제로는 어떤 화면도 안 열린다
               (검수 경미 13). 무엇을 해야 하는지 알려준다. */
            <>
              <b>{signedInName}</b> 님은 임시 비밀번호로 로그인한 상태입니다.{" "}
              <b>새 비밀번호를 먼저 정해야</b> 화면이 열립니다. 임시 비밀번호로 다시 로그인하시면
              비밀번호 변경 화면으로 안내됩니다.
            </>
          ) : (
            <>
              지금 <b>{signedInName}</b> 님으로 로그인돼 있습니다. 다른 계정으로 로그인하면{" "}
              <b>기존 로그인이 해제되고, 열어둔 다른 탭도 새 계정으로 바뀝니다.</b> 다른 탭에서 승인·저장을
              하시려던 중이면 먼저 그 탭에서 마무리해 주세요.
            </>
          )}
        </div>
      )}

      <form action={formAction} onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label style={labelStyle}>이메일</label>
          <input
            name="email"
            type="email"
            autoComplete="username"
            placeholder="예시) admin@skytech.co.kr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>비밀번호</label>
            <Link href="/forgot-password" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", textDecoration: "none" }}>
              비밀번호를 잊으셨나요?
            </Link>
          </div>
          <input name="password" type="password" autoComplete="current-password" placeholder="비밀번호" style={inputStyle} />
        </div>

        {/* 진짜 체크박스(input) 대신 버튼형 체크 — React 19 폼은 제출 뒤 form.reset()으로 체크박스 표시까지 풀어 버려
            (실측: 상태는 켜짐인데 화면은 꺼짐), 로그인 실패 뒤 사용자가 "저장 안 되나?" 하고 헷갈린다. 버튼은 초기화 대상이 아니다. */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", marginTop: -6 }}>
          <button
            type="button"
            role="checkbox"
            aria-checked={remember}
            aria-describedby="remember-hint"
            onClick={() => {
              const next = !remember;
              setRemember(next);
              if (!next) writeSavedEmail(null); // 체크를 풀면 바로 지운다(공용 PC)
            }}
            // 위아래 여백으로 손가락 누르는 영역을 키운다(휴대폰 권장 높이 약 44px) — 바깥 줄 간격은 음수 여백으로 상쇄
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 0", margin: "-12px 0", border: "none", background: "none", fontFamily: "inherit", fontSize: 14, color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <span
              aria-hidden
              style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                border: remember ? "none" : "1.5px solid #9CA3AF",
                background: remember ? "var(--primary)" : "#fff",
                color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: "18px", textAlign: "center",
              }}
            >
              {remember ? "✓" : ""}
            </span>
            아이디 저장
          </button>
          <span id="remember-hint" style={{ fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>공용 PC에서는 체크하지 마세요</span>
        </div>

        {state?.error && (
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{
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
          }}
        >
          {pending ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 24 }}>
        아직 계정이 없으세요?{" "}
        <Link href="/signup" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
          회사 회원가입
        </Link>
      </div>
    </>
  );
}
