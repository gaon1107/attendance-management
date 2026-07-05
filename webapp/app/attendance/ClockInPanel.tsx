"use client";
// 출근 패널 — 근무형태(사무실/재택/외근) 선택. 사무실은 현재 위치를 확인해서 함께 보낸다.
// 위치가 벗어나거나 확인 실패해도 출근은 진행된다(부드럽게). 좌표는 서버에서 판정 후 버려진다.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clockIn } from "@/app/actions/attendance";

export function ClockInPanel() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const router = useRouter();

  function submit(mode: "office" | "home" | "field", lat?: number, lng?: number) {
    startTransition(async () => {
      await clockIn(mode, lat, lng);
      router.refresh();
    });
  }

  function clockInOffice() {
    setMsg("현재 위치 확인 중...");
    if (!navigator.geolocation) {
      submit("office"); // 위치 못 쓰면 '확인 불가'로 기록되고 출근 진행
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => submit("office", pos.coords.latitude, pos.coords.longitude),
      () => submit("office"), // 권한 거부/실패해도 출근은 진행
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const secondaryBtn: React.CSSProperties = {
    flex: 1,
    height: 52,
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "#fff",
    color: "var(--text)",
    fontFamily: "inherit",
    fontSize: 15,
    fontWeight: 700,
    cursor: pending ? "default" : "pointer",
  };

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={clockInOffice}
        style={{
          width: "100%",
          height: 56,
          border: "none",
          borderRadius: 12,
          background: "var(--primary)",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 18,
          fontWeight: 700,
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
          marginBottom: 12,
        }}
      >
        🏢 사무실 출근
      </button>
      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" disabled={pending} onClick={() => submit("home")} style={secondaryBtn}>
          🏠 재택근무
        </button>
        <button type="button" disabled={pending} onClick={() => submit("field")} style={secondaryBtn}>
          🚗 외근
        </button>
      </div>
      {msg && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12 }}>{msg}</div>}
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12 }}>
        사무실 출근만 위치를 확인합니다. 재택·외근은 위치를 확인하지 않아요.
      </div>
    </div>
  );
}
