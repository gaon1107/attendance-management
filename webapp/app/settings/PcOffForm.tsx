"use client";
// PC-OFF 설정 카드 — 근무시간이 끝나면 직원 PC를 잠그는 규칙을 회사가 정한다.
//  · 구조는 OutingReasonForm(가장 최근 설정 카드)과 같은 패턴: useActionState + 저장값 동기화 + 미리보기.
//  · ⚠️ 이 설정만으로는 아무 것도 잠기지 않는다. 직원 PC에 전용 프로그램이 설치돼 있어야 한다(안내문에 명시).
import { useActionState, useState } from "react";
import { savePcOffSettings } from "@/app/actions/pcoff";
// ⚠️ 서버 전용 lib/pcoff-policy.ts(prisma 사용)가 아니라 순수 모듈 lib/pcoff.ts에서 가져온다.
//    (서버 전용 파일을 화면에서 import하면 DB 관련 코드가 브라우저로 딸려간다)
import { parseNotifyMins, PCOFF_LIMITS } from "@/lib/pcoff";

type Props = {
  initial: {
    on: boolean;
    mode: string;
    delayMin: number;
    notifyMins: string;
    tempUseMin: number;
    tempUsePerDay: number;
    workEndTime: string | null; // 잠금 기준선. 없으면 동작하지 않으므로 화면에서 먼저 알린다.
    deviceCount: number;        // 지금 연결된 PC 수(가짜 데이터 금지 — 실제 AgentDevice 수)
    isShiftCompany: boolean;    // 교대근무 회사면 1차 미지원(야간조가 표준 퇴근시각에 잠기는 사고 방지)
  };
};

const inputStyle = {
  height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%",
} as const;

const labelStyle = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 } as const;

