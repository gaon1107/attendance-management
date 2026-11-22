"use client";
// 운영자 회사 상세의 변경 폼 2개 — 무료 이용 마지막 날 · 시험용 회사 표시.
//  · 실제 검증·기록은 서버 액션(app/actions/operator-companies.ts)이 한다. 여기는 입력만.
import { useActionState, useState } from "react";
import { DatePicker } from "@/app/components/DatePicker";
import { setCompanyTrial, setCompanyDemo, terminateCompany, restoreCompany, type OperatorActionResult } from "@/app/actions/operator-companies";
import { companyNameMatches } from "@/lib/company-name";

function todayPlus(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Msg({ s }: { s: OperatorActionResult }) {
  if (!s) return null;
  return (
    <div role="status" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: s.ok ? "var(--success)" : "var(--danger)", wordBreak: "keep-all" }}>
      {s.message}
    </div>
  );
}

const btn: React.CSSProperties = {
  height: 40, padding: "0 16px", borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
};

export function TrialForm({ companyId, current, custom }: { companyId: string; current: string; custom: boolean }) {
  const [state, action, pending] = useActionState(setCompanyTrial, null);
  // 빠른 선택 단추가 날짜 칸을 바꿀 수 있게 값과 key를 함께 둔다(DatePicker는 defaultValue 방식이라 key로 다시 그린다).
  //  · 고른 값은 "어느 저장 결과(state) 뒤에 고른 것인지"와 함께 기억한다. 저장·되돌리기를 하면 state가 새로 바뀌므로
  //    예전에 고른 값은 버리고 서버의 새 저장값(current)을 보여준다(3단계 검수 경미 4 — 되돌린 뒤에도 옛 날짜가 남아
  //    그대로 저장을 누르면 다시 지정되던 문제). 저장값 문자열로 비교하면 "처음 날짜 = 되돌린 날짜"인 경우를 놓친다(실측).
  const [picked, setPicked] = useState<{ after: OperatorActionResult; iso: string } | null>(null);
  const [rev, setRev] = useState(0);
  const value = picked && picked.after === state ? picked.iso : current;
  const pick = (iso: string) => {
    setPicked({ after: state, iso });
    setRev((r) => r + 1);
  };
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="mode" value="set" />
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-sub)", marginBottom: 6 }}>무료로 쓸 수 있는 마지막 날</div>
        <div style={{ maxWidth: 260 }}>
          <DatePicker
            key={`${current}|${rev}|${state ? state.message : ""}`}
            name="trialLastDate"
            defaultValue={value}
            allowClear={false}
            onChange={(iso) => setPicked({ after: state, iso })}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" onClick={() => pick(todayPlus(29))} style={{ ...btn, height: 32, fontSize: 13, background: "#fff", border: "1px solid var(--border)", color: "var(--text)" }}>
            오늘 포함 30일
          </button>
          <button type="button" onClick={() => pick(todayPlus(89))} style={{ ...btn, height: 32, fontSize: 13, background: "#fff", border: "1px solid var(--border)", color: "var(--text)" }}>
            오늘 포함 90일
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button type="submit" disabled={pending} style={{ ...btn, border: 0, background: "var(--primary)", color: "#fff", opacity: pending ? 0.6 : 1 }}>
            {pending ? "저장 중…" : "이 날짜로 저장"}
          </button>
        </div>
      </form>
      {custom && (
        <form action={action} style={{ marginTop: 8 }}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="mode" value="reset" />
          <button type="submit" disabled={pending} style={{ ...btn, height: 34, fontSize: 13, background: "#fff", border: "1px solid var(--border)", color: "var(--text-sub)" }}>
            기본값(가입일부터 30일)으로 되돌리기
          </button>
        </form>
      )}
      <Msg s={state} />
    </div>
  );
}

