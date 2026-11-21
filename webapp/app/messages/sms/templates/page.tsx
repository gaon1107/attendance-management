// 문자 템플릿 관리(관리자 전용) — 메시지 관리 3-2a.
//  · 자주 쓰는 문구를 저장해 두고 3-2b [메시지 발송]에서 골라 쓴다. 여기서는 **보내지 않는다**.
//  · 기본 템플릿 6개는 DB가 아니라 상수다(lib/sms-templates.ts) — 이유는 그 파일 머리말 참고.
//  · 회사 격리: 우리 회사가 만든 것만 조회한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { MessageTabs } from "@/app/messages/MessageTabs";
import { DEFAULT_TEMPLATES } from "@/lib/sms-templates";
import { TemplatesClient, type TemplateRow } from "./TemplatesClient";

export default async function SmsTemplatesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const list = await prisma.smsTemplate.findMany({
    where: { companyId: me.companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, body: true },
  });

  const rows: TemplateRow[] = list.map((t) => ({ id: t.id, name: t.name, body: t.body }));

  return (
    <AppShell user={me} active="messages-sms" title="문자 관리" subtitle={me.company.name}>
      <MessageTabs active="templates" />
      <TemplatesClient rows={rows} defaults={DEFAULT_TEMPLATES} companyName={me.company.name} />
    </AppShell>
  );
}
