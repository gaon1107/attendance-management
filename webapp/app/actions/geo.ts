"use server";
// 주소 → 좌표 변환(지오코딩) 서버 액션 — 회사 위치 설정에서 사용. 관리자만.
import { getCurrentUser } from "@/lib/session";
import { geocodeAddress } from "@/lib/geocode";

export async function geocodeForOffice(address: string): Promise<{ lat: number; lng: number } | null> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return null;

  const clean = String(address ?? "").trim().slice(0, 300);
  if (!clean) return null;

  const r = await geocodeAddress(clean);
  return r ? { lat: r.lat, lng: r.lng } : null;
}
