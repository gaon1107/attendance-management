// 계정 설정(공통) — 내 계정 정보 확인 + 비밀번호 변경. 관리자·직원 모두 사용(프로필 아바타로 진입). (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { PcLinkCard } from "./PcLinkCard";
import { prisma } from "@/lib/db";
import { isDeviceOnline } from "@/lib/agent-auth";

const MY_EVENT_LIMIT = 20; // [내 PC 기록]에 보여줄 최근 건수(본인 데이터 열람권)

export default async function AccountPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  // PC-OFF: 내 기기와 내 기록(본인 것만). 기존 카드 데이터와 무관하게 따로 조회한다.
  const [myDevices, myEvents] = await Promise.all([
    prisma.agentDevice.findMany({
      where: { userId: me.id, companyId: me.companyId, revokedAt: null },
      select: { id: true, deviceName: true, pairedAt: true, lastSeenAt: true },
      orderBy: { pairedAt: "desc" },
    }),
    prisma.agentEvent.findMany({
      where: { userId: me.id, companyId: me.companyId },
      select: { id: true, type: true, at: true, meta: true, device: { select: { deviceName: true } } },
      orderBy: { at: "desc" },
      take: MY_EVENT_LIMIT,
    }),
  ]);

  const info: { label: string; value: string }[] = [
    { label: "이름", value: me.name },
    { label: "이메일", value: me.email },
    { label: "회사", value: me.company.name },
    { label: "역할", value: me.role === "admin" ? "관리자" : "직원" },
  ];

  return (
    <AppShell user={me} active="account" title="계정 설정" subtitle={`${me.name} 님`}>
      <div className="split-2">
      {/* 내 정보 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>내 정보</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {info.map((r, i) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid #F3F4F6", gap: 16 }}>
              <span style={{ fontSize: 14, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontSize: 15, textAlign: "right" }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 비밀번호 변경 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>비밀번호 변경</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.
        </p>
        <ChangePasswordForm />
      </div>
      </div>

      {/* PC-OFF 연결 — 기존 두 카드 아래에 추가(기존 카드는 그대로) */}
      <div style={{ marginTop: 16 }}>
        <PcLinkCard
          pcOffOn={me.company.pcOffOn}
          exempt={me.pcOffExempt}
          devices={myDevices.map((d) => ({
            id: d.id,
            deviceName: d.deviceName,
            pairedAt: d.pairedAt.toISOString(),
            lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
            online: isDeviceOnline(d.lastSeenAt),
          }))}
          events={myEvents.map((e) => ({
            id: e.id, type: e.type, at: e.at.toISOString(), meta: e.meta, deviceName: e.device.deviceName,
          }))}
        />
      </div>
    </AppShell>
  );
}
