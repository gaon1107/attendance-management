"use client";
// 직원 퇴사(비활성화)/복직 버튼 — 관리자만. 실수 방지를 위해 확인창을 띄운다.
// 퇴사해도 과거 근태 기록은 리포트에 그대로 남고, 언제든 복직할 수 있다.
import { useActionState } from "react";
import { deactivateEmployee, reactivateEmployee } from "@/app/actions/employees";

export function EmployeeStatusActions({
  id,
  name,
  active,
  openAttendanceCount = 0,
  openAttendanceDates = [],
  workingNow = false,
}: {
  id: string;
  name: string;
  active: boolean;
  openAttendanceCount?: number;
  openAttendanceDates?: string[];
  workingNow?: boolean;
}) {
  // 퇴사 처리는 실패할 수 있다(마지막 관리자·회사 계정). 그 이유를 화면에 띄운다 — 검수 2차 5.
  const [state, formAction] = useActionState<{ error?: string; ok?: boolean }, FormData>(deactivateEmployee, {});

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
          if (!confirm(`${name} 님을 퇴사 처리할까요?\n\n로그인이 막히고 직원 목록에서 내려갑니다.\n과거 근태 기록은 리포트에 그대로 보존되며, 나중에 복직할 수 있습니다.${workingWarning}${openWarning}`)) {
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
          style={{ height: 44, padding: "0 20px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          퇴사 처리(비활성화)
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
