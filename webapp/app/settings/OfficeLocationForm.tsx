"use client";
// 회사 위치 설정 폼 — 지도(깃발+반경) + 위도/경도/반경 입력.
// "현재 내 위치로 채우기" 또는 지도 클릭/드래그로 위치를 정한다.
import { useActionState, useState } from "react";
import dynamic from "next/dynamic";
import { saveOfficeLocation } from "@/app/actions/settings";
import { geocodeForOffice } from "@/app/actions/geo";
import { PostcodeButton } from "@/app/components/PostcodeButton";
import { formatThousands, stripCommas } from "@/lib/format";

// 지도는 브라우저에서만 로드(서버 렌더 시 오류 방지)
const OfficeMap = dynamic(() => import("./OfficeMap").then((m) => m.OfficeMap), {
  ssr: false,
  loading: () => (
    <div style={{ height: 320, borderRadius: 10, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-sub)", fontSize: 14 }}>
      지도 불러오는 중...
    </div>
  ),
});

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  outline: "none",
  width: "100%",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function OfficeLocationForm({
  initial,
}: {
  initial: { lat: number | null; lng: number | null; radius: number; address: string | null; addressDetail: string | null };
}) {
  const [state, formAction, pending] = useActionState(saveOfficeLocation, {});
  const [lat, setLat] = useState(initial.lat != null ? String(initial.lat) : "");
  const [lng, setLng] = useState(initial.lng != null ? String(initial.lng) : "");
  const [radius, setRadius] = useState(formatThousands(String(initial.radius)));
  const [address, setAddress] = useState(initial.address ?? "");
  const [addressDetail, setAddressDetail] = useState(initial.addressDetail ?? "");
  const [geoMsg, setGeoMsg] = useState("");
  const [addrMsg, setAddrMsg] = useState("");

  const latNum = lat.trim() === "" || Number.isNaN(Number(lat)) ? null : Number(lat);
  const lngNum = lng.trim() === "" || Number.isNaN(Number(lng)) ? null : Number(lng);
  const radiusParsed = Number(stripCommas(radius));
  const radiusNum = Number.isFinite(radiusParsed) && radiusParsed > 0 ? radiusParsed : 200;

  // 우편번호 팝업에서 주소를 고르면 → 카카오 지오코딩으로 좌표를 찾아 지도에 표시.
  async function onAddressPicked(_zip: string, address: string) {
    if (!address) return;
    setAddrMsg(`'${address}' 위치를 찾는 중...`);
    setAddress(address); // 주소 칸도 함께 채운다(상세주소는 사용자가 입력)
    const r = await geocodeForOffice(address);
    if (r) {
      setLat(r.lat.toFixed(6));
      setLng(r.lng.toFixed(6));
      setAddrMsg(`'${address}' 위치를 지도에 표시했습니다. 상세주소를 넣고 저장을 눌러주세요.`);
    } else {
      setAddrMsg("주소로 좌표를 찾지 못했습니다. 지도를 눌러 직접 지정해주세요.");
    }
  }

  function fillCurrentLocation() {
    setGeoMsg("현재 위치 확인 중...");
    if (!navigator.geolocation) {
      setGeoMsg("이 브라우저는 위치 기능을 지원하지 않습니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGeoMsg("현재 위치를 지도에 표시했습니다. 저장을 눌러주세요.");
      },
      () => setGeoMsg("위치 권한이 거부되었거나 실패했습니다. 지도를 눌러 직접 지정해주세요."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>사업장 위치 (사무실 출근 확인용)</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        사무실에서 출근할 때 이 위치의 반경(파란 원) 안에 있는지 확인합니다. 재택·외근은 위치를 확인하지 않습니다.
        <br />
        <b>지도를 클릭</b>하거나 <b>깃발을 끌어</b> 위치를 정하고, 아래 저장을 누르세요.
      </p>

      {/* 주소로 위치 찾기(권장) — 도로명/지번 주소를 검색하면 자동으로 지도에 표시된다. PC에서 특히 편리. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <PostcodeButton onComplete={onAddressPicked} label="주소로 위치 찾기" />
        <button
          type="button"
          onClick={fillCurrentLocation}
          style={{ height: 44, padding: "0 16px", border: "1px solid var(--primary)", borderRadius: 8, background: "#fff", color: "var(--primary)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          📍 현재 내 위치로 채우기
        </button>
      </div>
      {addrMsg && <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 8 }}>{addrMsg}</div>}
      {geoMsg && <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 12 }}>{geoMsg}</div>}

      {/* 지도 */}
      <div style={{ marginBottom: 16 }}>
        <OfficeMap lat={latNum} lng={lngNum} radius={radiusNum} onChange={(la, ln) => { setLat(la.toFixed(6)); setLng(ln.toFixed(6)); }} />
      </div>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>주소</label>
          <input name="officeAddress" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소로 위치 찾기로 채우거나 직접 입력" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>상세주소</label>
          <input name="officeAddressDetail" type="text" value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} placeholder="동·층·호수 등" style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>위도(latitude)</label>
            <input name="lat" type="text" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="37.5665" style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>경도(longitude)</label>
            <input name="lng" type="text" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="126.9780" style={inputStyle} />
          </div>
          <div style={{ width: 140 }}>
            <label style={labelStyle}>허용 반경(m)</label>
            <input name="radius" type="text" inputMode="numeric" data-format="number" value={radius} onChange={(e) => setRadius(formatThousands(e.target.value))} style={inputStyle} />
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

        <button
          type="submit"
          disabled={pending}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}
