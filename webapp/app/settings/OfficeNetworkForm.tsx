"use client";
// 사내 네트워크(IP) 설정 폼 — PC 출퇴근용. 현재 접속 IP를 보여주고, 허용 IP를 등록한다.
import { useActionState, useState } from "react";
import { saveOfficeNetwork } from "@/app/actions/settings";

export function OfficeNetworkForm({
  initialIps,
  currentIp,
}: {
  initialIps: string;
  currentIp: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveOfficeNetwork, {});
  const [ips, setIps] = useState(initialIps);

  function addCurrentIp() {
    if (!currentIp) return;
    const list = ips.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.includes(currentIp)) list.push(currentIp);
    setIps(list.join(", "));
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginTop: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>사내 네트워크 (PC 출퇴근용)</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        직원이 회사 네트워크(사내 WiFi·유선)로 접속하면 IP로 사무실 출근을 확인합니다. PC는 GPS가 없으니 이 방법을 씁니다.
        <br />
        <b>회사 공인 IP</b>를 등록하세요. 대역은 앞부분만 넣어도 됩니다(예: <code>203.0.113.</code>).
      </p>

      <div style={{ background: "#F9FAFB", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", marginBottom: 14, fontSize: 14 }}>
        지금 이 화면에 접속한 IP:{" "}
        <b style={{ color: "var(--text)" }}>{currentIp ?? "확인 불가(로컬/직접접속)"}</b>
        {currentIp && (
          <button
            type="button"
            onClick={addCurrentIp}
            style={{ marginLeft: 10, height: 30, padding: "0 12px", border: "1px solid var(--primary)", borderRadius: 7, background: "#fff", color: "var(--primary)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            이 IP 추가
          </button>
        )}
      </div>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>허용 IP (쉼표로 여러 개)</label>
          <input
            name="ips"
            type="text"
            value={ips}
            onChange={(e) => setIps(e.target.value)}
            placeholder="예: 203.0.113.5, 203.0.113."
            style={{ width: "100%", height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none" }}
          />
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
