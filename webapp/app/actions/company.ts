"use server";
// 회사 상세정보 관리 — 관리자만. [회사정보] 화면에서 회사명·사업자정보·주소·연락처·담당자·비고를 저장한다.
// 첨부문서(업로드/삭제)는 5단계에서 이 파일에 추가된다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 문자열 정리: 앞뒤 공백 제거, 빈 값이면 null, 길이 상한 적용.
function clean(v: FormDataEntryValue | null, max = 200): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

export async function saveCompanyInfo(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  // 회사명은 필수(다른 화면 상단에도 표시됨). 나머지는 선택.
  const name = clean(formData.get("name"), 100);
  if (!name) {
    return { error: "회사명은 필수입니다." };
  }

  // 이메일은 값이 있을 때만 형식 검증(빈 값 허용).
  const companyEmail = clean(formData.get("companyEmail"));
  const managerEmail = clean(formData.get("managerEmail"));
  if (companyEmail && !EMAIL_RE.test(companyEmail)) {
    return { error: "대표 이메일 형식을 확인해주세요." };
  }
  if (managerEmail && !EMAIL_RE.test(managerEmail)) {
    return { error: "담당 이메일 형식을 확인해주세요." };
  }

  await prisma.company.update({
    where: { id: me.companyId }, // 회사 격리: 본인 회사만 수정
    data: {
      name,
      // 기본정보
      bizRegNo: clean(formData.get("bizRegNo"), 40),
      corpRegNo: clean(formData.get("corpRegNo"), 40),
      ceoName: clean(formData.get("ceoName"), 60),
      bizType: clean(formData.get("bizType"), 100),
      bizItem: clean(formData.get("bizItem"), 100),
      // 주소·연락처
      zipCode: clean(formData.get("zipCode"), 20),
      address: clean(formData.get("address"), 300),
      addressDetail: clean(formData.get("addressDetail"), 300),
      companyPhone: clean(formData.get("companyPhone"), 40),
      companyFax: clean(formData.get("companyFax"), 40),
      companyEmail,
      website: clean(formData.get("website"), 200),
      // 담당자
      managerName: clean(formData.get("managerName"), 60),
      managerTitle: clean(formData.get("managerTitle"), 60),
      managerPhone: clean(formData.get("managerPhone"), 40),
      managerEmail,
      // 기타
      companyNote: clean(formData.get("companyNote"), 1000),
    },
  });

  revalidatePath("/company");
  return { ok: true };
}
