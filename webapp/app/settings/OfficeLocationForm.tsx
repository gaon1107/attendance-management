"use client";
// 회사 위치 설정 폼 — 위도/경도/반경 입력. "현재 내 위치로 채우기" 버튼 지원.
import { useActionState, useRef, useState } from "react";
import { saveOfficeLocation } from "@/app/actions/settings";

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
  initial: { lat: number | null; lng: number | null; radius: number };
}) {
  const [state, formAction, pending] = useActionState(saveOfficeLocation, {});
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [geoMsg, setGeoMsg] = useState("");

  function fillCurrentLocation() {
    setGeoMsg("현재 위치 확인 중...");
    if (!navigator.geolocation) {
      setGeoMsg("이 브라우저는 위치 기능을 지원하지 않습니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = pos.coords.latitude.toFixed(6);
        if (lngRef.current) lngRef.current.value = pos.coords.longitude.toFixed(6);
        setGeoMsg("현재 위치를 채웠습니다. 아래 저장을 눌러주세요.");
      },
      () => setGeoMsg("위치 권한이 거부되었거나 확인에 실패했습니다. 직접 입력해주세요."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>사업장 위치 (사무실 출근 확인용)</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 20, lineHeight: 1.6 }}>
        사무실에서 출근할 때 이 위치의 반경 안에 있는지 확인합니다. 재택·외근은 위치를 확인하지 않습니다.
      </p>

      <button
        type="button"
        onClick={fillCurrentLocation}
        style={{
          height: 40,
          padding: "0 16px",
          border: "1px solid var(--primary)",
          borderRadius: 8,
          background: "#fff",
          color: "var(--primary)",
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: 8,
        }}
      >
        📍 현재 내 위치로 채우기
      </button>
      {geoMsg && <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 8 }}>{geoMsg}</div>}

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>위도(latitude)</label>
            <input ref={latRef} name="lat" type="text" defaultValue={initial.lat ?? ""} placeholder="37.5665" style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>경도(longitude)</label>
            <input ref={lngRef} name="lng" type="text" defaultValue={initial.lng ?? ""} placeholder="126.9780" style={inputStyle} />
          </div>
          <div style={{ width: 140 }}>
            <label style={labelStyle}>허용 반경(m)</label>
            <input name="radius" type="number" defaultValue={initial.radius} style={inputStyle} />
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

        <button
          type="submit"
          disabled={pending}
          style={{
            height: 48,
            border: "none",
            borderRadius: 10,
            background: "var(--primary)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 700,
            cursor: pending ? "default" : "pointer",
            opacity: pending ? 0.6 : 1,
            alignSelf: "flex-start",
            padding: "0 28px",
          }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}
