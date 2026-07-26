"use client";
// [계정] PC 연결 카드 — 내 PC의 PC-OFF 프로그램에 입력할 연결코드를 발급받고, 내 기기를 확인·해제한다.
//  · 코드는 6자리·5분 유효·1회용. 발급하면 이전 코드는 무효가 된다.
//  · 본인 데이터 열람권: 내 PC에서 일어난 일(잠금·해제·일시사용)을 직원 본인도 볼 수 있게 최근 기록을 함께 보여준다.
import { useState } from "react";
import { issuePairCode, revokeAgentDevice } from "@/app/actions/pcoff";

type Device = { id: string; deviceName: string; pairedAt: string; lastSeenAt: string | null; online: boolean };
type EventRow = { id: string; type: string; at: string; meta: string | null; deviceName: string };

const EVENT_TEXT: Record<string, string> = {
  lock: "잠금", unlock: "해제", temp_use: "일시사용", notify: "사전알림", offline: "오프라인", paired: "연결",
};

export function PcLinkCard({ devices, events, pcOffOn, exempt }: {
  devices: Device[]; events: EventRow[]; pcOffOn: boolean; exempt: boolean;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onIssue() {
    setPending(true);
    setError(null);
    try {
      const res = await issuePairCode();
      if (res.error) { setError(res.error); setCode(null); }
      else { setCode(res.code ?? null); setExpiresAt(res.expiresAt ?? null); }
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>내 PC 연결 (PC-OFF)</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        회사 PC에 설치한 <b>PC-OFF 프로그램</b>에 아래 연결코드를 입력하면 내 계정과 연결됩니다.
        연결된 PC는 근무시간이 끝나면 화면이 잠기고, <b>승인된 연장근무</b> 시간에는 잠기지 않습니다.
        {!pcOffOn && <><br /><span style={{ color: "var(--text-sub)" }}>지금은 회사가 PC-OFF를 사용하지 않아 잠기지 않습니다.</span></>}
        {exempt && <><br /><span style={{ color: "var(--warning)", fontWeight: 700 }}>회원님은 잠금 예외자로 지정돼 있어 PC가 잠기지 않습니다.</span></>}
      </p>

      <button
        type="button"
        onClick={onIssue}
        disabled={pending}
        style={{ height: 44, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 22px" }}
      >
        {pending ? "발급 중..." : "연결코드 발급"}
      </button>

      {error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 10, wordBreak: "keep-all" }}>{error}</div>}

      {code && (
        <div style={{ background: "#F9FAFB", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 6 }}>연결코드</div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{code}</div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, lineHeight: 1.5, wordBreak: "keep-all" }}>
            {expiresAt ? `${hhmm(expiresAt)}까지 유효` : "5분간 유효"}합니다. 한 번만 쓸 수 있고, 새로 발급하면 이전 코드는 쓸 수 없습니다.
          </div>
        </div>
      )}

      {/* 내 기기 */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>연결된 내 PC ({devices.length}대)</div>
        {devices.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-sub)" }}>아직 연결된 PC가 없습니다.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {devices.map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {d.deviceName}
                    <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 8, color: d.online ? "var(--success)" : "var(--text-sub)" }}>
                      {d.online ? "켜짐" : "꺼짐"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                    연결 {fmt(d.pairedAt)} · 마지막 연락 {d.lastSeenAt ? fmt(d.lastSeenAt) : "-"}
                  </div>
                </div>
                <form action={revokeAgentDevice}>
                  <input type="hidden" name="deviceId" value={d.id} />
                  <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    연결 해제
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 내 기록(본인 데이터 열람권) */}
      {events.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>내 PC 기록 (최근 {events.length}건)</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {events.map((e, i) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid #F3F4F6" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(e.at)}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{EVENT_TEXT[e.type] ?? e.type}</span>
                <span style={{ fontSize: 12, color: "var(--text-sub)", flex: 1, textAlign: "right", wordBreak: "keep-all" }}>
                  {e.meta ?? (e.type === "temp_use" ? "(사유 미확인)" : e.deviceName)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
