"use server";
// PC-OFF 설정·기기 관리(웹 화면용 서버 액션).
//  · 설정 저장 패턴은 app/actions/settings.ts를 그대로 따른다(관리자 가드 → 검증 → 저장 → 감사로그 → revalidate).
//  · ⚠️ settings.ts는 수정하지 않는다(사규 2조). PC-OFF 관련 액션만 이 새 파일에 모은다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAdminAction } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { generatePairCode, PAIR_CODE_TTL_MIN } from "@/lib/agent-auth";
import {
  parseNotifyMins, formatNotifyMins, MAX_NOTIFY_MINS, PCOFF_LIMITS,
  normalizeTempReasons, formatTempReasons, MAX_TEMP_REASONS, MAX_TEMP_REASON_LEN,
} from "@/lib/pcoff";

export type PcOffSettingsResult = {
  error?: string; ok?: boolean; warn?: string; savedNotify?: string; savedReasons?: string;
};

// ── 회사 PC-OFF 설정 저장(관리자만) ─────────────────────────────────────
export async function savePcOffSettings(
  _prev: PcOffSettingsResult,
  formData: FormData
): Promise<PcOffSettingsResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  // 체크박스는 체크됐을 때만 값이 온다(안 오면 꺼짐) — 기존 설정 폼들과 같은 방식.
  const pcOffOn = formData.get("pcOffOn") !== null;

  // 1차 범위는 잠금(lock)만 구현했다. 모르는 값이 오면 조용히 통과시키지 않고 거부한다(폼 위조 방어).
  const mode = String(formData.get("pcOffMode") ?? "lock");
  if (mode !== "lock") return { error: "지금은 '화면 잠금'만 지원합니다." };

  const delay = num(formData.get("pcOffDelayMin"), 10);
  if (!inRange(delay, PCOFF_LIMITS.delayMin)) {
    return { error: `퇴근 후 유예는 ${PCOFF_LIMITS.delayMin.min}~${PCOFF_LIMITS.delayMin.max}분 사이로 입력해주세요.` };
  }

  const tempUseMin = num(formData.get("pcOffTempUseMin"), 30);
  if (!inRange(tempUseMin, PCOFF_LIMITS.tempUseMin)) {
    return { error: `일시사용 시간은 ${PCOFF_LIMITS.tempUseMin.min}~${PCOFF_LIMITS.tempUseMin.max}분 사이로 입력해주세요.` };
  }

  const perDay = num(formData.get("pcOffTempUsePerDay"), 2);
  if (!inRange(perDay, PCOFF_LIMITS.tempUsePerDay)) {
    return { error: `일시사용 횟수는 하루 ${PCOFF_LIMITS.tempUsePerDay.min}~${PCOFF_LIMITS.tempUsePerDay.max}회 사이로 입력해주세요.` };
  }

  // 일시사용 사유 목록 — 직원은 이 목록에서만 고른다(자유입력 없음). 외출 사유 설정과 같은 정리 규칙.
  //  · ⚠️ 필수로 요구하는 건 "PC-OFF를 켜고 + 일시사용을 쓰는" 회사뿐이다.
  //    무조건 요구하면 일시사용을 안 쓰는 회사는 물론 **PC-OFF를 끄려는 저장까지 막힌다**.
  const reasonsRaw = String(formData.get("pcOffTempReasons") ?? "").trim();
  const reasons = normalizeTempReasons(reasonsRaw);
  const enteredReasons = reasonsRaw ? reasonsRaw.split(",").filter((s) => s.trim()).length : 0;
  if (reasons.length === 0 && pcOffOn && perDay > 0) {
    return { error: `일시사용 사유는 최소 1개가 필요합니다. (한 사유당 ${MAX_TEMP_REASON_LEN}자 이내, 쉼표로 구분)` };
  }

  // 알림 시점("10,5") — 정리 규칙은 정책 조립부와 **같은 함수**를 쓴다(화면·앱이 어긋나지 않게).
  const notifyRaw = String(formData.get("pcOffNotifyMins") ?? "").trim();
  const notify = parseNotifyMins(notifyRaw);
  const enteredCount = notifyRaw ? notifyRaw.split(",").filter((s) => s.trim()).length : 0;
  if (notifyRaw && notify.length === 0) {
    return { error: "알림 시점은 1~240 사이의 분 단위 숫자로 입력해주세요. (예: 10,5)" };
  }
  // 켜는데 퇴근 기준시각이 없으면 잠글 기준선이 없다 — 저장은 하되 "동작하지 않는다"고 분명히 알린다.
  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workEndTime: true },
  });

  const saved = formatNotifyMins(notify);
  const savedReasons = formatTempReasons(reasons);
  await prisma.company.update({
    where: { id: me.companyId },
    data: {
      pcOffOn,
      pcOffMode: mode,
      pcOffDelayMin: Math.round(delay),
      pcOffNotifyMins: saved,
      pcOffTempUseMin: Math.round(tempUseMin),
      pcOffTempUsePerDay: Math.round(perDay),
      pcOffTempReasons: savedReasons,
    },
  });

  await logAdminAction(me, "config", "pcoff_rule");
  revalidatePath("/settings");
  revalidatePath("/pc-devices");

  const dropped = enteredCount - notify.length;
  const droppedReasons = enteredReasons - reasons.length;
  return {
    ok: true,
    savedNotify: saved,
    savedReasons,
    ...(pcOffOn && !company?.workEndTime
      ? { warn: "퇴근 기준시각이 설정되지 않아 아직 잠기지 않습니다. [근무제] 카드에서 퇴근 시각을 먼저 정해주세요." }
      : dropped > 0
        ? { warn: `중복이거나 1~240 범위를 벗어나거나 ${MAX_NOTIFY_MINS}개를 초과한 ${dropped}개 항목은 저장되지 않았습니다.` }
        : droppedReasons > 0
          ? { warn: `중복이거나 ${MAX_TEMP_REASON_LEN}자를 넘거나 ${MAX_TEMP_REASONS}개를 초과한 사유 ${droppedReasons}개는 저장되지 않았습니다.` }
          : {}),
  };
}