export function DemoForm({ companyId, isDemo }: { companyId: string; isDemo: boolean }) {
  const [state, action, pending] = useActionState(setCompanyDemo, null);
  return (
    <form action={action}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="on" value={isDemo ? "0" : "1"} />
      <button
        type="submit"
        disabled={pending}
        style={{ ...btn, background: "#fff", border: "1px solid var(--border)", color: isDemo ? "var(--text)" : "var(--text-sub)", opacity: pending ? 0.6 : 1 }}
      >
        {isDemo ? "시험용 표시 해제" : "시험용 회사로 표시"}
      </button>
      <Msg s={state} />
    </form>
  );
}

// ── 해지(탈퇴) 처리 / 되살리기 — 2026-11-22, 이용약관 제14조 ④·제15조 ──────────────
//  🔴 해지하면 **그 회사 사람 전원이 즉시 로그인할 수 없다**(출퇴근도 못 찍는다). 그래서 버튼 하나로 끝내지 않고
//     회사 이름을 그대로 다시 입력하게 한다. 서버도 같은 검사를 한다(화면 검사만으로는 방어가 아니다).
//  🔴 해지 자체는 **데이터를 지우지 않는다.** 30일 안에는 [되살리기]로 원래대로 돌아간다.
//     30일이 지나면 되살리기가 막히고 그 뒤 첫 새벽에 자동 파기된다(해지 2단계, lib/company-purge.ts).
/**
 * 해지·되살리기 전용 메시지 — **실패했을 때만** 보여 준다.
 *  🔴 성공 메시지를 그대로 두면 화면이 다른 상태로 바뀐 뒤에도 남아 "해지했는데 '되살렸습니다'가 보이는"
 *     모순이 생긴다(2026-11-22 화면 확인에서 발견). 성공은 화면 자체가 바뀌어 이미 말해 준다
 *     — 해지되면 빨간 안내와 [되살리기] 버튼이, 되살리면 입력칸과 [해지 처리]가 나온다.
 */
function FailMsg({ s }: { s: OperatorActionResult }) {
  if (!s || s.ok) return null;
  // 실패 안내라 role="alert" — 화면을 읽어 주는 기능이 즉시 읽는다(재검수 경미 4).
  return (
    <div role="alert" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: "var(--danger)", wordBreak: "keep-all" }}>
      {s.message}
    </div>
  );
}

