// 계정 설정(공통) — 내 계정 정보 확인 + 비밀번호 변경. 관리자·직원 모두 사용(프로필 아바타로 진입). (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { PcLinkCard } from "./PcLinkCard";
import { RecoveryPhoneCard } from "./RecoveryPhoneCard";
import { prisma } from "@/lib/db";
import { isDeviceOnline } from "@/lib/agent-auth";
import { maskPhone, isMobilePhone } from "@/lib/phone";
import { OWNER_RECOVERY_ENABLED } from "@/lib/owner-recovery";

const MY_EVENT_LIMIT = 20; // [내 PC 기록]에 보여줄 최근 건수(본인 데이터 열람권)

export default async function AccountPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  // PC-OFF: 내 기기와 내 기록(본인 것만). 기존 카드 데이터와 무관하게 따로 조회한다.
  // 관리자 발급 PC가 해제돼도 이 기간 동안은 직원 화면에 "해제됨"으로 남긴다(재검수 M-b).
  const adminPairShownSince = new Date();
  adminPairShownSince.setDate(adminPairShownSince.getDate() - 90);
  const [myDevices, myEvents] = await Promise.all([
    prisma.agentDevice.findMany({
      // 지금 연결된 PC + **관리자 발급으로 연결됐다가 90일 안에 해제된 PC**(재검수 M-b, 2026-11-20).
      //  관리자가 대신 연결해 기록을 만든 뒤 해제하면 직원 화면에서 바로 사라져 직원이 알 수 없었다.
      where: {
        userId: me.id, companyId: me.companyId,
        OR: [
          { revokedAt: null },
          { pairedByAdminId: { not: null }, revokedAt: { gte: adminPairShownSince } },
        ],
      },
      select: { id: true, deviceName: true, pairedAt: true, lastSeenAt: true, revokedAt: true, pairedByAdminId: true, pairedByAdminName: true },
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

      {/* 🔑 회사 계정 전용 — 복구용 연락처. 회사 계정은 관리자도 대신 되찾아 줄 수 없어
          이 번호가 유일한 복구 수단이다(상세는 actions/account.ts changeRecoveryPhone 주석). */}
      {me.isOwner && (
        <RecoveryPhoneCard
          maskedPhone={me.phone ? maskPhone(me.phone) : null}
          // ⚠️ 이미 저장된 번호가 유선(02·070 등)일 수 있다 — 가입 검증이 숫자 9~11자리만 봤기 때문.
          //    "등록돼 있으니 안심"하다가 정작 필요할 때 문자를 못 받는 사고를 막는다(검수 치명 3).
          usable={isMobilePhone(me.phone)}
          // ⚠️ 문자 설정 여부가 아니라 **회사 계정 복구 개방 여부**로 판단한다(검수 치명 2).
          recoveryEnabled={OWNER_RECOVERY_ENABLED}
        />
      )}

      {/* PC-OFF 연결 — 기존 두 카드 아래에 추가(기존 카드는 그대로) */}
      {/* 🔒 회사 계정에는 카드를 아예 그리지 않는다 — 연결코드 발급이 거부되므로 버튼만 남으면 무반응이 된다(검수 경미 2) */}
      {!me.isOwner && (
      <div style={{ marginTop: 16 }}>
        <PcLinkCard
          pcOffOn={me.company.pcOffOn}
          exempt={me.pcOffExempt}
          devices={myDevices.map((d) => ({
            id: d.id,
            deviceName: d.deviceName,
            pairedAt: d.pairedAt.toISOString(),
            lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
            online: !d.revokedAt && isDeviceOnline(d.lastSeenAt),
            // 관리자가 대신 발급한 코드로 연결됐으면 그 관리자 이름(없으면 null) — 직원도 알 수 있게(2026-11-20)
            pairedByAdmin: d.pairedByAdminId ? (d.pairedByAdminName ?? "") : null,
            revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
          }))}
          events={myEvents.map((e) => ({
            id: e.id, type: e.type, at: e.at.toISOString(), meta: e.meta, deviceName: e.device.deviceName,
          }))}
        />
      </div>
      )}
    </AppShell>
  );
}
