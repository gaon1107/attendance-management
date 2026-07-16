"use client";
// 현황판용 **읽기 전용** 지도 — OpenStreetMap(무료·키 불필요). 사무실 깃발 + 허용 반경 원만 표시.
//  · 설정 화면의 OfficeMap과 달리 **드래그·클릭이 없다**(보기 전용). 그래서 OfficeMap을 건드리지 않고
//    별도 컴포넌트로 둔다 — OfficeMap은 설정 저장에 쓰이는 대화형이라 손대면 위험(공통 모듈 보호).
//  · 직원 개인 위치는 찍지 않는다(원본 좌표 미저장 원칙). 지도에 있는 유일한 진짜 좌표 = 사무실.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// 깃발 아이콘(기본 마커 이미지 깨짐 방지 — OfficeMap과 동일 방식)
const flagIcon = L.divIcon({
  className: "",
  html: `<div style="font-size:30px;line-height:1;transform:translate(-6px,-26px);filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">🚩</div>`,
  iconSize: [0, 0],
});

export function StatusMap({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  // 지도 최초 1회 생성
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;

    const center: [number, number] = [lat, lng];
    // 보기 전용 — 스크롤 줌만 켜고 드래그로 위치를 바꾸는 상호작용은 없다(관리자가 실수로 옮길 일 없음).
    const map = L.map(elRef.current, { attributionControl: true }).setView(center, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    markerRef.current = L.marker(center, { icon: flagIcon, interactive: false }).addTo(map);
    circleRef.current = L.circle(center, { radius, color: "#2563EB", fillColor: "#2563EB", fillOpacity: 0.12, weight: 1 }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // 최초 1회만 — 좌표/반경 변화는 아래 effect가 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 좌표가 바뀌면(설정 변경 후 자동 새로고침 등) 지도·깃발·원 이동
  useEffect(() => {
    if (!mapRef.current) return;
    const p: [number, number] = [lat, lng];
    markerRef.current?.setLatLng(p);
    circleRef.current?.setLatLng(p);
    mapRef.current.setView(p);
  }, [lat, lng]);

  // 반경이 바뀌면 원 크기 변경
  useEffect(() => {
    circleRef.current?.setRadius(radius);
  }, [radius]);

  return (
    <div
      ref={elRef}
      style={{ width: "100%", height: 360, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden", zIndex: 0 }}
    />
  );
}
