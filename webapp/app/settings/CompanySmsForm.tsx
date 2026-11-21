"use client";
// [설정 → 문자·알림톡] — 회사별 비즈모아샷 문자 계정 등록 (2026-11-21, 메시지 관리 1단계).
//  · 학원관리 [설정 관리]의 문자 3단계 화면과 같은 모양: ①가입 ②충전·잔액 ③발신번호 사전등록 → 계정 입력 → 시험 문자.
//  · 서버 동작: app/actions/company-sms.ts. 상태: lib/company-sms-account.ts(비밀번호 값은 화면으로 오지 않는다).
//  · 🔒 비밀번호 칸은 반드시 autoComplete="new-password" — 안 하면 크롬이 **근태 로그인 비밀번호**를 이 칸에 채워
//    그대로 저장되는 사고가 난다(디자인 규칙 §5.5.1). 아이디 칸은 남의 서비스 계정이라 "off".
//  · ⚠️ 1단계는 "등록"까지다. 직원 비밀번호 찾기·초대 문자를 이 계정으로 보내는 것은 다음 업데이트(2단계)라
//    화면에 그대로 적는다 — "된다"고 쓰면 거짓이 된다.
import { useActionState, useState, useTransition } from "react";
import {
  saveCompanySmsAccount,
  clearCompanySmsAccount,
  sendCompanySmsTest,
  type CompanySmsFormState,
} from "@/app/actions/company-sms";
import { MOASHOT_LINKS } from "@/lib/moashot-links";
import { formatPhone } from "@/lib/phone";
import { Modal } from "@/app/components/Modal";

export type CompanySmsStatusView = {
  smsId: string | null;
  sender: string | null;
  passwordSaved: boolean;
  passwordUsable: boolean;
  keyReady: boolean;
  connected: boolean;
  updatedLabel: string | null;
  /** 저장할 때마다 바뀌는 값(1/1000초 단위 시각). 폼을 새로 그려 입력했던 비밀번호를 지우는 기준 — 분 단위 표시값은
   *  같은 분에 두 번 저장하면 안 바뀌어 비밀번호가 칸에 남았다(2026-11-21 확인). */
  updatedKey: string;
};

const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 24,
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8, whiteSpace: "nowrap" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  outline: "none",
};
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-sub)",
  marginTop: 6,
  lineHeight: 1.6,
  wordBreak: "keep-all",
};
const noteBox = (tone: "info" | "warn"): React.CSSProperties => ({
  background: tone === "warn" ? "#FFFBEB" : "#EFF6FF",
  border: `1px solid ${tone === "warn" ? "#FDE68A" : "#BFDBFE"}`,
  color: tone === "warn" ? "#92400E" : "#1E40AF",
  borderRadius: 8,
  padding: "11px 13px",
  fontSize: 13,
  lineHeight: 1.6,
  wordBreak: "keep-all",
  marginBottom: 14,
});
const primaryBtn = (pending: boolean): React.CSSProperties => ({
  height: 46,
  padding: "0 26px",
  border: "none",
  borderRadius: 10,
  background: "var(--primary)",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 15,
  fontWeight: 700,
  cursor: pending ? "default" : "pointer",
  opacity: pending ? 0.6 : 1,
  alignSelf: "flex-start",
});
const linkBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 38,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid var(--primary)",
  background: "#fff",
  color: "var(--primary)",
  fontSize: 13,
  fontWeight: 700,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function Result({ state }: { state: CompanySmsFormState }) {
  if (state?.error) return <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, wordBreak: "keep-all" }}>{state.error}</div>;
  if (state?.ok && state.message)
    return <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700, wordBreak: "keep-all", lineHeight: 1.6 }}>{state.message}</div>;
  return null;
}

/**
 * 저장된 비밀번호 자리 표시 — 학원관리처럼 칸에 ●●●●●●●●가 보이게 한다(사장님 요청 2026-11-21).
 *  · 🔒 **진짜 비밀번호와 무관한 고정 글자**다. 실제 값·길이는 서버에서 화면으로 절대 오지 않는다.
 *  · 이 칸에는 name이 없다 — 서버로 가는 값은 아래 숨은 칸(name="password")이다. 손대지 않았으면 빈 값을 보내
 *    "기존 비밀번호 유지"가 되고, 이 고정 글자가 비밀번호로 저장되는 일은 없다.
 */
const PW_MASK = "********";

function SavedPasswordInput({ saved }: { saved: boolean }) {
  const [pw, setPw] = useState(saved ? PW_MASK : "");
  const untouched = saved && pw === PW_MASK;
  return (
    <>
      <input
        id="sms-pw"
        type="password"
        autoComplete="new-password"
        value={pw}
        // 누르면 비워서 새 비밀번호를 바로 입력할 수 있게 한다.
        onFocus={() => {
          if (untouched) setPw("");
        }}
        // 아무것도 안 넣고 나가면 다시 ●●●●로 — "저장돼 있다"는 표시를 되살린다.
        onBlur={() => {
          if (saved && pw === "") setPw(PW_MASK);
        }}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비즈모아샷 비밀번호"
        style={inputStyle}
      />
      <input type="hidden" name="password" value={untouched ? "" : pw} />
    </>
  );
}

