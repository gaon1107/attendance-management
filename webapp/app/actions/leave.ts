"use server";
// 휴가 신청/취소(직원) + 승인/반려·연차부여(관리자).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { effectiveWorkDays } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { REQUESTABLE_TYPES, isSingleDayLeave, leaveTypeDeducts, computeLeaveDays, parseYmd, leaveBalanceInYear, rangesOverlap, leaveTypeLabel } from "@/lib/leave";
import { toISODate } from "@/lib/period";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps, isSelfApprovalBlocked } from "@/lib/approval-server";

// 직원: 휴가 신청. 종류·기간을 받아 근무요일 기준 사용일수를 계산하고 대기 상태로 만든다.
export async function requestLeave(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const type = String(formData.get("type") ?? "");
  if (!(REQUESTABLE_TYPES as readonly string[]).includes(type)) return { error: "휴가 종류를 선택해주세요." };

  const start = parseYmd(String(formData.get("startDate") ?? ""));
  const endRaw = String(formData.get("endDate") ?? "");
  const singleDay = isSingleDayLeave(type); // 반차(오전·오후)·병가·조퇴는 하루짜리(종료일 없음)
  // 여러 날짜 종류(연차 등)는 종료일 필수 — 빈 값이 조용히 "당일"로 처리되지 않게 명시적으로 막는다.
  if (!singleDay && !parseYmd(endRaw)) return { error: "종료일을 선택해주세요." };
  const end = singleDay ? start : parseYmd(endRaw) ?? start;
  if (!start || !end) return { error: "날짜를 올바르게 선택해주세요." };
  if (end < start) return { error: "종료일이 시작일보다 빠릅니다." };

  const reason = String(formData.get("reason") ?? "").trim() || null;

  // 내 근무요일(회사 기본 또는 개인 예외) + 결재방식
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true, holidayAutoOn: true, approvalMode: true, approvalStepCount: true } });
  const wd = effectiveWorkDays(me.workDays, company?.workDays);
  // 신청 기간의 쉬는 날(공휴일·회사휴무일)은 연차 차감에서 제외한다.
  const offDays = await loadOffDays(me.companyId, company?.holidayAutoOn ?? true, start, end);

  const days = computeLeaveDays(type, start, end, wd, offDays);
  // 조퇴는 연차 차감이 없어 days=0이 정상 → 근무일수 검사에서 제외한다. (그 외는 근무일이 0이면 신청 무의미)
  if (type !== "early_leave" && days <= 0) return { error: "선택한 기간에 근무일이 없습니다. 근무요일을 확인해주세요." };

  // 무차감 다일 휴가(경조·공가·특별)는 잔여 한도가 없어 상한이 없다 → 1회 신청 근무일수 상한으로 비정상 장기신청을 막는다.
  //  (연차·반차는 아래 잔여검사로 제한됨. 조퇴·병가는 하루라 이 상한에 걸리지 않음.)
  const MAX_NONDEDUCT_DAYS = 60;
  if (!leaveTypeDeducts(type) && days > MAX_NONDEDUCT_DAYS) {
    return { error: `한 번에 신청할 수 있는 근무일수(${MAX_NONDEDUCT_DAYS}일)를 넘었습니다. 기간을 나눠 신청해주세요.` };
  }

  // 내가 낸 신청 전체를 한 번만 읽어 ①기간 겹침 ②잔여 검사에 함께 쓴다.
  const mine = await prisma.leaveRequest.findMany({
    where: { userId: me.id, companyId: me.companyId },
    select: { type: true, days: true, status: true, startDate: true, endDate: true },
  });

  // ① 같은 날짜에 이미 잡아둔 휴가가 있으면 거부 (검수 C-3 — 중복 신청 이중 차감 방지).
  //    · 같은 종류가 겹치면 무조건 거부(버튼 두 번 눌림·고의 중복 모두 여기서 걸린다)
  //    · 종류가 달라도 둘 다 연차에서 깎는 휴가면 거부
  //    · 예외: 오전 반차 + 오후 반차는 하루를 나눠 쓰는 정상 조합이라 허용한다
  const isHalfPair = (a: string, b: string) =>
    (a === "half_am" && b === "half_pm") || (a === "half_pm" && b === "half_am");
  const conflict = mine.find(
    (r) =>
      (r.status === "pending" || r.status === "approved") &&
      rangesOverlap(start, end, r.startDate, r.endDate) &&
      (r.type === type ||
        (leaveTypeDeducts(type) && leaveTypeDeducts(r.type) && !isHalfPair(type, r.type)))
  );
  if (conflict) {
    const when =
      toISODate(conflict.startDate) === toISODate(conflict.endDate)
        ? toISODate(conflict.startDate)
        : `${toISODate(conflict.startDate)} ~ ${toISODate(conflict.endDate)}`;
    // 안내는 상태에 따라 다르게 — 승인된 휴가는 직원이 스스로 취소할 수 없다(관리자 문의 필요).
    const guide =
      conflict.status === "approved"
        ? "이미 확정된 휴가라 직접 취소할 수 없습니다. 날짜를 바꾸시거나, 기존 휴가를 되돌려야 하면 관리자에게 문의해주세요."
        : "기존 신청을 취소하거나 다른 날짜를 선택해주세요.";
    const state = conflict.status === "approved" ? "승인된" : "결재 대기 중인";
    return {
      error: `이미 ${state} ${leaveTypeLabel(conflict.type)}(${when})와 날짜가 겹칩니다. ${guide}`,
    };
  }

  // ② 연차·반차는 잔여를 넘을 수 없다(병가·경조·공가·특별·조퇴는 차감 안 함).
  //    잔여 = 그 해 발생 − 승인분 − 대기분. 대기분까지 빼는 이유는 lib/leave.ts 설명 참고(검수 C-2).
  if (leaveTypeDeducts(type)) {
    // asOf는 기본값(지금) — 화면에 보이는 잔여와 반드시 같은 숫자여야 한다(lib/leave.ts 주의사항 참고).
    const balance = leaveBalanceInYear(me, mine, start.getFullYear());
    if (days > balance.remaining) {
      const detail =
        balance.pending > 0
          ? `(발생 ${balance.granted}일 − 사용 ${balance.used}일 − 결재 대기 ${balance.pending}일)`
          : `(발생 ${balance.granted}일 − 사용 ${balance.used}일)`;
      return {
        error: `잔여 연차 ${balance.remaining}일보다 많이 신청했습니다. ${days}일 신청 ${detail}`,
      };
    }
  }

  const created = await prisma.leaveRequest.create({
    data: { companyId: me.companyId, userId: me.id, type, startDate: start, endDate: end, days, reason },
  });

  // 🔒 동시 요청 방어 — 위 겹침 검사와 생성 사이에 다른 요청이 끼어들면 둘 다 통과해
  //    같은 기간 신청이 2건 만들어진다(새 탭 두 개·폼 재제출·더블클릭).
  //    만든 직후 같은 종류·같은 기간의 대기 건을 세어, 먼저 만들어진 것만 남기고 내 것을 지운다.
  //    (출퇴근에서 쓴 방식과 같다 — 두 요청이 같은 정렬을 보므로 결과가 하나로 수렴한다)
  const twins = await prisma.leaveRequest.findMany({
    where: {
      userId: me.id,
      companyId: me.companyId,
      type,
      startDate: start,
      endDate: end,
      status: "pending",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (twins.length > 1 && twins[0].id !== created.id) {
    await prisma.leaveRequest.delete({ where: { id: created.id } }); // 결재단계 생성 전이라 딸린 자료 없음
    revalidatePath("/leave");
    return { error: "이미 같은 기간으로 신청되었습니다." };
  }

  // 부서장 결재선을 켠 회사면 결재 단계를 생성(비결재선/결재자 없음이면 만들지 않음=관리자 단일 승인).
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "leave", created.id);

  revalidatePath("/leave");
  return { ok: true };
}

// 직원: 대기 중인 내 신청 취소(삭제). 이미 승인/반려된 건 취소 불가.
export async function cancelLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const lv = await prisma.leaveRequest.findFirst({ where: { id, userId: me.id, status: "pending" } });
  if (!lv) return;
  await deleteApprovalSteps(me.companyId, "leave", lv.id); // 결재 단계도 함께 정리(고아 방지)
  await prisma.leaveRequest.delete({ where: { id: lv.id } });
  revalidatePath("/leave");
  revalidatePath("/approvals");
}

