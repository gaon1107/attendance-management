// 회사정보 (관리자 전용) — 회사 상세정보 입력/수정 + 첨부문서 관리.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { CompanyInfoForm } from "./CompanyInfoForm";

export default async function CompanyPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const c = me.company; // getCurrentUser가 회사 정보를 함께 로드함

  return (
    <AppShell user={me} active="company" title="회사정보" subtitle={`${c.name} · 관리자 ${me.name}`}>
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
      {/* 첨부문서 카드는 5단계에서 추가 */}
    </AppShell>
  );
}
