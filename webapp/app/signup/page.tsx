"use client";
// 회사 회원가입 화면 — 디자인 시안 "회사 회원가입"의 담백한 카드 폼.
import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { signup } from "@/app/actions/auth";
// 숫자를 화면에 직접 적지 않는다 — 서버 기준과 어긋나면 "화면 말대로 넣었는데 거부"가 된다(검수 M-3).
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
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-sub)",
  marginTop: 6,
  lineHeight: 1.5,
};
const checkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  fontSize: 13,
  color: "var(--text)",
  cursor: "pointer",
};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, {});

  // 입력값을 화면이 들고 있는다(controlled).
  //  · 왜: 가입에 실패하면 화면이 다시 그려지는데, 그때 **입력한 것이 전부 지워졌다**.
  //    항목이 6개로 늘어 처음부터 다시 치는 부담이 크다(실제 브라우저 검증에서 확인, 2026-07-27).
  //  · 값은 화면에만 남는다 — 서버가 비밀번호를 되돌려 보내지 않는다(그게 더 안전하다).
  const [form, setForm] = useState({
    companyName: "", bizRegNo: "", managerName: "", managerPhone: "", email: "", password: "",
  });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // ── 사업자등록번호 즉시 확인 ────────────────────────────────────────────
  //  칸을 벗어나거나 10자리가 채워지면 바로 확인해 결과를 칸 아래에 보여준다.
  //  🔴 이건 **안내일 뿐**이다. 실제 차단은 가입 처리(actions/auth.ts)가 다시 확인해서 한다
  //     — 브라우저에서 온 판단은 신뢰하지 않는다(여기 결과를 고쳐도 가입은 통과하지 않는다).
  //  ⚠️ 결과를 **어느 번호의 결과인지와 함께** 들고 있는다. 결과만 들고 있으면
  //     번호를 지웠다가 같은 번호를 다시 쳤을 때 "결과는 있는데 화면에서 사라진" 상태가 된다.
  const [bizCheck, setBizCheck] = useState<{ digits: string; state: string; detail: string } | null>(null);
  const [bizChecking, setBizChecking] = useState(false);
  //  같은 번호를 두 번 묻지 않기 위한 표식(국세청 조회 횟수를 아낀다).
  //  ⚠️ useState가 아니라 useRef다 — 값이 바뀌어도 화면을 다시 그릴 필요가 없고,
  //     연속 입력 중 최신 값을 즉시 읽어야 하기 때문이다.
  const bizAsked = useRef<string>("");
  //  ⚠️ 늦게 온 응답이 최신 결과를 덮어쓰지 않게 한다(느린 응답 → 빠른 응답 순서 뒤바뀜 방지).
  const bizSeq = useRef(0);

  const checkBizRegNo = async (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    // 칸을 비운 경우: 진행 중이던 조회 결과가 **빈 칸 아래에 뒤늦게 뜨지 않도록** 순번을 올려 버린다
    //  (검수 중간 1 — 순번을 안 올리면 "빈 칸 + ✓ 정상 사업자"라는 이상한 화면이 나온다).
    if (!digits) {
      bizSeq.current += 1;
      bizAsked.current = "";
      setBizChecking(false);
      setBizCheck(null);
      return;
    }
    if (bizAsked.current === digits) return; // 이미 확인이 끝난 번호
    const mine = ++bizSeq.current;
    setBizChecking(true);
    // 서버가 응답을 붙잡고 있어도 "확인하는 중…"이 영원히 남지 않게 시간 제한을 둔다(검수 중간 3).
    //  서버 쪽 국세청 호출 상한은 최대 5초(2.5초 × 2회)라 8초면 정상 응답을 자르지 않는다.
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 8000);
    try {
      const res = await fetch("/api/bizreg-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bizRegNo: value }),
        signal: stop.signal,
      });
      const data = (await res.json()) as { state?: string; detail?: string };
      if (mine !== bizSeq.current) return; // 그 사이 번호가 바뀌었으면 버린다
      const st = String(data.state ?? "unknown");
      // ⚠️ **확정된 답일 때만** "이 번호는 물어봤다"고 기록한다(검수 중간 2).
      //    확인 실패(unknown)까지 기록해 버리면, 인터넷이 잠깐 끊겼다가 돌아와도
      //    같은 번호는 영영 다시 확인되지 않는다.
      bizAsked.current = st === "verified" || st === "invalid" || st === "closed" ? digits : "";
      setBizCheck({ digits, state: st, detail: String(data.detail ?? "") });
    } catch {
      // 인터넷이 끊겼거나 응답이 너무 늦은 경우 — 가입을 막지 않는다(안내만 못 할 뿐).
      if (mine === bizSeq.current) {
        bizAsked.current = ""; // 다시 시도할 수 있게 열어 둔다
        setBizCheck({ digits, state: "unknown", detail: "지금은 확인할 수 없습니다. 가입은 그대로 진행하실 수 있습니다." });
      }
    } finally {
      clearTimeout(timer);
      if (mine === bizSeq.current) setBizChecking(false);
    }
  };

  // 지금 칸에 들어 있는 번호의 결과일 때만 보여준다(다른 번호의 옛 결과가 남지 않게).
  const bizDigits = form.bizRegNo.replace(/[^0-9]/g, "");
  const bizShown = bizCheck && bizCheck.digits === bizDigits ? bizCheck : null;

  // 결과 색: 초록(정상) / 빨강(가짜·폐업) / 회색(확인 못 함)
  const bizTone =
    bizShown?.state === "verified" ? { color: "#047857", mark: "✓ " }
      : bizShown?.state === "invalid" || bizShown?.state === "closed" ? { color: "var(--danger)", mark: "✕ " }
      : { color: "var(--text-sub)", mark: "" };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      {/* 로고 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          근
        </div>
        <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
      </div>

      {/* 카드 */}
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 36px 32px",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>회사 회원가입</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 24, lineHeight: 1.6, wordBreak: "keep-all" }}>
          회사와 <b>회사 계정</b>을 만듭니다. 회사 계정은 사람이 아니라 <b>회사의 마스터 열쇠</b>입니다.
          <br />
          가입한 뒤 직원을 등록하고, 그중에서 <b>관리자를 지정</b>해 실무를 맡기시면 됩니다.
        </div>

        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={labelStyle}>회사명</label>
            <input name="companyName" type="text" placeholder="예시) ㈜하늘테크" style={inputStyle} value={form.companyName} onChange={set("companyName")} />
          </div>
          <div>
            <label style={labelStyle}>사업자등록번호</label>
            <input
              name="bizRegNo" type="text" inputMode="numeric" placeholder="예시) 123-45-67890"
              style={inputStyle} value={form.bizRegNo}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => ({ ...f, bizRegNo: v }));
                // ※ 옛 결과를 손으로 지우지 않는다 — 위 bizShown이 "지금 칸의 번호"와 같을 때만
                //    보여주므로, 번호를 고치는 순간 안내는 저절로 사라진다.
                const d = v.replace(/[^0-9]/g, "");
                // 10자리가 채워지는 순간 바로 확인한다(칸을 벗어나기 전에 알려주기 위함).
                if (d.length === 10) void checkBizRegNo(v);
              }}
              onBlur={(e) => void checkBizRegNo(e.target.value)}
            />
            {bizChecking ? (
              <div style={hintStyle}>국세청에 확인하는 중…</div>
            ) : bizShown && bizShown.detail ? (
              <div style={{ ...hintStyle, color: bizTone.color, fontWeight: 600 }}>{bizTone.mark}{bizShown.detail}</div>
            ) : (
              <div style={hintStyle}>국세청에 등록된 사업자인지 자동으로 확인합니다.</div>
            )}
          </div>
          <div>
            <label style={labelStyle}>담당자 이름</label>
            <input name="managerName" type="text" placeholder="예시) 홍길동" style={inputStyle} value={form.managerName} onChange={set("managerName")} />
          </div>
          <div>
            <label style={labelStyle}>담당자 연락처</label>
            <input name="managerPhone" type="tel" inputMode="tel" placeholder="예시) 010-1234-5678" style={inputStyle} value={form.managerPhone} onChange={set("managerPhone")} />
          </div>
          {/* ⚠️ autoComplete: 브라우저가 **로그인 화면에 저장해 둔 아이디·비밀번호를 여기 채우는 것**을 막는다.
              로그인 화면과 입력칸 이름(name="email"/"password")·종류가 똑같아, 크롬은 같은 로그인 칸으로 보고
              저장값을 자동으로 넣는다. 그대로 [가입하기]를 누르면 **새 회사 계정의 비밀번호가 기존 계정 것으로
              정해진다** — 회사 계정은 되찾기 어려운 마스터 열쇠라 특히 위험하다(2026-08-05 사장님 발견).
              ※ 실제로 막는 건 비밀번호의 **new-password** 하나다. 이게 붙으면 크롬이 이 폼을 로그인 폼으로 보지 않아
                 아이디+비번 쌍 채우기를 통째로 끈다. 이메일칸의 `off`는 크롬이 무시하므로 소용없다(검수 지적).
              ※ 이메일에 `username`을 주는 이유: 자동완성 차단 효과는 같으면서, 가입에 **성공한 뒤** 크롬이
                 "비밀번호를 저장할까요?"에 아이디를 제대로 채워 저장해 준다. 이 계정은 분실하면 되찾기 어렵다고
                 화면에도 경고하고 있어(아래 노란 상자), 저장 기회를 잃는 쪽이 더 위험하다.
              ※ 컨트롤드 입력이라고 안전한 게 아니다 — 크롬 자동완성은 React 상태를 거치지 않고 DOM 값만 바꾸는데
                 제출은 DOM에서 읽는다. 그래서 브라우저 힌트로 막는 이 방법이 맞다. */}
          <div>
            <label style={labelStyle}>회사 계정 이메일 (로그인 아이디)</label>
            <input name="email" type="email" autoComplete="username" placeholder="예시) admin@skytech.co.kr" style={inputStyle} value={form.email} onChange={set("email")} />
          </div>
          <div>
            <label style={labelStyle}>비밀번호</label>
            <input name="password" type="password" autoComplete="new-password" placeholder={PASSWORD_MIN_HINT} style={inputStyle} value={form.password} onChange={set("password")} />
          </div>

          {/* 동의는 법적 필수(개인정보보호법). 체크하지 않으면 서버가 가입을 거부한다. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 2 }}>
            <label style={checkRowStyle}>
              <input name="agreeTerms" type="checkbox" style={{ width: 18, height: 18, flexShrink: 0 }} checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
              <span>
                <b>[필수]</b> 이용약관에 동의합니다.
              </span>
            </label>
            <label style={checkRowStyle}>
              <input name="agreePrivacy" type="checkbox" style={{ width: 18, height: 18, flexShrink: 0 }} checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
              <span>
                <b>[필수]</b> 개인정보 수집·이용에 동의합니다.
              </span>
            </label>
          </div>

          {/* 회사 계정은 되찾을 방법이 마땅치 않다(자동 메일 발송이 없어 비번찾기가 관리자 승인식이다).
              가입 첫날엔 승인해 줄 관리자도 없으므로, 잃어버리면 곤란하다는 것을 미리 알린다(검수 치명 3). */}
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "11px 13px", fontSize: 12, color: "#92400E", lineHeight: 1.6, wordBreak: "keep-all" }}>
            <b>회사 계정 정보를 꼭 보관하세요.</b> 회사의 마스터 열쇠라 분실하면 되찾기 어렵습니다.
            가입 후 <b>직원 한 명을 관리자로 지정</b>해 두시면 더 안전합니다.
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
            {pending ? "가입 중..." : "가입하기"}
          </button>
        </form>

        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-sub)", marginTop: 24 }}>
          이미 계정이 있으세요?{" "}
          <Link href="/login" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