export function TerminateForm({ companyId, companyName, terminatedAt, terminatedBy, terminatedNote, purgeDue, restoreBlocked }: {
  companyId: string;
  companyName: string;
  terminatedAt: string | null;
  terminatedBy: string | null;
  terminatedNote: string | null;
  purgeDue: string | null; // 파기 대상이 되는 시각(해지 + 30일) — 표시용 글자
  restoreBlocked: string | null; // 되살릴 수 없는 이유(서버가 판정). null이면 되살리기 가능
}) {
  const [termState, termAction, termPending] = useActionState(terminateCompany, null);
  const [restState, restAction, restPending] = useActionState(restoreCompany, null);
  const [confirmName, setConfirmName] = useState("");
  // 🔴 자료 전달 확인(2026-11-22 사장님 결정). 해지하면 고객사가 로그인할 수 없어 **스스로 자료를 받을 수 없다**
  //    → 약관 제14조 ③④대로 "해지 전에 전달"하는 절차를 화면이 강제한다. 서버도 같은 검사를 한다.
  const [handover, setHandover] = useState(false);
  // 🔴 서버와 **같은 함수**로 판정한다 — 기준이 어긋나면 버튼과 서버가 따로 논다(재검수 중간 A).
  const nameOk = companyNameMatches(confirmName, companyName) && handover;

  // 이미 해지된 회사 — 되살리기만 보여 준다.
  if (terminatedAt) {
    return (
      <div>
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "12px 14px", fontSize: 14, color: "#991B1B", lineHeight: 1.7, wordBreak: "keep-all", marginBottom: 12 }}>
          <b>해지된 회사입니다.</b> 이 회사의 모든 계정이 로그인할 수 없고 PC 프로그램도 멈춥니다.
          <div style={{ marginTop: 6, fontSize: 13 }}>
            해지 시각 <b>{terminatedAt}</b>
            {terminatedBy && <> · 처리자 <b>{terminatedBy}</b></>}
            {terminatedNote && <> · 사유 {terminatedNote}</>}
          </div>
          {restoreBlocked ? (
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700 }}>{restoreBlocked}</div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              데이터는 아직 그대로 있습니다. <b>{purgeDue}</b>이 지나면 되살릴 수 없고, 그 뒤 첫 새벽(1~3시)에 <b>모든 데이터가 자동으로 파기</b>됩니다.
              {" "}자료 전달 요청은 그 전에 처리해 주세요.
            </div>
          )}
        </div>
        {!restoreBlocked && (
          <form action={restAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <button type="submit" disabled={restPending} style={{ ...btn, background: "var(--primary)", border: "1px solid var(--primary)", color: "#fff", opacity: restPending ? 0.6 : 1 }}>
              되살리기(해지 취소)
            </button>
            <FailMsg s={restState} />
          </form>
        )}
      </div>
    );
  }

  return (
    <form action={termAction}>
      <input type="hidden" name="companyId" value={companyId} />
      <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#92400E", lineHeight: 1.7, wordBreak: "keep-all", marginBottom: 12 }}>
        해지하면 <b>이 회사의 모든 계정이 즉시 로그인할 수 없습니다</b>(직원 출퇴근 포함). 30일 안에는 되살릴 수 있고, <b>30일이 지나면 모든 데이터가 자동으로 파기</b>됩니다.
        {/* 근무 중 해지하면 그날 퇴근을 찍을 방법이 없어 기록이 미완결로 남는다(검수 중간 6).
               되살려도 clockOut이 빈 기록이 그대로 남으므로 **시간대를 고르는 것이 유일한 예방책**이다. */}
        <br />
        <b>업무 시간이 끝난 뒤에 처리하세요.</b> 출근 중인 직원이 있으면 그날 퇴근 기록이 비어 버립니다(되살려도 그대로 남습니다).
        <br />
        확인을 위해 회사 이름 <b>{companyName}</b>을(를) 그대로 입력해 주세요.
      </div>
      {/* 🔴 자료 전달 확인 — 해지하면 고객사는 스스로 자료를 받을 수 없다(로그인 차단).
             약관 제14조 ③④가 "해지 전에 받거나 고객지원이 전달한다"이므로, 이 절차를 빠뜨리지 않게 막는다. */}
      <label style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 12, fontSize: 13, lineHeight: 1.7, cursor: "pointer", wordBreak: "keep-all" }}>
        <input type="checkbox" name="handover" checked={handover} onChange={(e) => setHandover(e.target.checked)} style={{ width: 17, height: 17, flexShrink: 0, marginTop: 2 }} />
        <span>
          <b>[필수]</b> 이 회사에 필요한 <b>근태 자료(엑셀·PDF) 전달을 마쳤거나, 고객사가 직접 내려받았음</b>을 확인했습니다.
          <br />
          <span style={{ color: "var(--text-sub)" }}>해지하면 고객사는 로그인할 수 없어 스스로 받을 수 없습니다. 해지 후 30일 안에는 요청을 받아 전달할 수 있습니다.</span>
        </span>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>
        <input
          name="confirmName"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={companyName}
          autoComplete="off"
          style={{ height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, fontFamily: "inherit", minWidth: 180, flex: "1 1 180px" }}
        />
        <input
          name="note"
          placeholder="사유(선택)"
          autoComplete="off"
          style={{ height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 14, fontFamily: "inherit", minWidth: 150, flex: "1 1 150px" }}
        />
        <button
          type="submit"
          disabled={termPending || !nameOk}
          style={{ ...btn, background: nameOk ? "var(--danger)" : "#fff", border: `1px solid ${nameOk ? "var(--danger)" : "var(--border)"}`, color: nameOk ? "#fff" : "var(--text-sub)", opacity: termPending ? 0.6 : 1, cursor: nameOk ? "pointer" : "not-allowed" }}
        >
          해지 처리
        </button>
      </div>
      <FailMsg s={termState} />
    </form>
  );
}
