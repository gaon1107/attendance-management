"use server";
// 근태 정정 요청(직원) + 승인/반려(관리자).
// 승인하면 그 날짜의 출퇴근 기록(Attendance)에 실제로 반영한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { isValidHm, hmToDate } from "@/lib/corrections";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps, isSelfApprovalBlocked } from "@/lib/approval-server";

// 직원: 근태 정정 요청. 날짜 + (출근/퇴근 중 하나 이상) + 사유.
export async function requestCorrection(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };
  // 🔒 회사 계정은 근태 기록을 가질 수 없다 — 정정이 승인되면 근태 기록이 만들어져
  //    출퇴근 차단을 우회한다(검수 2차 15).
  if (me.isOwner) return { error: "회사 계정은 근태 정정을 신청할 수 없습니다." };

  const targetDate = parseYmd(String(formData.get("targetDate") ?? ""));
  if (!targetDate) return { error: "정정할 날짜를 선택해주세요." };

  const inRaw = String(formData.get("requestedIn") ?? "").trim();
  const outRaw = String(formData.get("requestedOut") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!inRaw && !outRaw) return { error: "출근·퇴근 시각 중 최소 하나는 입력해주세요." };
  if (inRaw && !isValidHm(inRaw)) return { error: "출근 시각 형식이 올바르지 않습니다. (예: 09:00)" };
  if (outRaw && !isValidHm(outRaw)) return { error: "퇴근 시각 형식이 올바르지 않습니다. (예: 18:00)" };
  if (inRaw && outRaw && outRaw <= inRaw) return { error: "퇴근 시각이 출근 시각보다 빠르거나 같습니다." };
  if (!reason) return { error: "정정 사유를 입력해주세요." };

  // 🔒 미래 날짜 정정 금지 — 아직 오지 않은 날의 출근 기록을 미리 만들 수 없다(검수 M-6).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (targetDate > todayStart) return { error: "미래 날짜는 정정할 수 없습니다." };

  // 🔒 그날 기록이 없다면 출근·퇴근을 **둘 다** 받아야 한다(검수 C-5).
  //    퇴근 없는 과거 기록이 만들어지면 그 직원은 "계속 근무 중" 상태가 되어
  //    이후 출근이 막히거나 나중에 수십 시간짜리 근무로 닫힌다.
  const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
  const existing = await prisma.attendance.findFirst({
    where: { userId: me.id, companyId: me.companyId, clockIn: { gte: targetDate, lt: dayEnd } },
    select: { id: true, clockOut: true },
  });
  if (!existing && !(inRaw && outRaw)) {
    return { error: "그날 출퇴근 기록이 없습니다. 새로 만들려면 출근·퇴근 시각을 모두 입력해주세요." };
  }

  const created = await prisma.attendanceCorrection.create({
    data: {
      companyId: me.companyId,
      userId: me.id,
      targetDate,
      requestedIn: inRaw || null,
      requestedOut: outRaw || null,
      reason,
    },
  });
  // 부서장 결재선을 켠 회사면 결재 단계 생성(아니면 관리자 단일 승인).
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { approvalMode: true, approvalStepCount: true } });
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "correction", created.id);

  revalidatePath("/corrections");
  return { ok: true };
}

// 직원: 대기 중인 내 요청 취소.
export async function cancelCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, userId: me.id, status: "pending" } });
  if (!c) return;
  await deleteApprovalSteps(me.companyId, "correction", c.id); // 결재 단계도 함께 정리
  await prisma.attendanceCorrection.delete({ where: { id: c.id } });
  revalidatePath("/corrections");
  revalidatePath("/approvals");
}

