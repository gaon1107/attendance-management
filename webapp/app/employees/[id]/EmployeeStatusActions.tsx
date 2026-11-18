"use client";
// 직원 퇴사(비활성화)/복직 버튼 — 관리자만. 실수 방지를 위해 확인창을 띄운다.
// 퇴사해도 과거 근태 기록은 리포트에 그대로 남고, 언제든 복직할 수 있다.
import { useActionState } from "react";
import Link from "next/link";
import { deactivateEmployee, reactivateEmployee } from "@/app/actions/employees";

export function EmployeeStatusActions({
  id,
  name,
  active,
  openAttendanceCount = 0,
  openAttendanceDates = [],
  workingNow = false,
  hasBiometric = false,
  faceLeft = false,
}: {
  id: string;
  name: string;
  active: boolean;
  openAttendanceCount?: number;
  openAttendanceDates?: string[];
  workingNow?: boolean;
  // [M8] 얼굴인증 동의·등록이 있는 직원 — 퇴사 확인창에 "얼굴 정보도 파기됨"을 알린다
  hasBiometric?: boolean;
  // [M8] 퇴사자인데 등록 얼굴이 남은 상태(퇴사·철회 때 얼굴서버 삭제 실패) — [생체정보]에서 다시 파기하도록 안내
  faceLeft?: boolean;
}) {
  // 퇴사 처리는 실패할 수 있다(마지막 관리자·회사 계정). 그 이유를 화면에 띄운다 — 검수 2차 5.
  //  [5-2 검수 L3] 퇴사 처리에 얼굴인증 서버 삭제(최대 십수 초)가 붙어, 처리 중임을 보여 주고 두 번 누르지 못하게 한다.
  const [state, formAction, pending] = useActionState<{ error?: string; ok?: boolean }, FormData>(deactivateEmployee, {});

  // 🔴 [검수 M-6] 퇴근을 안 찍은 기록이 있으면 **퇴사시키기 전에** 알린다.
  //    퇴사하면 본인이 로그인할 수 없어 [근태 정정]으로 그 퇴근 시각을 채울 방법이 사라진다.
  //    ※ 서버가 퇴근 시각을 지어내지 않는다(법정 3년 보존 기록 오염 방지) — 사람이 정정하도록 안내만 한다.
  const openDatesLabel = `${openAttendanceDates.join(", ")}${openAttendanceCount > openAttendanceDates.length ? " 외" : ""}`;
  const openWarning =
    openAttendanceCount > 0
      ? `\n\n⚠️ 퇴근을 안 찍은 출근 기록이 ${openAttendanceCount}건 있습니다(${openDatesLabel}).\n퇴사 처리하면 본인이 로그인할 수 없어 [근태 정정]으로 퇴근 시각을 채울 수 없게 됩니다.\n먼저 본인에게 정정을 신청받아 처리한 뒤에 퇴사시키시는 것을 권합니다.`
      : "";

  // 🔴 [2차 검수 치명 1] 지금 출근해 있는 사람을 그날 퇴사시키는 것이 사고가 가장 잦다.
  //    퇴사 처리 순간 세션이 삭제돼 본인은 오늘 퇴근을 영영 못 찍고, 그 하루가 미퇴근으로 굳는다.
  const workingWarning = workingNow
    ? `\n\n⚠️ 이 직원은 지금 출근 상태입니다(퇴근 전).\n지금 퇴사 처리하면 오늘 퇴근을 찍을 수 없어 오늘 기록이 '미퇴근'으로 굳습니다.\n퇴근을 찍은 뒤에 처리하시는 것을 권합니다.`
    : "";

  // [M8] 퇴사 = 생체정보 이용 목적 종료 → 등록 얼굴을 지체 없이 파기한다(동의 화면 약속). 관리자가 미리 알 수 있게.
  const biometricNotice = hasBiometric
    ? `\n\n얼굴인증을 쓰던 직원이라 등록된 얼굴 정보도 함께 파기됩니다.\n(출퇴근 촬영 사진은 동의 내용대로 90일 뒤 자동 삭제됩니다. 복직하면 본인이 다시 동의·등록해야 합니다.)`
    : "";

  // 이미 퇴사한 사람의 미퇴근 기록 — 고칠 수 있는 유일한 길(복직 → 본인 정정 → 재퇴사)을 알려준다.
  //  이 안내가 없으면 관리자는 방법이 없다고 생각하고 법정 기록을 그대로 둔다(검수 중간 3).
  const inactiveNotice = openAttendanceCount > 0 && (
    <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 12, wordBreak: "keep-all", lineHeight: 1.6 }}>
      ⚠️ 퇴근을 안 찍은 출근 기록 {openAttendanceCount}건({openDatesLabel})이 남아 있습니다. 본인만 [근태 정정]을 신청할 수 있으므로,
      고치려면 <b>복직 → 본인이 정정 신청 → 승인 → 다시 퇴사 처리</b> 순서로 진행해 주세요.
      <div style={{ fontWeight: 400, color: "var(--text-sub)", marginTop: 4 }}>
        단, 자정을 넘겨 일한 기록(예: 밤 10시 출근 → 새벽 6시 퇴근)은 지금의 [근태 정정]으로는 고칠 수 없습니다.
      </div>
    </div>
  );

  if (active) {
    return (
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm(`${name} 님을 퇴사 처리할까요?\n\n로그인이 막히고 직원 목록에서 내려갑니다.\n과거 근태 기록은 리포트에 그대로 보존되며, 나중에 복직할 수 있습니다.${workingWarning}${openWarning}${biometricNotice}`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        {workingNow && (
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 10, wordBreak: "keep-all", lineHeight: 1.6 }}>
            ⚠️ 이 직원은 <b>지금 출근 상태</b>입니다. 지금 퇴사시키면 오늘 퇴근을 찍을 수 없어 오늘 기록이 미퇴근으로 굳습니다.
            퇴근을 찍은 뒤에 처리해 주세요.
          </div>
        )}
        {openAttendanceCount > 0 && (
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 10, wordBreak: "keep-all", lineHeight: 1.6 }}>
            ⚠️ 퇴근을 안 찍은 출근 기록 {openAttendanceCount}건({openDatesLabel}) — 퇴사시키면 본인이 로그인할 수 없어 고칠 수 없게 됩니다.
            먼저 본인에게 [근태 정정]을 신청받아 처리해 주세요.
          </div>
        )}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          style={{ height: 44, padding: "0 20px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "wait" : "pointer", opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "퇴사 처리 중…" : "퇴사 처리(비활성화)"}
        </button>
        {state.error && (
          <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 8, wordBreak: "keep-all", lineHeight: 1.5 }}>
            {state.error}
          </div>
        )}
      </form>
    );
  }

  return (
    <form
      action={reactivateEmployee}
      onSubmit={(e) => {
        if (!confirm(`${name} 님을 복직시킬까요?\n다시 로그인할 수 있게 됩니다.`)) {
          e.preventDefault();
        }
      }}
    >
      {inactiveNotice}
      {faceLeft && (
        <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 12, wordBreak: "keep-all", lineHeight: 1.6 }}>
          {/* [5-2 검수 L6] 원인을 '퇴사 처리 때'로 단정하지 않는다 — 그 전 동의 철회 때 실패해 남은 것일 수도 있다 */}
          ⚠️ 이 직원의 등록 얼굴이 얼굴인증 서버에 아직 남아 있습니다(이전 삭제가 실패함 — 서버 응답 없음 등).
          <Link href="/biometrics" style={{ color: "var(--primary)", marginLeft: 4 }}>[생체정보] 화면에서 다시 파기하기 →</Link>
        </div>
      )}
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{ height: 44, padding: "0 20px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        복직시키기
      </button>
    </form>
  );
}
