"use client";
// 출근 패널 — 근무형태(사무실/재택/외근) 선택. 사무실은 현재 위치를 확인해서 함께 보낸다.
// 위치가 벗어나거나 확인 실패해도 출근은 진행된다(부드럽게). 좌표는 서버에서 판정 후 버려진다.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clockIn } from "@/app/actions/attendance";
import { Icon } from "@/app/components/Icon";
import { getOfficePosition, geoFailMessage, GEO_RETRY_MESSAGE, GEO_NO_LOCATION_NOTE } from "@/lib/geo-client";

export function ClockInPanel() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  // 🔒 버튼 잠금은 클릭 즉시 걸어야 한다(검수 C-4).
  //    startTransition의 pending은 서버 호출이 시작돼야 true가 되는데,
  //    사무실 출근은 그 전에 **위치 확인을 최대 10초** 기다린다 → 그 사이 버튼이 열려 있어
  //    두 번 누르면 출근 기록이 2개 만들어질 수 있었다.
  const [busy, setBusy] = useState(false);
  // 위치를 끝내 못 가져왔을 때의 안내(2026-11-20). 있으면 [다시 시도]/[위치 없이 출근]을 고르게 한다.
  //  · 예전엔 조용히 위치 없이 출근돼 "확인 불가"만 쌓이고 이유를 아무도 몰랐다.
  //  · 출근 뒤 안내는 패널이 퇴근 화면으로 바뀌며 사라지므로 **출근 전에** 묻는다. 출근 자체는 막지 않는다.
  const [geoFail, setGeoFail] = useState<string | null>(null);
  // 위치를 기다리는 중 화면을 떠나면, 늦게 도착한 위치로 출근을 처리하지 않는다(검수 M-4 — 본인은 안 된 줄 안다).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const router = useRouter();
  const locked = busy || pending;

  function submit(mode: "office" | "home" | "field", lat?: number, lng?: number) {
    startTransition(async () => {
      try {
        const res = await clockIn(mode, lat, lng);
        setMsg("");
        if (!res.ok) setError(res.reason); // 조용히 무시하지 않고 이유를 보여준다
        else setError("");
        router.refresh();
      } catch {
        // 네트워크 끊김·서버 오류 — 아무 표시 없이 끝나면 출근된 줄 오해한다.
        setMsg("");
        setError("출근 처리에 실패했습니다. 인터넷 연결을 확인하고 다시 눌러주세요.");
      } finally {
        setBusy(false);
      }
    });
  }

  function start(mode: "office" | "home" | "field") {
    if (locked) return;
    setBusy(true);
    setError("");
    setGeoFail(null);
    submit(mode);
  }

  function clockInOffice() {
    if (locked) return;
    setBusy(true); // 위치 확인을 기다리는 동안에도 잠근다(보통 0~16초, 권한 창을 무시하면 최대 약 40초 — lib/geo-client.ts)
    setError("");
    setGeoFail(null);
    setMsg("현재 위치 확인 중...");
    getOfficePosition(() => setMsg(GEO_RETRY_MESSAGE)).then((r) => {
      if (!mountedRef.current) return; // 화면을 떠났다 — 출근 처리하지 않는다(M-4)
      if (r.ok) {
        submit("office", r.lat, r.lng);
        return;
      }
      // 끝내 실패 — 이유를 보여 주고 고르게 한다(잠금 해제)
      setMsg("");
      setGeoFail(geoFailMessage(r.reason));
      setBusy(false);
    });
  }

  // [위치 없이 출근] — 위치 없이 진행(서버가 '확인 불가'로 기록). 출근을 막지 않는다는 원칙.
  function clockInOfficeWithoutLocation() {
    if (locked) return;
    setBusy(true);
    setError("");
    setGeoFail(null);
    submit("office");
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
    cursor: locked ? "default" : "pointer",
    opacity: locked ? 0.6 : 1,
  };

  return (
    <div>
      <button
        type="button"
        disabled={locked}
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
          cursor: locked ? "default" : "pointer",
          opacity: locked ? 0.6 : 1,
          marginBottom: 12,
        }}
      >
        <Icon name="office" size={20} style={{ marginRight: 8 }} />사무실 출근
      </button>
      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" disabled={locked} onClick={() => start("home")} style={secondaryBtn}>
          <Icon name="home" style={{ marginRight: 6 }} />재택근무
        </button>
        <button type="button" disabled={locked} onClick={() => start("field")} style={secondaryBtn}>
          <Icon name="car" style={{ marginRight: 6 }} />외근
        </button>
      </div>
      {msg && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12 }}>{msg}</div>}
      {geoFail && (
        <div style={{ marginTop: 12, padding: "12px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, fontSize: 13, color: "#92400E", lineHeight: 1.6, wordBreak: "keep-all" }}>
          <b>위치를 확인하지 못했습니다.</b> {geoFail} {GEO_NO_LOCATION_NOTE}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" disabled={locked} onClick={clockInOffice} style={{ ...secondaryBtn, height: 44, fontSize: 14 }}>
              다시 시도
            </button>
            <button type="button" disabled={locked} onClick={clockInOfficeWithoutLocation} style={{ ...secondaryBtn, height: 44, fontSize: 14 }}>
              위치 없이 출근
            </button>
          </div>
        </div>
      )}
      {error && (
        <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 12, fontWeight: 700 }}>{error}</div>
      )}
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12 }}>
        사무실 출근만 위치를 확인합니다. 재택·외근은 위치를 확인하지 않아요.
      </div>
    </div>
  );
}