// 정정 승인 → 체인 완료 시 그 날짜의 출퇴근 기록에 반영. 회사 격리.
//  · 단일 승인=관리자만, 부서장 결재선=현재 단계 결재자(또는 관리자). 기록 반영은 최종 승인 1회만.
export async function approveCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  const comment = raw ? Array.from(raw).slice(0, 500).join("") : undefined; // 승인 사유는 선택, 코드포인트 기준 상한
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!c) return;

  // 🔴 자기 신청을 자기가 승인하지 못하게 막는다(다른 관리자가 없으면 허용 — lib/approval-server.ts 설명).
  if (await isSelfApprovalBlocked(me, c.userId)) return;
  const result = await advanceApproval(me, "correction", c.id, "approve", comment);
  if (result === "denied") return;
  if (result !== "approved") {
    // "advanced" → 다음 결재자 대기. 기록 반영·상태 변경 없음.
    revalidatePath("/corrections/approvals");
    revalidatePath("/corrections");
    revalidatePath("/approvals");
    return;
  }

  // 여기부터는 체인 완료(최종 승인) → 실제 기록 반영.
  // 그 날짜 범위 [자정, 다음날 자정)
  const dayStart = c.targetDate;
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const newIn = c.requestedIn ? hmToDate(dayStart, c.requestedIn) : null;
  const newOut = c.requestedOut ? hmToDate(dayStart, c.requestedOut) : null;

  // 상태 선점 + 기록 반영을 한 트랜잭션으로 원자화 →
  //  ① 동시 최종승인/재시도에도 status:"pending" 가드로 정확히 1회만 반영(출근레코드 이중 생성 방지)
  //  ② 반영 도중 실패 시 전체 롤백(status는 pending으로 남아 재시도 가능)
  await prisma.$transaction(async (tx) => {
    const claim = await tx.attendanceCorrection.updateMany({
      where: { id: c.id, companyId: me.companyId, status: "pending" },
      data: { status: "approved", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id },
    });
    if (claim.count !== 1) return; // 이미 다른 결재자가 확정 → 기록 반영 생략

    const existing = await tx.attendance.findFirst({
      where: { userId: c.userId, companyId: c.companyId, clockIn: { gte: dayStart, lt: dayEnd } },
      orderBy: { clockIn: "asc" },
    });
    if (existing) {
      // 기존 기록 수정: 입력된 값만 반영(안 준 값은 그대로).
      const finalIn = newIn ?? existing.clockIn;
      const finalOut = newOut ?? existing.clockOut;
      // 🔒 합쳐진 결과가 "퇴근이 출근보다 빠른" 모순 기록이 되면 반영하지 않는다(검수 M-3/3-D).
      //    예) 기존 09:00~12:00 기록에 "출근 14:00"만 정정하면 14:00 출근 / 12:00 퇴근이 된다.
      //    신청 단계 검사(출근·퇴근을 함께 낸 경우)만으로는 이 조합을 걸러낼 수 없다.
      if (finalOut && finalOut <= finalIn) {
        throw new Error("CORRECTION_TIME_INVERTED"); // 트랜잭션 전체 롤백 → 신청은 대기 상태로 남는다
      }
      await tx.attendance.update({
        where: { id: existing.id },
        data: { ...(newIn ? { clockIn: newIn } : {}), ...(newOut ? { clockOut: newOut } : {}) },
      });
      // 🔒 퇴근 시각을 채웠는데 열린 외출이 남아 있으면 함께 닫는다(검수 H-5).
      //    안 닫으면 그 외출은 "아직 안 돌아온 상태"라 실근무 계산에서 시간이 계속 늘어나
      //    그날 실근무가 조회할 때마다 줄다가 0이 된다.
      if (finalOut) {
        await tx.break.updateMany({
          where: { attendanceId: existing.id, endAt: null },
          data: { endAt: finalOut },
        });
      }
    } else if (newIn && newOut) {
      // 기록이 없던 날 = 새로 만든다.
      // 🔒 **출근·퇴근을 모두 받았을 때만** 만든다(검수 C-5).
      //    퇴근 없는 과거 기록을 만들면 그 직원은 "계속 근무 중" 상태가 되어
      //    이후 출근이 막히거나, 나중에 퇴근을 누를 때 수십 시간짜리 근무로 닫힌다.
      await tx.attendance.create({
        data: { userId: c.userId, companyId: c.companyId, clockIn: newIn, clockOut: newOut, workMode: "office" },
      });
    } else {
      // 반영할 대상이 없다(기록도 없고 출근·퇴근 둘 다 갖추지 못함) → 승인해도 바뀌는 게 없으므로
      // "승인·반영됨"이라고 잘못 표시되지 않게 아예 확정하지 않는다(검수 M-4).
      throw new Error("CORRECTION_NOTHING_TO_APPLY");
    }
  }).catch((e: unknown) => {
    // 위 두 가지 거부 사유는 예상된 상황이라 에러 화면 대신 조용히 대기 상태로 남긴다.
    //  (관리자에게는 승인 화면의 안내 문구로 이유를 알린다 — page.tsx 참고)
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CORRECTION_TIME_INVERTED" || msg === "CORRECTION_NOTHING_TO_APPLY") {
      console.warn(`[approveCorrection] 반영 거부(${msg}) correction=${c.id}`);
      return;
    }
    throw e;
  });

  revalidatePath("/corrections/approvals");
  revalidatePath("/corrections");
  revalidatePath("/records");
  revalidatePath("/approvals");
}

// 정정 반려 — 어느 단계든 반려하면 반려 확정. 회사 격리.
export async function rejectCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  if (!raw) return; // 반려 사유 필수 — 서버에서도 강제(클라이언트 우회·JS-off 폼 위조 방어)
  const comment = Array.from(raw).slice(0, 500).join(""); // 코드포인트 기준 상한(이모지 깨짐 방지)
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!c) return;
  const result = await advanceApproval(me, "correction", c.id, "reject", comment);
  if (result === "denied") return;
  await prisma.attendanceCorrection.updateMany({ where: { id: c.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), decisionComment: comment, decidedById: me.id } });
  revalidatePath("/corrections/approvals");
  revalidatePath("/corrections");
  revalidatePath("/approvals");
}
