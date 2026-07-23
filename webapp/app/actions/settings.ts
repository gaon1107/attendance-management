"use server";
// 회사 사업장 위치 설정 — 관리자만. 사무실 출근 GPS 확인의 기준점.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseDays, daysToCsv } from "@/lib/workdays";
import { stripCommas } from "@/lib/format";
import { normalizeOutingReasons, formatOutingReasons, MAX_REASON_LEN, MAX_OUTING_REASONS } from "@/lib/outing-reasons";

// 외출 사유 저장 결과 — saved(정규화되어 실제 저장된 문자열)로 화면 입력칸을 DB와 맞춘다.
export type OutingReasonsResult = { error?: string; ok?: boolean; warn?: string; saved?: string };
import { logAdminAction } from "@/lib/audit";

export async function saveOfficeLocation(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  // 반경칸은 천단위 콤마(글자칸)로 입력받으므로 콤마를 떼고 숫자로 파싱한다.
  const radius = Number(stripCommas(String(formData.get("radius") ?? "")));
  // 사업장 주소(선택) — 빈 값이면 null. 길이 상한 적용.
  const addrRaw = String(formData.get("officeAddress") ?? "").trim();
  const addrDetailRaw = String(formData.get("officeAddressDetail") ?? "").trim();
  const officeAddress = addrRaw ? addrRaw.slice(0, 300) : null;
  const officeAddressDetail = addrDetailRaw ? addrDetailRaw.slice(0, 300) : null;

  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: "위도·경도를 올바르게 입력해주세요." };
  }
  if (Number.isNaN(radius) || radius < 20 || radius > 5000) {
    return { error: "허용 반경은 20~5000m 사이로 입력해주세요." };
  }

  await prisma.company.update({
    where: { id: me.companyId },
    data: { officeLat: lat, officeLng: lng, officeRadiusM: Math.round(radius), officeAddress, officeAddressDetail },
  });

  await logAdminAction(me, "config", "office_location"); // 감사로그(성공 시에만)
  revalidatePath("/settings");
  return { ok: true };
}

// 사내 네트워크(허용 IP) 저장 — 관리자만. 쉼표로 여러 개, 빈 값이면 사용 안 함.
export async function saveOfficeNetwork(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const raw = String(formData.get("ips") ?? "").trim();
  // 간단 검증: 각 항목이 숫자·점·콜론(IPv6)만으로 되어 있는지
  if (raw) {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const ok = items.every((s) => /^[0-9a-fA-F.:]+$/.test(s));
    if (!ok) {
      return { error: "IP는 숫자·점(.)·콜론(:)만 사용할 수 있어요. 쉼표로 구분해주세요." };
    }
  }

  await prisma.company.update({
    where: { id: me.companyId },
    data: { officeIps: raw || null },
  });

  await logAdminAction(me, "config", "office_network"); // 감사로그 — 보안 핵심(허용 IP를 몰래 넓히는 것 추적)
  revalidatePath("/settings");
  return { ok: true };
}

