"use client";
// 실시간 현황판(클라이언트) — 레이아웃 + 자동 새로고침. 데이터·회사격리·권한은 서버(page.tsx)가 책임.
//  · "실시간"은 30초마다 router.refresh()로 서버 데이터를 다시 받는 방식(웹소켓 아님 — 충분·가벼움).
//  · 화면을 벗어나면(탭 숨김) 새로고침을 멈춘다(불필요한 서버 부하 방지). 토글로 끌 수 있다.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

// 지도는 브라우저에서만 로드(서버 렌더 시 Leaflet 오류 방지) — 설정 화면 OfficeMap과 동일 방식.
const StatusMap = dynamic(() => import("./StatusMap").then((m) => m.StatusMap), {
  ssr: false,
  loading: () => (
    <div style={{ height: 360, borderRadius: 10, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-sub)", fontSize: 14 }}>
      지도 불러오는 중...
    </div>
  ),
});

export type WorkingPerson = {
  name: string;
  since: string; // 출근 시각 HH:MM
  locationLabel: string | null; // 사무실 근무자 위치확인 상태(재택·외근은 null)
  locationOk: boolean;
  authLabel: string; // 얼굴인증 | GPS | —
};

export type LiveData = {
  office: { lat: number; lng: number; radius: number; address: string | null } | null;
  working: { office: WorkingPerson[]; home: WorkingPerson[]; field: WorkingPerson[] };
  workingTotal: number;
  access: { office: number; outside: number; unknown: number; hasIpRule: boolean };
  generatedAt: string; // 이 데이터를 만든 시각 HH:MM
};

const REFRESH_SEC = 30;

export function LiveClient({ data }: { data: LiveData }) {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  const [pending, setPending] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  // 30초마다 서버 데이터 재요청. 탭이 숨겨져 있으면 건너뛴다(부하 절약).
  useEffect(() => {
    const id = setInterval(() => {
      if (!autoRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, REFRESH_SEC * 1000);
    return () => clearInterval(id);
  }, [router]);

  const manualRefresh = () => {
    setPending(true);
    router.refresh();
    // router.refresh는 즉시 반환 — 짧게 표시만(정확한 완료 신호는 없음).
    setTimeout(() => setPending(false), 600);
  };

  const a = data.access;
  const accessTotal = a.office + a.outside + a.unknown;

  return (
    <div>
      {/* 상단 — 기준 시각 + 자동 새로고침 토글 + 수동 버튼 */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "var(--text-sub)" }}>
          기준 시각 <b style={{ color: "var(--text)" }}>{data.generatedAt}</b>
          <span style={{ marginLeft: 6 }}>· {REFRESH_SEC}초마다 자동 갱신</span>
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--text-sub)", cursor: "pointer" }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 15, height: 15 }} />
            자동 새로고침
          </label>
          <button
            type="button"
            onClick={manualRefresh}
            style={{ height: 36, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {pending ? "새로고침 중…" : "지금 새로고침"}
          </button>
        </div>
      </div>

      <div className="dash-split">
        {/* 왼쪽: 지도 */}
        <div style={{ minWidth: 0 }}>
          <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>사무실 위치</div>
              {data.office?.address && (
                <span style={{ fontSize: 13, color: "var(--text-sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.office.address}</span>
              )}
            </div>
            <div style={{ padding: 16 }}>
              {data.office ? (
                <>
                  <StatusMap lat={data.office.lat} lng={data.office.lng} radius={data.office.radius} />
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 10, lineHeight: 1.6 }}>
                    파란 원 = 사무실 출근 허용 반경({data.office.radius}m). <b>직원 개인 위치는 표시하지 않습니다</b>(개인정보 보호 — 원본 위치를 저장하지 않습니다).
                  </div>
                </>
              ) : (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-sub)", fontSize: 14, lineHeight: 1.8 }}>
                  사무실 위치가 아직 설정되지 않았습니다.
                  <br />
                  <a href="/settings" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>[설정]에서 사무실 위치를 먼저 정해주세요.</a>
                </div>
              )}
            </div>
          </section>

          {/* 오늘 접속(사내망/외부) — 지도 아래 */}
          <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginTop: 16 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700 }}>
              오늘 접속 <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-sub)" }}>· 총 {accessTotal}건</span>
            </div>
            <div className="kpi-grid" style={{ padding: 16, gap: 12 }}>
              {[
                { label: "사내망", value: a.office, color: "#15803D" },
                { label: "외부", value: a.outside, color: a.outside > 0 ? "#B45309" : "var(--text-sub)" },
                { label: a.hasIpRule ? "판정 불가" : "판정 불가(IP 미설정)", value: a.unknown, color: "var(--text-sub)" },
              ].map((k) => (
                <div key={k.label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color }}>
                    {k.value}<span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>건</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "0 16px 16px", fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6 }}>
              오늘 하루 있었던 로그인·출퇴근 접속을 센 것입니다(<b>지금 접속 중인 인원이 아닙니다</b>).
              {!a.hasIpRule && <> 사내망/외부 판정은 <a href="/settings" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>[설정]의 사내 네트워크 IP</a>를 등록해야 가능합니다.</>}
              <br />※ 접속 위치(IP) 판정은 서버 설정에 따라 달라집니다(배포 시 설정 전에는 부정확할 수 있습니다).
            </div>
          </section>
        </div>

        {/* 오른쪽: 지금 근무 중 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section style={{ background: "var(--primary)", borderRadius: 12, padding: "20px 22px", color: "#fff" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>지금 근무 중</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {data.workingTotal}<span style={{ fontSize: 15, fontWeight: 400, color: "rgba(255,255,255,0.8)", marginLeft: 2 }}>명</span>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.18)" }}>
              {[
                ["사무실", data.working.office.length],
                ["재택", data.working.home.length],
                ["외근", data.working.field.length],
              ].map(([label, n]) => (
                <div key={label as string}>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{n as number}명</div>
                </div>
              ))}
            </div>
          </section>

          {(["office", "home", "field"] as const).map((mode) => {
            const list = data.working[mode];
            const title = mode === "office" ? "사무실 근무" : mode === "home" ? "재택 근무" : "외근";
            return (
              <section key={mode} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
                  <span>{title}</span>
                  <span style={{ color: "var(--text-sub)", fontWeight: 400, fontSize: 13 }}>{list.length}명</span>
                </div>
                {list.length === 0 ? (
                  <div style={{ padding: "18px", fontSize: 13, color: "var(--text-sub)", textAlign: "center" }}>없음</div>
                ) : (
                  <div>
                    {list.map((p, i) => (
                      <div key={`${p.name}-${i}`} style={{ padding: "11px 18px", borderBottom: i < list.length - 1 ? "1px solid #F3F4F6" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                            {p.name.slice(0, 1)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>{p.name}</div>
                            <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{p.since} 출근 · {p.authLabel}</div>
                          </div>
                        </div>
                        {p.locationLabel && (
                          <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 999, background: p.locationOk ? "#DCFCE7" : "#FEF3C7", color: p.locationOk ? "#15803D" : "#B45309" }}>
                            {p.locationLabel}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