// 휴가 승인 — 회사 격리. 단일 승인이면 관리자만, 부서장 결재선이면 현재 단계 결재자(또는 관리자 오버라이드).
//  · 전 단계가 끝나 체인이 완료될 때만 원본 status를 approved로 바꾼다(그전엔 pending 유지 → 소비처 회귀 0).
export async function approveLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  const comment = raw ? Array.from(raw).slice(0, 500).join("") : undefined; // 승인 사유는 선택, 코드포인트 기준 상한
  const lv = await prisma.leaveRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!lv) return;
  // 🔴 자기 신청을 자기가 승인하지 못하게 막는다(다른 관리자가 없으면 허용 — lib/approval-server.ts 설명).
  if (await isSelfApprovalBlocked(me, lv.userId)) return;

  // 🔴 승인 시점 잔여 재검사 (검수 C-2 — 마지막 방어선).
  //   신청 때 통과했어도 그 사이 다른 건이 승인돼 잔여가 줄었을 수 있다.
  //   여기서 다시 보지 않으면 대기 중인 여러 건을 차례로 승인해 잔여가 마이너스가 된다.
  if (leaveTypeDeducts(lv.type)) {
    const applicant = await prisma.user.findFirst({
      where: { id: lv.userId, companyId: me.companyId },
      select: { hireDate: true, annualLeaveOverride: true },
    });
    if (!applicant) return;
    const theirs = await prisma.leaveRequest.findMany({
      where: { userId: lv.userId, companyId: me.companyId },
      select: { type: true, days: true, status: true, startDate: true },
    });
    const year = lv.startDate.getFullYear();
    // 승인 판단 기준 = 발생 − **확정 사용분(승인)**.
    //   대기 중인 다른 건은 빼지 않는다. 빼면 대기 2건이 서로를 영구 차단해
    //   둘 다 승인할 수 없는 막다른 길이 생긴다(후속 검수 지적).
    //   먼저 승인한 건이 '사용'으로 잡히므로, 두 번째 건은 그때 정상적으로 걸린다.
    const balance = leaveBalanceInYear(applicant, theirs, year);
    const availableForThis = Math.round((balance.granted - balance.used) * 10) / 10;
    if (lv.days > availableForThis) {
      return; // 잔여 초과 → 승인하지 않는다(화면은 대기 상태 그대로 유지 + 승인화면에 사유 표시)
    }
  }

  const result = await advanceApproval(me, "leave", lv.id, "approve", comment);
  if (result === "denied") return;
  if (result === "approved") {
    // status:"pending" 가드 → 동시/재시도에도 한 번만 확정(멱등). 최종 결정사유·처리자를 원본에 미러(신청자 표시용).
    await prisma.leaveRequest.updateMany({ where: { id: lv.id, companyId: me.companyId, status: "pending" }, data: { status: "approved", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id } });
  }
  // "advanced" → 다음 결재자 대기, 원본은 pending 유지
  revalidatePath("/leave/approvals");
  revalidatePath("/leave");
  revalidatePath("/approvals");
}

