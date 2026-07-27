// [PC관리] 관리자 전용 — PC-OFF 프로그램이 설치된 기기 현황·예외자 지정·사용 기록.
//  · 표시하는 값은 전부 실제 DB(AgentDevice·AgentEvent·User)에서 읽는다(가짜 데이터 금지).
//  · ⚠️ 여기에는 화면 내용·입력 내용이 없다. 애초에 수집하지 않으므로 보여줄 것도 없다.
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { isDeviceOnline } from "@/lib/agent-auth";
import { revokeAgentDevice, setPcOffExempt } from "@/app/actions/pcoff";
import { purgeAgentEventsDaily } from "@/lib/pcoff-retention";
import { RETENTION_WORK_LABEL, RETENTION_SYSTEM_LABEL, isTempUseType, TEMP_USE_TYPE, TEMP_USE_OFFLINE_TYPE } from "@/lib/pcoff";
import { listPcOffUnreported, PCOFF_ALERT_GRACE_MIN } from "@/lib/pcoff-alert";

// 사건 종류 → 사람이 읽는 라벨. ⚠️ app/api/agent/events/route.ts의 ALLOWED_TYPES와 짝이다(늘릴 때 함께).
const EVENT_LABEL: Record<string, { text: string; bg: string; fg: string }> = {
  lock: { text: "잠금", bg: "#FEE2E2", fg: "#B91C1C" },
  unlock: { text: "해제", bg: "#DCFCE7", fg: "#15803D" },
  temp_use: { text: "일시사용", bg: "#FEF3C7", fg: "#B45309" },
  // 인터넷이 끊긴 동안 쓴 일시사용 — 평소 사용과 **구분해서** 보여준다(몰래 푼 것이 아니라 기록된 사용임을 알 수 있게).
  temp_use_offline: { text: "일시사용(오프라인)", bg: "#FFEDD5", fg: "#C2410C" },
  notify: { text: "사전알림", bg: "#E0E7FF", fg: "#4338CA" },
  offline: { text: "오프라인", bg: "#F3F4F6", fg: "#6B7280" },
  paired: { text: "연결", bg: "#DBEAFE", fg: "#1D4ED8" },
};

const EVENT_LIMIT = 100; // 최근 이 건수만 표시(전체 이력은 DB에 남는다)

