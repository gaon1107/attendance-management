// 관리자 알림 센터(C-2) 공용 — "처리가 필요한" 항목을 한 곳에서 계산한다.
// 헤더 종 배지(NotificationBell)와 알림센터 화면(/notifications)이 같은 함수를 써서 숫자가 어긋나지 않게 한다.
// ※ 실시간 카운트(읽음 저장 없음) — 처리하면(승인·해결) 다음 조회에서 자동으로 줄어든다(대시보드와 같은 철학).
import { cache } from "react";
import { prisma } from "@/lib/db";
import { countUncheckedAnomalies } from "@/lib/anomaly";

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

  const items: AdminNotification[] = [];
  // 보안이 가장 위(위험). 그다음 결재/요청.
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