// ── 직원별 예외자 지정(관리자만) ────────────────────────────────────────
export async function setPcOffExempt(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const userId = String(formData.get("userId") ?? "");
  const exempt = String(formData.get("exempt") ?? "") === "1";
  if (!userId) return;

  // 회사 격리 — 내 회사 직원만.
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId }, select: { id: true } });
  if (!target) return;

  await prisma.user.update({ where: { id: target.id }, data: { pcOffExempt: exempt } });
  await logAdminAction(me, "config", "pcoff_exempt");
  revalidatePath("/pc-devices");
}

// ── 연결코드 발급(본인) ────────────────────────────────────────────────
// 직원이 [계정] 화면에서 누른다. 관리자도 자기 PC를 연결할 수 있다.
export type PairCodeResult = { error?: string; code?: string; expiresAt?: string };

export async function issuePairCode(): Promise<PairCodeResult> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  // 이전에 발급한 안 쓴 코드는 무효화한다 — 동시에 여러 개가 살아있지 않게(추측 대상 축소).
  await prisma.agentPairCode.updateMany({
    where: { userId: me.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  // 다 쓴·만료된 옛 코드는 정리한다(행이 무한정 쌓이지 않게). 최근 1일 것만 남긴다.
  await prisma.agentPairCode.deleteMany({
    where: { userId: me.id, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });

  // 아주 낮은 확률이지만 지금 살아있는 코드와 겹칠 수 있어 몇 번 다시 뽑는다.
  let code = generatePairCode();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.agentPairCode.findFirst({
      where: { code, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!clash) break;
    code = generatePairCode();
  }

  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MIN * 60 * 1000);
  await prisma.agentPairCode.create({ data: { userId: me.id, code, expiresAt } });

  revalidatePath("/account");
  return { code, expiresAt: expiresAt.toISOString() };
}

// ── 기기 연결 해제 ────────────────────────────────────────────────────
// 관리자는 회사의 모든 기기를, 직원은 자기 기기만 해제할 수 있다. 해제하면 그 토큰은 즉시 무효(401).
export async function revokeAgentDevice(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const deviceId = String(formData.get("deviceId") ?? "");
  if (!deviceId) return;

  const device = await prisma.agentDevice.findFirst({
    where: {
      id: deviceId,
      companyId: me.companyId,                                  // 회사 격리
      ...(me.role === "admin" ? {} : { userId: me.id }),        // 직원은 본인 기기만
    },
    select: { id: true, revokedAt: true },
  });
  if (!device || device.revokedAt) return; // 없거나 이미 해제됨 → 아무 것도 하지 않음

  await prisma.agentDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
  if (me.role === "admin") await logAdminAction(me, "config", "pcoff_device_revoke");

  revalidatePath("/pc-devices");
  revalidatePath("/account");
}

function num(v: FormDataEntryValue | null, fallback: number): number {
  const s = String(v ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function inRange(n: number, r: { min: number; max: number }): boolean {
  return Number.isFinite(n) && n >= r.min && n <= r.max;
}
