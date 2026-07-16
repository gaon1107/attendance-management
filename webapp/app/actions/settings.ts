"use server";
// 회사 사업장 위치 설정 — 관리자만. 사무실 출근 GPS 확인의 기준점.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseDays, daysToCsv } from "@/lib/workdays";
import { stripCommas } from "@/lib/format";
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

  await prisma.company.update({
    where: { id: me.companyId },
    data: {
      workStartTime: start || null,
      workEndTime: end || null,
      lateGraceMin: Math.round(grace),
      standardWorkHours: std,
      workDays,
    },
  });

  await logAdminAction(me, "config", "work_rules"); // 감사로그(성공 시에만)
  revalidatePath("/settings");
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

  const nightStart = Number(formData.get("alertNightStart"));
  const nightEnd = Number(formData.get("alertNightEnd"));
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

  const failCount = Number(formData.get("alertFailCount"));
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
