// 카카오 로컬 REST API — 주소를 지도 좌표(위도·경도)로 변환(지오코딩).
// ※ 서버 전용: 반드시 "use server" 액션을 통해서만 호출한다(KAKAO_REST_KEY가 클라이언트에 노출되지 않도록).
// 키는 .env KAKAO_REST_KEY. 없으면 조용히 null(기능만 비활성, 나머지는 정상).

export type GeoResult = { lat: number; lng: number; address: string };

export async function geocodeAddress(query: string): Promise<GeoResult | null> {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return null;

  const clean = query.trim();
  if (!clean) return null;

  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(clean)}`,
      {
        headers: { Authorization: `KakaoAK ${key}` },
        // 설정 저장 흐름을 막지 않도록 짧은 타임아웃
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) {
      console.error("[geocode] 카카오 응답 오류:", res.status);
      return null;
    }
    const j = (await res.json()) as {
      documents?: { x: string; y: string; address_name?: string }[];
    };
    const d = j.documents?.[0];
    if (!d) return null;

    const lat = Number(d.y);
    const lng = Number(d.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, address: d.address_name ?? clean };
  } catch (e) {
    console.error("[geocode] 변환 실패:", e);
    return null;
  }
}
