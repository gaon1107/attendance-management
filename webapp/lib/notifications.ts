// 관리자 알림 센터(C-2) 공용 — "처리가 필요한" 항목을 한 곳에서 계산한다.
// 헤더 종 배지(NotificationBell)와 알림센터 화면(/notifications)이 같은 함수를 써서 숫자가 어긋나지 않게 한다.
// ※ 실시간 카운트(읽음 저장 없음) — 처리하면(승인·해결) 다음 조회에서 자동으로 줄어든다(대시보드와 같은 철학).
import { cache } from "react";
import { prisma } from "@/lib/db";
import { countUncheckedAnomalies } from "@/lib/anomaly";
import { listPcOffUnreported, listOfflineTempUseOveruse } from "@/lib/pcoff-alert";

/** 회사 계정 문자 재설정 경고를 알림센터에 남겨 두는 기간. */
const OWNER_RESET_ALERT_DAYS = 7;
/** 운영자가 결제를 취소(환불)한 안내를 알림센터에 남겨 두는 기간(2026-11-23 결제 6단계). */
const REFUND_ALERT_DAYS = 7;

export type AdminNotification = {
  key: string;
  title: string;
  detail: string;
  count: number;
  countLabel: string; // "3건" 처럼 표시할 라벨(건/명 등 항목마다 다름)
  href: string;
  cta: string;
  severity: "danger" | "warning" | "primary";
  capped?: boolean; // 집계가 상한에 걸려 실제보다 적을 수 있음(이상접속) → "N건+"로 표기
};

