// 회사정보 (관리자 전용) — 회사 상세정보 입력/수정 + 첨부문서 관리.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { CompanyInfoForm } from "./CompanyInfoForm";
import { CompanyDocsForm, type DocView } from "./CompanyDocsForm";
import { CompanyLogoForm } from "./CompanyLogoForm";

// 바이트 → 사람이 읽는 크기
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function CompanyPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const c = me.company; // getCurrentUser가 회사 정보를 함께 로드함

  const docs = await prisma.companyDocument.findMany({
    where: { companyId: me.companyId },
    orderBy: { uploadedAt: "desc" },
  });
  const docViews: DocView[] = docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    originalName: d.originalName,
    sizeText: sizeText(d.size),
    uploadedAtText: d.uploadedAt.toLocaleString("ko-KR"),
  }));

  return (
    <AppShell user={me} active="company" title="회사정보" subtitle={`${c.name} · 관리자 ${me.name}`}>
      <CompanyLogoForm hasLogo={!!c.logoName} version={c.logoName ?? ""} />
      <CompanyInfoForm
        initial={{
          name: c.name,
          bizRegNo: c.bizRegNo,
          corpRegNo: c.corpRegNo,
          ceoName: c.ceoName,
          bizType: c.bizType,
          bizItem: c.bizItem,
          zipCode: c.zipCode,
          address: c.address,
          addressDetail: c.addressDetail,
          companyPhone: c.companyPhone,
          companyFax: c.companyFax,
          companyEmail: c.companyEmail,
          website: c.website,
          managerName: c.managerName,
          managerTitle: c.managerTitle,
          managerPhone: c.managerPhone,
          managerEmail: c.managerEmail,
          companyNote: c.companyNote,
        }}
      />
      <div style={{ marginTop: 4 }}>
        <CompanyDocsForm initialDocs={docViews} />
      </div>
    </AppShell>
  );
}