// 외출 사유 목록 저장(B-6) — 관리자만. 직원 [출퇴근] 화면의 외출 사유 드롭다운을 회사가 편집한다.
//  · 비우면 null 저장 → 기본 4종으로 폴백(설정 안 한 회사와 동일 상태로 되돌리기).
//  · 정리·상한 규칙은 lib/outing-reasons.ts 단일 출처를 그대로 사용한다.
export async function saveOutingReasons(
  _prev: OutingReasonsResult,
  formData: FormData
): Promise<OutingReasonsResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const raw = String(formData.get("reasons") ?? "").trim();
  const list = normalizeOutingReasons(raw);

  // 뭔가 입력했는데 한 개도 안 남았다 = 전부 공백이거나 전부 글자수 초과 → 조용히 기본값으로 되돌리지 않고 알린다.
  if (raw && list.length === 0) {
    return { error: `사유는 1~${MAX_REASON_LEN}글자로 입력해주세요. (쉼표로 구분)` };
  }

  // 입력한 항목 수와 실제 저장될 수가 다르면(중복·길이초과·개수초과로 제외) 성공이라고만 하지 않고 알린다 — 조용한 누락 방지.
  const entered = raw.split(",").map((s) => s.trim()).filter(Boolean).length;
  const dropped = entered - list.length;

  const saved = list.length > 0 ? formatOutingReasons(list) : null;
  await prisma.company.update({
    where: { id: me.companyId },
    data: { outingReasons: saved },
  });

  // 감사로그 — 사유 목록은 근태 이력에 남는 라벨이라 "언제 누가 바꿨는지" 추적이 필요하다(다른 설정 액션과 동일).
  await logAdminAction(me, "config", "outing_reasons");
  revalidatePath("/settings");
  revalidatePath("/attendance"); // 직원 출퇴근 화면의 드롭다운에 즉시 반영
  return {
    ok: true,
    saved: saved ?? "",
    ...(dropped > 0
      ? { warn: `중복이거나 ${MAX_REASON_LEN}글자를 넘거나 ${MAX_OUTING_REASONS}개를 초과한 ${dropped}개 항목은 저장되지 않았습니다.` }
      : {}),
  };
}

// 얼굴 인식 기준 크기 저장 — 관리자만. 얼굴 폭이 화면 폭의 몇 % 이상이어야 통과되는지.
export async function saveFaceRule(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const percent = Number(formData.get("faceMinPercent"));
  // 상한 50: 가이드 타원(최대 70%)과 모순되지 않는 범위 — 그 이상은 물리적으로 통과가 어려워짐
  if (!Number.isFinite(percent) || percent < 10 || percent > 50) {
    return { error: "기준 크기는 10~50% 사이로 입력해주세요." };
  }

  // 밝기 게이트(얼굴 영역 평균 밝기 0~255, 0=꺼짐). 이보다 어두우면 위조 판독을 보류한다.
  const brightness = Number(formData.get("faceMinBrightness"));
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 255) {
    return { error: "밝기 기준은 0~255 사이로 입력해주세요. (0=꺼짐)" };
  }

  await prisma.company.update({
    where: { id: me.companyId },
    data: { faceMinPercent: Math.round(percent), faceMinBrightness: Math.round(brightness) },
  });

  await logAdminAction(me, "config", "face_rule"); // 감사로그(성공 시에만)
  revalidatePath("/settings");
  revalidatePath("/attendance");
  revalidatePath("/face-enroll");
  return { ok: true };
}

// 본인 확인 재검토 기준(판독 기준값) 저장 — 관리자만. 판독 "진짜 확률"이 이 값 미만이면 재검토 배지.
export async function saveLivenessRule(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const percent = Number(formData.get("livenessPercent"));
  // 이 값은 "모델 B(핵심 판별자) 기준(%)"이다. 진짜 얼굴 93%+/위조 60%- 사이 안전지대 안에서만 허용:
  // 70 미만은 위조를 놓치고, 95 초과는 진짜 얼굴도 배지 남발. (모델 A 기준 60%는 코드 고정값)
  if (!Number.isFinite(percent) || percent < 70 || percent > 95) {
    return { error: "재검토 기준은 70~95% 사이로 입력해주세요." };
  }

  await prisma.company.update({
    where: { id: me.companyId },
    data: { livenessPercent: Math.round(percent) },
  });

  await logAdminAction(me, "config", "liveness_rule"); // 감사로그(성공 시에만)
  revalidatePath("/settings");
  return { ok: true };
}

// 근무제·기준시간 저장 — 관리자만. 지각/정상 판정의 기준(표준 출퇴근 시각 + 지각 유예).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM" 24시간