const th = { textAlign: "left" as const, fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" as const };
const td = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle" as const };
const cardStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" } as const;

export default async function PcDevicesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 보관기간이 지난 옛 기록 파기(하루 1회만 실제로 돈다). PC 앱이 없는 회사에서도 이 화면을 열면 정리된다.
  //  · after() = 화면을 다 보낸 뒤 실행 → 삭제가 오래 걸려도 화면이 늦게 뜨지 않는다(records 화면과 같은 방식).
  after(() => purgeAgentEventsDaily());

  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const [company, devices, employees, events, tempUseToday, unreported] = await Promise.all([
    prisma.company.findUnique({ where: { id: me.companyId }, select: { pcOffOn: true, workEndTime: true, pcOffDelayMin: true } }),
    prisma.agentDevice.findMany({
      where: { companyId: me.companyId },
      select: { id: true, deviceName: true, agentVersion: true, pairedAt: true, lastSeenAt: true, revokedAt: true, user: { select: { name: true, email: true, pcOffExempt: true } } },
      orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }],
    }),
    prisma.user.findMany({
      where: { companyId: me.companyId, deactivatedAt: null },
      select: { id: true, name: true, email: true, role: true, pcOffExempt: true },
      orderBy: [{ pcOffExempt: "desc" }, { name: "asc" }],
    }),
    prisma.agentEvent.findMany({
      where: { companyId: me.companyId },
      select: { id: true, type: true, at: true, createdAt: true, meta: true, user: { select: { name: true } }, device: { select: { deviceName: true } } },
      orderBy: { at: "desc" },
      take: EVENT_LIMIT,
    }),
    // 오늘 일시사용 = 평소 + 오프라인 **두 종류를 합산**. 한쪽만 세면 실제보다 적게 나온다.
    prisma.agentEvent.count({
      where: { companyId: me.companyId, type: { in: [TEMP_USE_TYPE, TEMP_USE_OFFLINE_TYPE] }, at: { gte: dayStart } },
    }),
    // 잠겼어야 하는데 잠금 기록이 안 온 PC(= 프로그램을 끈 PC). 집계가 실패해도 이 화면은 떠야 한다.
    listPcOffUnreported(me.companyId).catch((e) => {
      console.warn("[pc-devices] PC-OFF 미보고 집계 실패(화면은 정상 표시):", e);
      return { items: [], total: 0 };
    }),
  ]);

  const active = devices.filter((d) => !d.revokedAt);
  const online = active.filter((d) => isDeviceOnline(d.lastSeenAt));
  const exemptCount = employees.filter((e) => e.pcOffExempt).length;

  return (
    <AppShell user={me} active="pc-devices" title="PC 관리" subtitle={`${me.company.name} · PC-OFF 연결 기기·사용 기록`}>
      {/* 기능이 꺼져 있으면 먼저 알린다 — 화면에 기기가 있어도 실제로는 잠기지 않기 때문 */}
      {!company?.pcOffOn && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#B45309", wordBreak: "keep-all" }}>
            PC-OFF가 꺼져 있어 지금은 어떤 PC도 잠기지 않습니다. [설정] 화면의 PC-OFF 카드에서 켤 수 있습니다.
          </span>
        </div>
      )}

      {/* 잠겼어야 하는데 기록이 안 온 PC — 설치형 앱은 작업관리자로 끌 수 있으므로(지시서 §0)
           "기록이 안 왔다"를 알아채는 것이 유일한 실질 방어선이다. */}
      {unreported.total > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#B91C1C", wordBreak: "keep-all", marginBottom: 8 }}>
            잠금 기록이 오지 않은 PC {unreported.total}대 — 프로그램이 꺼져 있을 수 있습니다.
          </div>
          <ul style={{ margin: "0 0 8px", padding: "0 0 0 18px" }}>
            {unreported.items.map((u) => (
              <li key={`${u.deviceId}-${u.date}`} style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.7, wordBreak: "keep-all" }}>
                <b>{u.userName}</b> · {u.deviceName} — {u.date} {fmtHm(u.dueAt)}에 잠겨야 했습니다
                {u.lastSeenAt ? ` (마지막 연락 ${fmt(u.lastSeenAt)})` : " (연락 기록 없음)"}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: "#991B1B", margin: 0, lineHeight: 1.6, wordBreak: "keep-all" }}>
            퇴근 기준시각 + 유예가 지난 뒤 {PCOFF_ALERT_GRACE_MIN}분을 더 기다렸는데도 기록이 없을 때만 표시됩니다.
            <br />
            <b>인터넷이 끊긴 곳(외근·출장)에서는 기록이 늦게 올라옵니다.</b> 그 PC는 잠금이 정상 동작한 뒤 연결되는 순간
            쌓아둔 기록을 한 번에 보내며, 그때 이 목록에서 사라집니다. 곧바로 부정행위로 보지 마시고,
            며칠째 계속 남아 있는 PC만 확인하세요. 해당 직원에게 프로그램 실행을 안내하거나, 반복되면 [연결 해제] 후 다시 설치하게 하세요.
          </p>
        </div>
      )}

      <div className="kpi-grid-3" style={{ marginBottom: 16 }}>
        <Kpi label="연결된 PC" value={active.length} unit="대" />
        <Kpi label="지금 켜져 있는 PC" value={online.length} unit="대" />
        <Kpi label="오늘 일시사용" value={tempUseToday} unit="회" />
      </div>

      {/* ── 연결된 기기 ── */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>연결된 PC</div>
          <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "4px 0 0", lineHeight: 1.5, wordBreak: "keep-all" }}>
            직원이 [계정] 화면에서 연결코드를 발급받아 자기 PC의 프로그램에 입력하면 여기 나타납니다.
            마지막 연락이 10분 안이면 “켜짐”으로 봅니다. [연결 해제]를 누르면 그 PC의 프로그램은 즉시 사용할 수 없게 됩니다.
          </p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>직원</th>
                <th style={th}>컴퓨터 이름</th>
                <th style={th}>상태</th>
                <th style={th}>앱 버전</th>
                <th style={th}>연결일</th>
                <th style={th}>마지막 연락</th>
                <th style={{ ...th, textAlign: "right" }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr><td style={{ ...td, color: "var(--text-sub)", textAlign: "center", padding: "28px 20px" }} colSpan={7}>아직 연결된 PC가 없습니다.</td></tr>
              )}
              {devices.map((d) => {
                const revoked = !!d.revokedAt;
                const isOn = !revoked && isDeviceOnline(d.lastSeenAt);
                return (
                  <tr key={d.id} style={{ borderBottom: "1px solid #F3F4F6", opacity: revoked ? 0.55 : 1 }}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", color: "#374151", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                          {d.user.name.slice(0, 1)}
                        </span>
                        <span>
                          {d.user.name}
                          {d.user.pcOffExempt && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginLeft: 6 }}>(예외)</span>}
                        </span>
                      </div>
                    </td>
                    <td style={td}>{d.deviceName}</td>
                    <td style={td}><StatusPill revoked={revoked} online={isOn} /></td>
                    <td style={{ ...td, color: "var(--text-sub)", fontSize: 14 }}>{d.agentVersion ?? "-"}</td>
                    <td style={{ ...td, fontSize: 14, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(d.pairedAt)}</td>
                    <td style={{ ...td, fontSize: 14, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{d.lastSeenAt ? fmt(d.lastSeenAt) : "-"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {revoked ? (
                        <span style={{ fontSize: 13, color: "var(--text-sub)" }}>해제됨</span>
                      ) : (
                        <form action={revokeAgentDevice}>
                          <input type="hidden" name="deviceId" value={d.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            연결 해제
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 예외자 지정 ── */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>잠금 예외자 <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>({exemptCount}명)</span></div>
          <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "4px 0 0", lineHeight: 1.5, wordBreak: "keep-all" }}>
            예외로 지정한 직원의 PC는 회사가 PC-OFF를 켜도 잠기지 않습니다. 대표·전산담당·당직자 등에게 사용하세요.
          </p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>직원</th>
                <th style={th}>이메일</th>
                <th style={th}>역할</th>
                <th style={{ ...th, textAlign: "right" }}>잠금 예외</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td style={td}>{u.name}</td>
                  <td style={{ ...td, color: "var(--text-sub)", fontSize: 14 }}>{u.email}</td>
                  <td style={{ ...td, fontSize: 14 }}>{u.role === "admin" ? "관리자" : "직원"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <form action={setPcOffExempt}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="exempt" value={u.pcOffExempt ? "0" : "1"} />
                      <button
                        type="submit"
                        style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: u.pcOffExempt ? "#FEF3C7" : "#fff", color: u.pcOffExempt ? "#B45309" : "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {u.pcOffExempt ? "예외 해제" : "예외로 지정"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 사용 기록 ── */}
      <div style={cardStyle}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>사용 기록 <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>(최근 {EVENT_LIMIT}건)</span></div>
          <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "4px 0 0", lineHeight: 1.5, wordBreak: "keep-all" }}>
            잠금·해제·일시사용이 언제 일어났는지의 기록입니다. 화면 내용이나 어떤 프로그램을 썼는지는 <b>수집하지 않습니다</b>.
            <br />
            “시각”은 직원 PC의 프로그램이 알려온 값이라 PC 시계에 따라 달라질 수 있습니다. 서버가 받은 시각과 5분 넘게 차이 나면 <b>(지연)</b>으로 표시합니다.
            <br />
            보관기간은 <b>기록이 생긴 날</b>부터 셉니다 — 잠금·해제·일시사용 <b>{RETENTION_WORK_LABEL}</b>(근로기준법상 임금 산정 근거로 보존),
            사전알림·오프라인·연결 <b>{RETENTION_SYSTEM_LABEL}</b>. 기간이 지나면 <b>자동으로 파기</b>되고, 퇴사자는 퇴사 후 {RETENTION_WORK_LABEL}이 지나면 남은 기록까지 모두 파기됩니다.
          </p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>시각</th>
                <th style={th}>직원</th>
                <th style={th}>컴퓨터</th>
                <th style={th}>내용</th>
                <th style={th}>사유·메모</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td style={{ ...td, color: "var(--text-sub)", textAlign: "center", padding: "28px 20px" }} colSpan={5}>아직 기록이 없습니다.</td></tr>
              )}
              {events.map((e) => {
                const lb = EVENT_LABEL[e.type] ?? { text: e.type, bg: "#F3F4F6", fg: "#6B7280" };
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, fontSize: 14, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmt(e.at)}
                      {/* 앱이 알려온 시각과 서버 수신 시각이 크게 다르면 표시 — 조작된 시각이 증거처럼 보이지 않게 */}
                      {Math.abs(e.createdAt.getTime() - e.at.getTime()) > 5 * 60 * 1000 && (
                        <span style={{ fontSize: 12, color: "var(--text-sub)", marginLeft: 6 }} title={`서버 수신 ${fmt(e.createdAt)}`}>(지연)</span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 14 }}>{e.user.name}</td>
                    <td style={{ ...td, fontSize: 14, color: "var(--text-sub)" }}>{e.device.deviceName}</td>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 9px", borderRadius: 6, background: lb.bg, color: lb.fg, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{lb.text}</span>
                    </td>
                    {/* 일시사용인데 사유가 비어 있으면 "-"가 아니라 미확인임을 밝힌다(사유를 지어내지 않는다) */}
                    <td style={{ ...td, fontSize: 14, color: "var(--text-sub)", wordBreak: "keep-all" }}>
                      {e.meta ?? (isTempUseType(e.type) ? "(사유 미확인)" : "-")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
        {value}<span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  );
}

function StatusPill({ revoked, online }: { revoked: boolean; online: boolean }) {
  const s = revoked
    ? { bg: "#F3F4F6", dot: "#9CA3AF", fg: "#6B7280", text: "연결 해제" }
    : online
      ? { bg: "#DCFCE7", dot: "var(--success)", fg: "#15803D", text: "켜짐" }
      : { bg: "#F3F4F6", dot: "#9CA3AF", fg: "#6B7280", text: "꺼짐" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: s.fg }}>{s.text}</span>
    </span>
  );
}

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 시:분만 (날짜는 옆에 이미 쓰여 있다) */
function fmtHm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
