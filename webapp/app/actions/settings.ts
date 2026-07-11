"use server";
// 회사 사업장 위치 설정 — 관리자만. 사무실 출근 GPS 확인의 기준점.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseDays, daysToCsv } from "@/lib/workdays";

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
  const radius = Number(formData.get("radius"));

  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: "위도·경도를 올바르게 입력해주세요." };
  }
  if (Number.isNaN(radius) || radius < 20 || radius > 5000) {
    return { error: "허용 반경은 20~5000m 사이로 입력해주세요." };
  }

  await prisma.company.update({
    where: { id: me.companyId },
    data: { officeLat: lat, officeLng: lng, officeRadiusM: Math.round(radius) },
  });

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

  await prisma.company.update({
    where: { id: me.companyId },
    data: { faceMinPercent: Math.round(percent) },
  });

  revalidatePath("/settings");
  revalidatePath("/attendance");
  revalidatePath("/face-enroll");
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

  revalidatePath("/settings");
  return { ok: true };
}
