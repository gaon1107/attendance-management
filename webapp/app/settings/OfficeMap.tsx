"use client";
// 회사 위치 지도 — OpenStreetMap(무료). 🚩 깃발 마커 + 허용 반경 원.
// 지도를 클릭하거나 깃발을 끌어 위치를 정할 수 있고, 그 좌표를 부모에게 알려준다(onChange).
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const SEOUL = { lat: 37.5665, lng: 126.978 };

// 깃발 모양 마커(기본 아이콘 이미지 깨짐 방지를 위해 직접 만든 아이콘)
const flagIcon = L.divIcon({
  className: "",
  html: `<div style="font-size:30px;line-height:1;transform:translate(-6px,-26px);filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">🚩</div>`,
  iconSize: [0, 0],
});

export function OfficeMap({
  lat,
  lng,
  radius,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  radius: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 지도 최초 1회 생성
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;

    const center: [number, number] = [lat ?? SEOUL.lat, lng ?? SEOUL.lng];
    const map = L.map(elRef.current).setView(center, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker(center, { draggable: true, icon: flagIcon }).addTo(map);
    const circle = L.circle(center, { radius, color: "#2563EB", fillColor: "#2563EB", fillOpacity: 0.12, weight: 1 }).addTo(map);

    // 깃발을 끌어 놓으면 위치 반영
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      circle.setLatLng(p);
      onChangeRef.current(p.lat, p.lng);
    });
    // 지도를 클릭하면 그 자리로 깃발 이동
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // 최초 1회만 — 이후 좌표/반경 변화는 아래 effect가 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 부모에서 좌표가 바뀌면(내 위치로 채우기·직접 입력) 지도·깃발·원 이동
  useEffect(() => {
    if (!mapRef.current || lat == null || lng == null) return;
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
      style={{ width: "100%", height: 320, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden", zIndex: 0 }}
    />
  );
}
