"use client";
// 운영자 회사 상세의 변경 폼 2개 — 무료 이용 마지막 날 · 시험용 회사 표시.
//  · 실제 검증·기록은 서버 액션(app/actions/operator-companies.ts)이 한다. 여기는 입력만.
import { useActionState, useState } from "react";
import { DatePicker } from "@/app/components/DatePicker";
import { setCompanyTrial, setCompanyDemo, type OperatorActionResult } from "@/app/actions/operator-companies";

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