// 휴가 반려 — 회사 격리. 어느 단계든 반려하면 원본을 반려 확정한다.
export async function rejectLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  if (!raw) return; // 반려 사유 필수 — 서버에서도 강제(클라이언트 우회·JS-off 폼 위조 방어)
  const comment = Array.from(raw).slice(0, 500).join(""); // 코드포인트 기준 상한(이모지 깨짐 방지)
  const lv = await prisma.leaveRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!lv) return;
  const result = await advanceApproval(me, "leave", lv.id, "reject", comment);
  if (result === "denied") return;
  await prisma.leaveRequest.updateMany({ where: { id: lv.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), decisionComment: comment, decidedById: me.id } });
  revalidatePath("/leave/approvals");
  revalidatePath("/leave");
  revalidatePath("/approvals");
}

// 관리자: 직원 연차 수동조정(override) 설정/해제(직원 상세). 회사 격리.
//  · auto=1  → override를 null로 지워 입사일 기준 자동계산으로 되돌린다.
//  · 그 외    → 입력한 일수를 override로 저장(특별부여/감액). 자동값보다 우선.
export async function setAnnualLeave(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  // 자동계산으로 되돌리기(수동조정 해제)
  if (String(formData.get("auto") ?? "") === "1") {
    await prisma.user.update({ where: { id: target.id }, data: { annualLeaveOverride: null } });
    revalidatePath(`/employees/${id}`);
    return { ok: true };
  }

  const days = Number(formData.get("days"));
  if (Number.isNaN(days) || days < 0 || days > 365) return { error: "연차 일수는 0~365일 사이로 입력해주세요." };

  await prisma.user.update({ where: { id: target.id }, data: { annualLeaveOverride: days } });
  revalidatePath(`/employees/${id}`);
  return { ok: true };
}
