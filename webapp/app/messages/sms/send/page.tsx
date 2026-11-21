// 메시지 발송(관리자 전용) — 직원을 골라 문자를 보낸다. 메시지 관리 3-2b.
//  · 실제로 **요금이 나가는** 화면이다. 안전장치는 서버 액션(app/actions/sms-send.ts) 머리말 참고.
//  · 회사 격리: 받는 사람 후보는 내 회사 재직 직원만. 템플릿도 내 회사 것만.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { MessageTabs } from "@/app/messages/MessageTabs";
import { companySmsReady } from "@/lib/company-sms-account";
import { isMobilePhone, toLocalPhone } from "@/lib/phone";
import { DEFAULT_TEMPLATES, SEND_MAX_RECIPIENTS } from "@/lib/sms-templates";
import { SendClient, type Recipient, type PickTemplate } from "./SendClient";

export default async function SmsSendPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const [users, templates, smsReady] = await Promise.all([
    prisma.user.findMany({
      // 회사 계정(isOwner)은 사람이 아니다 — 이 제품은 직원 목록에서 늘 뺀다. 그 번호는 복구용 연락처라 공지 대상도 아니다.
      where: { companyId: me.companyId, deactivatedAt: null, isOwner: false },
      select: { id: true, name: true, phone: true, employeeNo: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.smsTemplate.findMany({
      where: { companyId: me.companyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, body: true },
    }),
    companySmsReady(me.companyId),
  ]);

  const recipients: Recipient[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    employeeNo: u.employeeNo ?? null,
    department: u.department?.name ?? "부서 없음",
    // 휴대폰 번호가 없거나 유선번호면 문자를 받을 수 없다 — 고를 수 없게 하고 이유를 보여 준다.
    canReceive: isMobilePhone(toLocalPhone(u.phone)),
  }));

  // 회사가 만든 것 + 가온 기본 문구. 화면에서는 한 목록으로 고른다(기본 문구는 "기본" 표시).
  const picks: PickTemplate[] = [
    ...templates.map((t) => ({ id: t.id, name: t.name, body: t.body, isDefault: false })),
    ...DEFAULT_TEMPLATES.map((d) => ({ id: `default:${d.id}`, name: d.name, body: d.body, isDefault: true })),
  ];

  return (
    <AppShell user={me} active="messages-sms" title="문자 관리" subtitle={me.company.name}>
      <MessageTabs active="send" />
      <SendClient
        recipients={recipients}
        templates={picks}
        companyName={me.company.name}
        smsReady={smsReady}
        maxRecipients={SEND_MAX_RECIPIENTS}
      />
    </AppShell>
  );
}