// 처리 필요 항목 + 총건수. 관리자 전용 데이터라 호출 측에서 권한을 먼저 확인한다.
// React cache()로 감싼다 → 한 요청에서 헤더 종과 알림센터 본문이 각각 불러도 실제 집계는 1회만 실행(중복 제거).
//  (요청 단위 메모이즈일 뿐 TTL 캐시가 아니므로 "실시간 카운트"는 그대로 유지 — 처리하면 다음 요청에서 즉시 반영)
export const listAdminNotifications = cache(async (companyId: string): Promise<{ items: AdminNotification[]; total: number }> => {
  // 결재/요청 대기 건수(단순 count — 처리하면 줄어든다)
  const [pendingLeave, pendingCorrection, pendingOuting, pendingRemote, pendingOvertime, pendingTrip, pendingReset] = await Promise.all([
    prisma.leaveRequest.count({ where: { companyId, status: "pending" } }),
    prisma.attendanceCorrection.count({ where: { companyId, status: "pending" } }),
    prisma.outingRequest.count({ where: { companyId, status: "pending" } }),
    prisma.remoteWorkRequest.count({ where: { companyId, status: "pending" } }),
    prisma.overtimeRequest.count({ where: { companyId, status: "pending" } }),
    prisma.businessTripRequest.count({ where: { companyId, status: "pending" } }),
    prisma.passwordResetRequest.count({ where: { companyId, status: "pending" } }),
  ]);

  // 이상 접속(보안 6단계) — 부가기능이 실패해도 알림센터 본체는 떠야 한다 → 실패 시 0으로 넘어간다.
  let anomalyCount = 0;
  let anomalyCapped = false;
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        securityCheckedAt: true,
        alertNightOn: true, alertNightStart: true, alertNightEnd: true,
        alertFailOn: true, alertFailCount: true,
      },
    });
    if (company) {
      const r = await countUncheckedAnomalies(companyId, company, company.securityCheckedAt);
      anomalyCount = r.count;
      anomalyCapped = r.capped;
    }
  } catch (e) {
    console.warn("[notifications] 이상접속 집계 실패(알림센터는 정상 표시):", e);
  }

  // PC-OFF 미보고 — 잠겼어야 하는데 잠금 기록이 안 온 PC(= 앱을 끈 PC).
  //  · 설치형 앱은 작업관리자로 끌 수 있어(지시서 §0: 워치독 범위 밖) 클라이언트 방어는 뚫린다.
  //    "기록이 안 왔다"를 서버가 알아채는 이것이 유일한 실질 방어선이다.
  //  · 이상접속과 같은 방식으로 감싼다 — 부가기능이 실패해도 알림센터 본체는 떠야 한다.
  let pcOffUnreported = 0;
  try {
    pcOffUnreported = (await listPcOffUnreported(companyId)).total;
  } catch (e) {
    console.warn("[notifications] PC-OFF 미보고 집계 실패(알림센터는 정상 표시):", e);
  }

  // 오프라인 [일시사용] 한도 초과 — 인터넷이 끊긴 동안 허용치보다 많이 쓴 기록.
  //  · 왜 알림센터에도 두나: [PC관리] 화면을 열어야만 보이면 관리자가 모른 채 지나간다(검수 M-6).
  //  · 위 미보고와 같은 방식으로 감싼다 — 부가기능이 실패해도 알림센터 본체는 떠야 한다.
  let pcOffOveruse = 0;
  try {
    pcOffOveruse = (await listOfflineTempUseOveruse(companyId)).total;
  } catch (e) {
    console.warn("[notifications] 오프라인 일시사용 초과 집계 실패(알림센터는 정상 표시):", e);
  }

  // 🔴 회사 계정 비밀번호가 **문자 인증으로** 바뀐 일(최근 7일) — 회사 계정 복구의 마지막 안전장치.
  //  · 왜: 복구 번호를 쥔 사람(예: 퇴사한 가입 담당자)이 몰래 회사 열쇠를 되찾으면 아무도 모른다.
  //    관리자들이 알림센터에서 보게 해 "우리가 한 일이 아니면" 바로 조치하게 한다(lib/owner-recovery.ts ③).
  //  · 읽음 저장이 없는 실시간 집계라 **7일이 지나면 저절로 사라진다**(처리 버튼으로 지울 수 없다 — 지우면
  //    그 사람이 지울 수도 있다).
  //  · 부가기능 — 실패해도 알림센터 본체는 뜬다.
  //  · 🔴 [검수 2026-11-21 M-1] 복구 번호가 **바뀌거나 확인된 일**도 함께 알린다. 번호 확인은 "그 폰을 가진 사람"만
  //    증명할 뿐이라, 퇴사 예정자가 자기 폰으로 확인해 두면 그 뒤로 계속 유효하다. 비밀번호를 빼앗긴 뒤가 아니라
  //    **번호가 심어지는 순간** 관리자들이 볼 수 있어야 한다.
  let ownerSmsReset = 0;
  let ownerPhoneEvents = 0;
  try {
    const owners = await prisma.user.findMany({ where: { companyId, isOwner: true }, select: { id: true } });
    if (owners.length > 0) {
      const since = new Date(Date.now() - OWNER_RESET_ALERT_DAYS * 24 * 60 * 60 * 1000);
      const base = { companyId, userId: { in: owners.map((o) => o.id) }, result: "success", createdAt: { gte: since } };
      [ownerSmsReset, ownerPhoneEvents] = await Promise.all([
        prisma.accessEvent.count({ where: { ...base, meta: "password_reset_by_sms_code" } }),
        prisma.accessEvent.count({ where: { ...base, meta: { in: ["owner_recovery_phone_change", "owner_recovery_phone_verified"] } } }),
      ]);
    }
  } catch (e) {
    console.warn("[notifications] 회사 계정 문자 재설정 집계 실패(알림센터는 정상 표시):", e);
  }

  // 자동결제 실패·멈춤(2026-11-23 결제 3단계) — 결과 안내는 **화면으로만**(사장님 결정: 문자 없음). 그래서 관리자가 매일 보는
  //  알림센터에 올린다. 멈춤 = 더는 자동으로 결제하지 않음(카드 다시 등록 필요) / 실패 = 내일 같은 시각 다시 시도.
  //  · 부가기능 — 실패해도 알림센터 본체는 뜬다.
  let autoPayPaused = false;
  let autoPayFailing = 0;
  try {
    const card = await prisma.pgBillingKey.findFirst({
      where: { companyId, status: { in: ["active", "paused"] } },
      select: { status: true, failCount: true },
    });
    if (card?.status === "paused") autoPayPaused = true;
    else if (card && card.failCount > 0) autoPayFailing = card.failCount;
  } catch (e) {
    console.warn("[notifications] 자동결제 상태 집계 실패(알림센터는 정상 표시):", e);
  }

  const autoPayItems: AdminNotification[] = [];
  if (autoPayPaused) {
    autoPayItems.push({
      key: "autopay-paused", title: "자동결제가 멈췄습니다",
      detail: "자동결제가 더 이상 진행되지 않습니다. [구독·요금]에서 멈춘 이유를 확인하고 카드를 다시 등록하거나 직접 결제해 주세요.",
      count: 1, countLabel: "확인 필요", href: "/subscription", cta: "확인", severity: "danger",
    });
  } else if (autoPayFailing > 0) {
    autoPayItems.push({
      key: "autopay-failing", title: "자동결제 실패",
      detail: "카드 결제가 승인되지 않았습니다. 다음 날 오전 10시 이후에 다시 시도하며, 3번 실패하면 자동결제가 멈춥니다. 카드 한도·유효기간을 확인해 주세요.",
      count: 1, countLabel: `${autoPayFailing}번 실패`, href: "/subscription", cta: "확인", severity: "warning",
    });
  }

  // 가온(운영자)이 결제를 취소(환불)함 — 2026-11-23 결제 6단계. 안내는 **화면으로만**(사장님 결정). 최근 7일 것만.
  //  · 부가기능 — 실패해도 알림센터 본체는 뜬다.
  try {
    const since = new Date(Date.now() - REFUND_ALERT_DAYS * 24 * 60 * 60 * 1000);
    const refunds = await prisma.pgOrder.findMany({
      where: { companyId, operatorCancelAt: { gte: since }, status: { in: ["cancel_check", "cancelled"] } },
      select: { status: true, periodRevertedAt: true },
      take: 20,
    });
    const done = refunds.filter((r) => r.status === "cancelled").length;
    const going = refunds.filter((r) => r.status === "cancel_check").length;
    // 기간을 아직 못 되돌린 취소(뒤에 다른 결제 — 운영자 확인 중)가 있으면 "되돌아갔습니다"라고 말하지 않는다(검수 경미 2).
    const notReverted = refunds.some((r) => r.status === "cancelled" && !r.periodRevertedAt);
    if (done + going > 0) {
      autoPayItems.push({
        key: "payment-refunded",
        title: going > 0 ? "결제 취소(환불) 진행 중" : "결제가 취소(환불)되었습니다",
        detail: going > 0
          ? "가온 고객센터에서 결제 취소를 요청했습니다. 카드사 처리가 끝나면 취소로 바뀌고, 그 결제로 늘어났던 이용 기간이 되돌아갑니다."
          : notReverted
            ? "가온 고객센터에서 결제를 취소(환불)했습니다. 이용 기간은 고객센터에서 확인해 안내해 드립니다. [구독·요금]에서 결제 내역을 확인해 주세요."
            : "가온 고객센터에서 결제를 취소(환불)했습니다. 그 결제로 늘어났던 이용 기간이 되돌아갔습니다. [구독·요금]에서 이용 기간을 확인해 주세요.",
        count: done + going, countLabel: `${done + going}건`, href: "/subscription", cta: "확인", severity: "primary",
      });
    }
  } catch (e) {
    console.warn("[notifications] 결제 취소 안내 집계 실패(알림센터는 정상 표시):", e);
  }

  const items: AdminNotification[] = [];
  // 보안이 가장 위(위험). 그다음 자동결제(서비스가 끊길 수 있음), 그다음 결재/요청.
  if (ownerSmsReset > 0) {
    items.push({
      key: "owner-sms-reset", title: "회사 계정 비밀번호 변경(문자 인증)",
      detail: `최근 ${OWNER_RESET_ALERT_DAYS}일 안에 회사 계정의 비밀번호가 문자 인증으로 바뀌었습니다. 회사에서 한 일이 아니라면 즉시 확인하세요.`,
      count: ownerSmsReset, countLabel: `${ownerSmsReset}건`,
      href: "/security/access", cta: "기록 보기", severity: "danger",
    });
  }
  if (ownerPhoneEvents > 0) {
    items.push({
      key: "owner-phone", title: "회사 계정 복구용 연락처 변경·확인",
      detail: `최근 ${OWNER_RESET_ALERT_DAYS}일 안에 회사 계정의 복구용 휴대폰 번호가 바뀌었거나 확인되었습니다. 이 번호를 가진 사람은 회사 계정 비밀번호를 되찾을 수 있습니다. 회사에서 한 일인지 확인하세요.`,
      count: ownerPhoneEvents, countLabel: `${ownerPhoneEvents}건`,
      href: "/security/access", cta: "기록 보기", severity: "warning",
    });
  }
  if (anomalyCount > 0) {
    items.push({
      key: "anomaly", title: "이상 접속", detail: "로그인 이상 징후를 확인하세요.",
      count: anomalyCount, countLabel: `${anomalyCount}건${anomalyCapped ? "+" : ""}`,
      href: "/security/alerts", cta: "확인", severity: "danger", capped: anomalyCapped,
    });
  }
  if (pendingReset > 0) {
    items.push({
      key: "reset", title: "비밀번호 재설정 요청", detail: "직원의 비밀번호 재설정 요청이 있습니다.",
      count: pendingReset, countLabel: `${pendingReset}건`, href: "/employees", cta: "처리", severity: "danger",
    });
  }
  items.push(...autoPayItems);
  if (pcOffUnreported > 0) {
    items.push({
      key: "pcoff-unreported", title: "PC-OFF 미보고",
      detail: "퇴근 시간이 지났는데 잠금 기록을 보내지 않은 PC가 있습니다. 프로그램이 꺼져 있을 수 있습니다.",
      count: pcOffUnreported, countLabel: `${pcOffUnreported}대`,
      href: "/pc-devices", cta: "확인", severity: "warning",
    });
  }
  if (pcOffOveruse > 0) {
    items.push({
      key: "pcoff-overuse", title: "오프라인 일시사용 초과",
      detail: "인터넷이 끊긴 동안 [일시사용]을 허용 횟수보다 많이 쓴 기록이 있습니다. 설정을 줄였거나 PC를 교체한 경우일 수도 있습니다.",
      count: pcOffOveruse, countLabel: `${pcOffOveruse}건`,
      href: "/pc-devices", cta: "확인", severity: "warning",
    });
  }
  if (pendingLeave > 0) {
    items.push({
      key: "leave", title: "휴가 신청 대기", detail: "승인/반려를 기다리는 휴가 신청이 있습니다.",
      count: pendingLeave, countLabel: `${pendingLeave}건`, href: "/leave/approvals", cta: "검토", severity: "primary",
    });
  }
  if (pendingCorrection > 0) {
    items.push({
      key: "correction", title: "근태 정정 요청", detail: "승인/반려를 기다리는 근태 정정 요청이 있습니다.",
      count: pendingCorrection, countLabel: `${pendingCorrection}건`, href: "/corrections/approvals", cta: "검토", severity: "primary",
    });
  }
  if (pendingOuting > 0) {
    items.push({
      key: "outing", title: "외출/외근 신청 대기", detail: "승인/반려를 기다리는 외출/외근 신청이 있습니다.",
      count: pendingOuting, countLabel: `${pendingOuting}건`, href: "/outing/approvals", cta: "검토", severity: "primary",
    });
  }
  if (pendingRemote > 0) {
    items.push({
      key: "remote", title: "재택근무 신청 대기", detail: "승인/반려를 기다리는 재택근무 신청이 있습니다.",
      count: pendingRemote, countLabel: `${pendingRemote}건`, href: "/remote/approvals", cta: "검토", severity: "primary",
    });
  }
  if (pendingOvertime > 0) {
    items.push({
      key: "overtime", title: "초과근무 신청 대기", detail: "승인/반려를 기다리는 초과근무(야근) 사전신청이 있습니다.",
      count: pendingOvertime, countLabel: `${pendingOvertime}건`, href: "/overtime/approvals", cta: "검토", severity: "primary",
    });
  }
  if (pendingTrip > 0) {
    items.push({
      key: "trip", title: "출장 신청 대기", detail: "승인/반려를 기다리는 출장 신청이 있습니다.",
      count: pendingTrip, countLabel: `${pendingTrip}건`, href: "/trip/approvals", cta: "검토", severity: "primary",
    });
  }

  const total = items.reduce((s, it) => s + it.count, 0);
  return { items, total };
});
