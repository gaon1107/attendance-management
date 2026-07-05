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