export async function saveWorkRules(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const start = String(formData.get("workStartTime") ?? "").trim();
  const end = String(formData.get("workEndTime") ?? "").trim();
  const graceRaw = String(formData.get("lateGraceMin") ?? "").trim();

  // 빈 값이면 "미설정"으로 저장(지각 판정 건너뜀). 값이 있으면 형식 검증.
  if (start && !TIME_RE.test(start)) return { error: "출근 기준시각을 HH:MM 형식으로 입력해주세요. (예: 09:00)" };
  if (end && !TIME_RE.test(end)) return { error: "퇴근 기준시각을 HH:MM 형식으로 입력해주세요. (예: 18:00)" };

  const grace = graceRaw === "" ? 0 : Number(graceRaw);
  if (Number.isNaN(grace) || grace < 0 || grace > 120) {
    return { error: "지각 유예는 0~120분 사이로 입력해주세요." };
  }

  // 기준 일 근무시간(초과근무 판정 기준). 1~24시간, 0.5 단위 허용.
  const stdRaw = String(formData.get("standardWorkHours") ?? "").trim();
  const std = stdRaw === "" ? 8 : Number(stdRaw);
  if (Number.isNaN(std) || std < 1 || std > 24) {
    return { error: "기준 일 근무시간은 1~24시간 사이로 입력해주세요." };
  }

  // 근무요일(CSV) — 0~6만 허용. 정규화해서 저장(월요일부터 정렬).
  const workDays = daysToCsv(parseDays(String(formData.get("workDays") ?? "")));

  // 주 52시간 초과근무 알림(B-3). 체크박스는 체크됐을 때만 값이 온다(안 오면 꺼짐).
  const overtimeAlertOn = formData.get("overtimeAlertOn") !== null;
  // 근접 경고선(주간 시간). 30~52시간. 52 법정 상한 이하여야 "근접" 구간이 의미 있음.
  const warnRaw = String(formData.get("overtimeWarnHours") ?? "").trim();
  let overtimeWarnHours = warnRaw === "" ? 48 : Number(warnRaw);
  if (Number.isNaN(overtimeWarnHours)) overtimeWarnHours = 48;
  if (overtimeAlertOn) {
    // 켜져 있을 때만 엄격히 검증(사용자가 직접 보는 값).
    if (overtimeWarnHours < 30 || overtimeWarnHours > 52) {
      return { error: "주간 초과근무 경고선은 30~52시간 사이로 입력해주세요." };
    }
  } else {
    // 꺼져 있으면 값 때문에 저장이 막히지 않게 안전 범위로 맞춰 저장(다시 켤 때 정상값 보장).
    overtimeWarnHours = Math.min(52, Math.max(30, overtimeWarnHours));
  }

  // ── 교대근무(시프트) 정의 ── shiftMode=null이면 교대 안 함(= 현행 동작). 값이 있으면 조별 시각 검증.
  const shiftModeRaw = String(formData.get("shiftMode") ?? "").trim();
  const shiftMode = shiftModeRaw === "2" ? 2 : shiftModeRaw === "3" ? 3 : null;
  const scheduleType = shiftMode ? (String(formData.get("scheduleType") ?? "") === "rotation" ? "rotation" : "fixed") : null;
  const parsedShifts: { order: number; name: string | null; startTime: string; endTime: string }[] = [];
  if (shiftMode) {
    for (let i = 1; i <= shiftMode; i++) {
      const s = String(formData.get(`shift${i}Start`) ?? "").trim();
      const e = String(formData.get(`shift${i}End`) ?? "").trim();
      const nm = String(formData.get(`shift${i}Name`) ?? "").trim();
      if (!TIME_RE.test(s) || !TIME_RE.test(e)) return { error: `${i}교대 출근·퇴근 시각을 HH:MM 형식으로 모두 입력해주세요.` };
      parsedShifts.push({ order: i, name: nm || null, startTime: s, endTime: e });
    }
  }

  // 근무제 저장 + 교대 정의 + 순환 그룹 재조정을 "한 트랜잭션"으로 원자화한다.
  //  이렇게 묶지 않으면, shiftMode만 먼저 커밋되고 뒤 정리가 실패할 때 그룹·orderCsv가 옛 상태로 남아
  //  (loadShiftContext가 옛 순환주기를 읽어) 근무일이 조용히 휴무로 뒤집히는 불일치가 생긴다.
  //  ShiftGroup.order는 0-based(0,1,2=A,B,C)라 유효 조는 0..shiftMode-1 → 초과 = order>=shiftMode.
  //  (A안: 방식과 무관하게 shiftMode 기준. 순환→고정으로만 바꾸고 교대수가 같으면 조·배정은 보존.)
  const keepGroups = shiftMode ?? 0; // 유지할 순환 조 개수(교대 끄면 0=전부 정리)
  try {
    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: me.companyId },
        data: {
          workStartTime: start || null,
          workEndTime: end || null,
          lateGraceMin: Math.round(grace),
          standardWorkHours: std,
          overtimeAlertOn,
          overtimeWarnHours,
          workDays,
          shiftMode,
          scheduleType,
        },
      });

      // 조 정의 반영 — order 기준 upsert로 id를 유지(삭제·재생성 아님 → 이후 배정·예외가 안 끊긴다).
      if (shiftMode) {
        for (const sh of parsedShifts) {
          await tx.shift.upsert({
            where: { companyId_order: { companyId: me.companyId, order: sh.order } },
            update: { name: sh.name, startTime: sh.startTime, endTime: sh.endTime },
            create: { companyId: me.companyId, ...sh },
          });
        }
        // 교대 수가 줄었으면(3→2) 초과 조(Shift) 정리.
        //  ※ 완전 OFF(shiftMode=null) 시 Shift 행은 의도적으로 남긴다 — loadShiftContext가 shiftMode=null이면
        //    조기 반환해 읽지 않으므로 무해하고, 재활성화 시 위 upsert/deleteMany가 다시 정돈한다.
        //  ── fixed 측 dangling 정리(순환 ShiftGroup 정리와 동일 철학) ──
        //  ShiftPattern.shiftId(고정 요일패턴)·ShiftAssignment.shiftId(날짜 예외)는 schema상 Shift로의 FK가 없어
        //  삭제된 Shift id를 가리키는 참조가 남는다(크래시는 없지만 정합성이 비대칭). 참조를 먼저 휴무(null)로
        //  끊은 뒤 삭제한다 — order를 저장하지 않으므로 삭제 대상 id를 먼저 조회해야 한다. companyId 스코프 유지.
        const staleShifts = await tx.shift.findMany({
          where: { companyId: me.companyId, order: { gt: shiftMode } },
          select: { id: true },
        });
        if (staleShifts.length) {
          const staleIds = staleShifts.map((s) => s.id);
          await tx.shiftPattern.updateMany({
            where: { companyId: me.companyId, shiftId: { in: staleIds } },
            data: { shiftId: null },
          });
          await tx.shiftAssignment.updateMany({
            where: { companyId: me.companyId, shiftId: { in: staleIds } },
            data: { shiftId: null },
          });
          await tx.shift.deleteMany({ where: { id: { in: staleIds } } });
        }
      }

      // ── 순환용 조(ShiftGroup)·순환규칙(orderCsv) 재조정 ──
      //  교대 수가 줄거나(3→2) 교대를 완전히 끄면(shiftMode=null), 순환 조·배정·orderCsv가 어긋난다.
      //  → shift.ts saveRotation과 동일 패턴: 참조 직원 해제(FK 안전) → 조 삭제 → orderCsv 갱신.
      const excess = await tx.shiftGroup.findMany({
        where: { companyId: me.companyId, order: { gte: keepGroups } },
        select: { id: true },
      });
      if (excess.length) {
        const ids = excess.map((e) => e.id);
        await tx.user.updateMany({ where: { companyId: me.companyId, shiftGroupId: { in: ids } }, data: { shiftGroupId: null } });
        await tx.shiftGroup.deleteMany({ where: { id: { in: ids } } });
      }
      // 순환규칙이 있으면 orderCsv를 현재 교대수에 맞춘다(행 없으면 no-op — 생성은 saveRotation 몫).
      //  shiftMode 없을 때는 갱신하지 않음: OFF 상태에선 loadShiftContext가 orderCsv를 읽지 않고(휴면),
      //  재활성화 시 saveRotation이 다시 기록한다.
      if (shiftMode) {
        const orderCsv = Array.from({ length: shiftMode }, (_, i) => i + 1).join(","); // "1,2[,3]"
        await tx.rotationRule.updateMany({ where: { companyId: me.companyId }, data: { orderCsv } });
      }
    });
  } catch (e) {
    console.error("saveWorkRules 저장 실패:", e); // 단일 트랜잭션이라 부분커밋 없음 — 원인 추적용 로깅
    return { error: "근무제 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }

  await logAdminAction(me, "config", "work_rules"); // 감사로그(성공 시에만)
  revalidatePath("/settings");
  revalidatePath("/dashboard"); // 알림 켜기·경고선이 바뀌면 대시보드 알림도 바뀐다
  return { ok: true };
}

// 이상접속 감지 기준 저장 — 관리자만 (접속/보안 6단계).
// ※ [차단 IP 재시도]는 여기 없다 — 관리자가 직접 막은 IP라 오탐이 0이고, 끌 이유가 없다.
export async function saveAlertRules(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  // 체크박스는 체크됐을 때만 값이 온다(안 오면 꺼짐).
  const nightOn = formData.get("alertNightOn") !== null;
  const failOn = formData.get("alertFailOn") !== null;

  // ⚠️ 필드가 통째로 없으면 Number(null) = 0이라 검증을 그냥 통과한다(0시로 저장됨).
  //    폼이 바뀌거나 요청이 조작되면 조용히 엉뚱한 값이 저장되므로 "없음"을 먼저 막는다.
  const rawStart = formData.get("alertNightStart");
  const rawEnd = formData.get("alertNightEnd");
  const rawFail = formData.get("alertFailCount");
  if (rawStart === null || rawEnd === null || rawFail === null) {
    return { error: "입력값이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해주세요." };
  }

  const nightStart = Number(rawStart);
  const nightEnd = Number(rawEnd);
  if (!Number.isInteger(nightStart) || nightStart < 0 || nightStart > 23) {
    return { error: "심야 시작 시각은 0~23 사이로 입력해주세요." };
  }
  if (!Number.isInteger(nightEnd) || nightEnd < 0 || nightEnd > 23) {
    return { error: "심야 끝 시각은 0~23 사이로 입력해주세요." };
  }
  // 시작 = 끝이면 하루 24시간이 전부 심야가 되어 로그인마다 알림이 터진다. 저장 자체를 막는다.
  if (nightOn && nightStart === nightEnd) {
    return { error: "심야 시작과 끝이 같으면 하루 종일이 심야가 됩니다. 다르게 정해주세요." };
  }

  const failCount = Number(rawFail);
  // 하한 3: 1~2회는 오타로도 나와 알림이 무의미해진다. 상한 50: 그 이상이면 사실상 꺼둔 것과 같다.
  if (!Number.isInteger(failCount) || failCount < 3 || failCount > 50) {
    return { error: "로그인 실패 기준은 3~50회 사이로 입력해주세요." };
  }

  await prisma.company.update({
    where: { id: me.companyId },
    data: {
      alertNightOn: nightOn,
      alertNightStart: nightStart,
      alertNightEnd: nightEnd,
      alertFailOn: failOn,
      alertFailCount: failCount,
    },
  });

  await logAdminAction(me, "config", "alert_rules"); // 감사로그(성공 시에만)
  revalidatePath("/settings");
  revalidatePath("/security/alerts"); // 기준이 바뀌면 판정이 바뀐다
  revalidatePath("/dashboard"); // 배지 숫자도 바뀐다
  return { ok: true };
}