function StatusPill({ status }: { status: CompanySmsStatusView }) {
  const view = status.connected
    ? { bg: "#DCFCE7", dot: "var(--success)", fg: "#15803D", text: "연결됨" }
    : status.passwordSaved && !status.passwordUsable
      ? { bg: "#FEF3C7", dot: "var(--warning)", fg: "#92400E", text: "비밀번호 다시 필요" }
      : { bg: "#F3F4F6", dot: "#9CA3AF", fg: "#4B5563", text: "연결 안 됨" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: view.bg }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: view.dot }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: view.fg, whiteSpace: "nowrap" }}>{view.text}</span>
    </span>
  );
}

function StepCard({ n, title, body, href, linkText }: { n: number; title: string; body: string; href?: string; linkText?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 24, height: 24, borderRadius: "50%", background: "var(--primary)", color: "#fff",
            fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          {n}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, wordBreak: "keep-all" }}>{title}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6, wordBreak: "keep-all", flex: 1 }}>{body}</div>
      {href && linkText && (
        <a href={href} target="_blank" rel="noopener noreferrer" style={linkBtn}>
          {linkText} ↗
        </a>
      )}
    </div>
  );
}

export function CompanySmsForm({ status, myPhone }: { status: CompanySmsStatusView; myPhone: string }) {
  const [saveState, saveAction, savePending] = useActionState(saveCompanySmsAccount, {});
  const [testState, testAction, testPending] = useActionState(sendCompanySmsTest, {});
  const [clearState, setClearState] = useState<CompanySmsFormState>({});
  const [clearPending, startClear] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 결과 문구는 **마지막으로 누른 동작의 것만** 보여 준다(검수 경미 5) — 안 그러면 연결을 해제한 뒤에도
  // "저장했습니다. [시험 문자 보내기]로…"가 함께 남아 앞뒤가 맞지 않는다.
  const [lastAction, setLastAction] = useState<"save" | "test" | "clear" | null>(null);

  const hasAnything = !!status.smsId || status.passwordSaved || !!status.sender;

  function submitSave(fd: FormData) {
    setLastAction("save");
    saveAction(fd);
  }
  function submitTest(fd: FormData) {
    setLastAction("test");
    testAction(fd);
  }

  function confirmClear() {
    setConfirmOpen(false);
    setLastAction("clear");
    startClear(async () => {
      try {
        setClearState(await clearCompanySmsAccount());
      } catch {
        setClearState({ error: "연결 해제 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── 안내 + 단계 ───────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>비즈모아샷 문자 계정</div>
          <StatusPill status={status} />
          {status.updatedLabel && (
            <span style={{ fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>마지막 변경 {status.updatedLabel}</span>
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 14px", lineHeight: 1.7, wordBreak: "keep-all" }}>
          {/* 2단계(2026-11-21)부터 아래 세 가지가 실제로 이 계정으로 나간다(lib/company-sms.ts). 공지·알림톡은 아직 없다. */}
          직원에게 보내는 문자는 <b>우리 회사의 비즈모아샷 계정</b>으로 나갑니다. 요금은 비즈모아샷에 충전한 금액에서
          빠지며, 가온이 대신 보내지 않습니다.
        </p>

        <div style={noteBox("info")}>
          계정을 연결하면 이 계정으로 나가는 문자: <b>직원 비밀번호 찾기 인증번호</b> · [직원 관리]의{" "}
          <b>초대 링크 · 임시 비밀번호 [문자로 보내기]</b>. 연결하지 않으면 직원은 관리자에게 요청해 임시 비밀번호를 받고,
          초대 링크·임시 비밀번호는 복사해서 전달합니다.
        </div>
        {!status.keyReady && (
          <div style={noteBox("warn")}>
            서버 설정이 아직 끝나지 않아 지금은 비밀번호를 저장할 수 없습니다. 가온에서 설정을 마치면 바로 저장할 수 있습니다.
          </div>
        )}
        {status.passwordSaved && !status.passwordUsable && status.keyReady && (
          <div style={noteBox("warn")}>
            저장된 비밀번호를 확인할 수 없습니다. 아래에서 <b>비밀번호를 다시 입력해 저장</b>해 주세요.
          </div>
        )}

        {/* .kpi-grid-5 = 카드 최소폭 170px 자동 맞춤(PC 4칸 → 폰 1칸). .kpi-grid는 폰에서도 2칸이라
            링크 버튼이 카드 밖으로 삐져나왔다(2026-11-21 375px 확인). */}
        <div className="kpi-grid-5">
          <StepCard
            n={1}
            title="비즈모아샷 가입"
            body="아직 계정이 없으면 아래 버튼으로 가입합니다. 근태관리 전용 가입 주소라 이 버튼으로 가입해 주세요."
            href={MOASHOT_LINKS.signup}
            linkText="가입하러 가기"
          />
          <StepCard
            n={2}
            title="충전 · 잔액 확인"
            body="비즈모아샷에 로그인해 남은 금액을 확인하고 충전합니다. 잔액이 없으면 문자가 나가지 않습니다."
            href={MOASHOT_LINKS.charge}
            linkText="충전·잔액 확인"
          />
          <StepCard
            n={3}
            title="발신번호 사전등록"
            body="비즈모아샷의 [서비스관리] > [발신번호 사전등록]에서 등록합니다. 회사 명의의 번호만 등록할 수 있습니다."
            href={MOASHOT_LINKS.senderRegister}
            linkText="발신번호 등록하기"
          />
          <StepCard
            n={4}
            title="계정 입력 · 시험"
            body="아래에 비즈모아샷 아이디·비밀번호와 등록한 발신번호를 넣고 저장한 뒤, 시험 문자로 연결을 확인합니다."
          />
        </div>
      </div>

      {/* ── 계정 입력 | 시험 문자 ─────────────────────────────── */}
      <div className="split-2">
        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>계정 정보</div>
          {/* 저장할 때마다 key가 바뀌어 폼이 새로 그려진다 → 입력했던 비밀번호가 화면에 남지 않는다. */}
          <form key={status.updatedKey} action={submitSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle} htmlFor="sms-id">비즈모아샷 아이디</label>
              <input
                id="sms-id"
                name="smsId"
                type="text"
                autoComplete="off"
                defaultValue={status.smsId ?? ""}
                placeholder="비즈모아샷 홈페이지 로그인 아이디"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="sms-pw">비즈모아샷 비밀번호</label>
              <SavedPasswordInput saved={status.passwordSaved} />
              <div style={hintStyle}>
                {status.passwordSaved
                  ? "✓ 비밀번호가 저장돼 있습니다. 비즈모아샷 비밀번호를 바꿨을 때만 칸을 눌러 새로 입력하세요. 그대로 두면 저장된 비밀번호를 씁니다."
                  : "비밀번호는 암호화해 저장하며, 저장한 뒤에는 누구도 화면에서 다시 볼 수 없습니다."}
              </div>
            </div>
            <div>
              <label style={labelStyle} htmlFor="sms-sender">발신번호</label>
              <input
                id="sms-sender"
                name="sender"
                type="tel"
                autoComplete="off"
                defaultValue={status.sender ? formatPhone(status.sender) : ""}
                placeholder="예시) 02-1234-5678"
                style={inputStyle}
              />
              <div style={hintStyle}>비즈모아샷에 사전등록한 번호만 쓸 수 있습니다. 등록하지 않은 번호로는 문자가 나가지 않습니다.</div>
            </div>

            {lastAction === "save" && <Result state={saveState} />}

            <button type="submit" disabled={savePending} style={primaryBtn(savePending)}>
              {savePending ? "저장 중..." : "저장"}
            </button>
          </form>
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>시험 문자 보내기</div>
          <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 14px", lineHeight: 1.6, wordBreak: "keep-all" }}>
            저장한 계정으로 짧은 문자 1통을 보내 연결을 확인합니다. <b>단문 요금 1건</b>이 비즈모아샷 잔액에서 빠집니다.
            (1분에 1통 · 하루 5통 · 시도는 하루 10번까지)
          </p>

          {status.connected ? (
            <form action={submitTest} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle} htmlFor="sms-test-to">받을 휴대폰 번호</label>
                <input
                  id="sms-test-to"
                  name="to"
                  type="tel"
                  autoComplete="off"
                  defaultValue={myPhone ? formatPhone(myPhone) : ""}
                  placeholder="예시) 010-1234-5678"
                  style={inputStyle}
                />
              </div>
              {lastAction === "test" && <Result state={testState} />}
              <button type="submit" disabled={testPending} style={primaryBtn(testPending)}>
                {testPending ? "보내는 중..." : "시험 문자 보내기"}
              </button>
            </form>
          ) : (
            <div style={noteBox("info")}>계정 정보를 저장하면 시험 문자를 보낼 수 있습니다.</div>
          )}

          {(hasAnything || (lastAction === "clear" && clearState?.ok)) && (
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6, wordBreak: "keep-all" }}>
                다른 계정으로 바꾸려면 위에서 새 값으로 저장하면 됩니다. 문자 계정을 더 쓰지 않으려면 연결을 해제하세요.
              </div>
              {lastAction === "clear" && <Result state={clearState} />}
              {hasAnything && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={clearPending}
                  style={{
                    height: 38, padding: "0 14px", borderRadius: 8, border: "1px solid var(--danger)", background: "#fff",
                    color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                    cursor: clearPending ? "default" : "pointer", alignSelf: "flex-start",
                  }}
                >
                  {clearPending ? "해제 중..." : "연결 해제"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="문자 계정 연결 해제" maxWidth={420}>
        <p style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 18px", wordBreak: "keep-all" }}>
          저장된 비즈모아샷 아이디·비밀번호·발신번호를 지웁니다. 해제하면 회사 문자가 나가지 않습니다. 비즈모아샷 계정 자체는
          그대로입니다.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            style={{ height: 40, padding: "0 16px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirmClear}
            style={{ height: 40, padding: "0 16px", borderRadius: 8, border: "none", background: "var(--danger)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            연결 해제
          </button>
        </div>
      </Modal>
    </div>
  );
}