export function PcOffForm({ initial }: Props) {
  const [state, formAction, pending] = useActionState(savePcOffSettings, {});
  const [on, setOn] = useState(initial.on);
  const [delayMin, setDelayMin] = useState(String(initial.delayMin));
  const [notify, setNotify] = useState(initial.notifyMins);
  const [tempUseMin, setTempUseMin] = useState(String(initial.tempUseMin));
  const [perDay, setPerDay] = useState(String(initial.tempUsePerDay));

  // 저장 성공 시 실제 저장된 알림값으로 입력칸을 맞춘다(정리 규칙으로 빠진 항목이 화면과 어긋나지 않게).
  //  · effect 대신 이전 결과와 비교해 렌더 중 갱신(OutingReasonForm·usePagination과 같은 검증된 패턴).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.ok && typeof state.savedNotify === "string") setNotify(state.savedNotify);
  }

  const notifyPreview = parseNotifyMins(notify);
  const delayNum = Number(delayMin);
  // 잠금 예정 시각 미리보기 — 퇴근 기준시각 + 유예. 실제 판정은 설치 앱이 서버시각 기준으로 한다.
  const lockAt = initial.workEndTime && Number.isFinite(delayNum) ? addMinutes(initial.workEndTime, delayNum) : null;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>PC-OFF (근무시간 외 PC 잠금)</div>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: on ? "#DCFCE7" : "#F3F4F6", color: on ? "#15803D" : "var(--text-sub)" }}>
          {on ? "사용 중" : "사용 안 함"}
        </span>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        퇴근 시각이 지나면 직원 PC 화면을 잠가 불필요한 야근을 줄입니다. 승인된 연장근무 시간에는 잠기지 않습니다.
        <br />
        ⚠️ 이 설정만으로는 잠기지 않습니다. 직원 PC에 <b>전용 프로그램</b>이 설치돼 있어야 하며, 직원은 [계정] 화면에서 연결코드를 발급받아 연결합니다.
        {" "}현재 연결된 PC <b>{initial.deviceCount}대</b>.
      </p>

      {/* 교대근무 회사는 1차 미지원 — 표준 퇴근시각으로 판단하면 야간조가 근무 중에 잠긴다. */}
      {initial.isShiftCompany && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309", lineHeight: 1.6, wordBreak: "keep-all" }}>
            ⚠️ 교대근무를 쓰는 회사는 아직 지원하지 않습니다. 조마다 퇴근 시각이 달라 야간조 근무 중에 잠길 수 있어,
            켜두어도 실제로는 동작하지 않습니다(다음 단계에서 지원 예정).
          </span>
        </div>
      )}

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 사용 여부 */}
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" name="pcOffOn" checked={on} onChange={(e) => setOn(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--primary)" }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>PC-OFF 사용</span>
        </label>

        {/* 1차는 화면 잠금만 지원 — 값은 고정으로 보내고, 이유를 함께 보여준다(전원 종료는 문서 손실 위험). */}
        <input type="hidden" name="pcOffMode" value="lock" />

        <div className="split-2">
          <div>
            <label htmlFor="pcoff-delay" style={labelStyle}>퇴근 후 유예 (분)</label>
            <input
              id="pcoff-delay" name="pcOffDelayMin" type="number" min={PCOFF_LIMITS.delayMin.min} max={PCOFF_LIMITS.delayMin.max}
              value={delayMin} onChange={(e) => setDelayMin(e.target.value)} style={inputStyle}
            />
            <p style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.5, wordBreak: "keep-all" }}>
              {initial.workEndTime
                ? <>퇴근 기준시각 <b>{initial.workEndTime}</b> + 유예 → <b>{lockAt ?? "-"}</b>에 잠깁니다.</>
                : <span style={{ color: "var(--warning)", fontWeight: 700 }}>퇴근 기준시각이 없어 잠기지 않습니다. [근무제] 카드에서 먼저 정해주세요.</span>}
            </p>
          </div>

          <div>
            <label htmlFor="pcoff-notify" style={labelStyle}>미리 알림 (분 전, 쉼표로 구분)</label>
            <input
              id="pcoff-notify" name="pcOffNotifyMins" type="text" value={notify}
              onChange={(e) => setNotify(e.target.value)} placeholder="10,5" style={inputStyle}
            />
            <p style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.5, wordBreak: "keep-all" }}>
              {notifyPreview.length > 0
                ? <>잠기기 <b>{notifyPreview.join("분 전, ")}분 전</b>에 “문서를 저장하세요” 알림을 띄웁니다.</>
                : "알림 없이 바로 잠깁니다."}
            </p>
          </div>
        </div>

        <div className="split-2">
          <div>
            <label htmlFor="pcoff-temp" style={labelStyle}>일시사용 1회 시간 (분)</label>
            <input
              id="pcoff-temp" name="pcOffTempUseMin" type="number" min={PCOFF_LIMITS.tempUseMin.min} max={PCOFF_LIMITS.tempUseMin.max}
              value={tempUseMin} onChange={(e) => setTempUseMin(e.target.value)} style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="pcoff-perday" style={labelStyle}>일시사용 하루 횟수</label>
            <input
              id="pcoff-perday" name="pcOffTempUsePerDay" type="number" min={PCOFF_LIMITS.tempUsePerDay.min} max={PCOFF_LIMITS.tempUsePerDay.max}
              value={perDay} onChange={(e) => setPerDay(e.target.value)} style={inputStyle}
            />
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-sub)", marginTop: -4, lineHeight: 1.5, wordBreak: "keep-all" }}>
          결재자가 자리에 없어 연장근무 승인을 못 받을 때, 직원이 <b>사유를 적고</b> 잠금을 잠시 푸는 기능입니다.
          사용 내역은 [PC관리] 화면에 남습니다. 횟수를 <b>0</b>으로 두면 사용할 수 없습니다.
        </p>

        <div style={{ background: "#F9FAFB", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 6 }}>직원에게 알려야 할 점</div>
          <p style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6, wordBreak: "keep-all", margin: 0 }}>
            이 기능은 <b>PC 사용 가능 시간만</b> 제어합니다. 화면 내용·입력 내용·사용한 프로그램 목록은 <b>수집하지 않습니다</b>.
            도입 전 취업규칙·동의 절차를 확인하세요. 대표·전산담당 등은 [PC관리]에서 예외로 지정할 수 있습니다.
          </p>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, wordBreak: "keep-all" }}>{state.error}</div>}
        {state?.ok && (
          <div style={{ fontSize: 13, color: state.warn ? "var(--warning)" : "var(--success)", fontWeight: 700, lineHeight: 1.6, wordBreak: "keep-all" }}>
            저장되었습니다.{state.warn ? ` ${state.warn}` : ""}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}

// "18:00" + 30분 → "18:30". 자정을 넘기면 다음날 표기를 붙인다.
function addMinutes(hm: string, add: number): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!m || !Number.isFinite(add)) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(add);
  const day = Math.floor(total / (24 * 60));
  const rest = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const label = `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`;
  return day > 0 ? `다음날 ${label}` : label;
}
