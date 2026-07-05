"use server";
// 회사 사업장 위치 설정 — 관리자만. 사무실 출근 GPS 확인의 기준점.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

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
