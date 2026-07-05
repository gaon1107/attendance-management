// 위치(GPS) 확인 도구.
// 프라이버시 원칙: 원본 좌표는 저장하지 않고, "확인됨/벗어남" 결과만 남긴다.

// 두 좌표 사이 거리(미터). 하버사인 공식.
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // 지구 반지름(m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

type OfficeGeofence = { officeLat: number | null; officeLng: number | null; officeRadiusM: number };

// 사무실 출근 위치 판정. 좌표나 회사위치가 없으면 "확인 불가".
export function evaluateOfficeLocation(
  company: OfficeGeofence,
  lat: number | null | undefined,
  lng: number | null | undefined
): "verified" | "out_of_range" | "unavailable" {
  if (company.officeLat == null || company.officeLng == null) return "unavailable";
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return "unavailable";

  const d = distanceMeters(lat, lng, company.officeLat, company.officeLng);
  return d <= company.officeRadiusM ? "verified" : "out_of_range";
}

// 화면 표시용 한글 라벨
export function workModeLabel(mode: string): string {
  if (mode === "home") return "재택";
  if (mode === "field") return "외근";
  return "사무실";
}

export function locationStatusLabel(status: string | null): string {
  if (status === "verified") return "위치 확인됨";
  if (status === "out_of_range") return "위치 벗어남";
  if (status === "unavailable") return "위치 확인 불가";
  return "해당 없음";
}
