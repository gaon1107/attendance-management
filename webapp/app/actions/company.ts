"use server";
// 회사 상세정보 관리 — 관리자만. [회사정보] 화면에서 회사명·사업자정보·주소·연락처·담당자·비고를 저장한다.
// 첨부문서: 업로드는 라우트(/api/company-doc/upload, 대용량), 삭제는 아래 서버 액션.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { deleteCompanyDocFile } from "@/lib/company-doc";
import { isValidBizRegNoFormat, formatBizRegNo } from "@/lib/bizreg";

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

  // 사업자등록번호는 가입 때와 **같은 표기**(123-45-67890)로 맞춰 저장한다.
  //  · 표기가 제각각이면 가입 시 중복 검사가 그냥 통과한다(검수 7).
  //  · 🔴 번호가 바뀌면 "국세청 확인됨" 표시를 지운다. 안 그러면 남의 회사 번호로 바꿔도
  //    초록색 확인 뱃지가 그대로 남아 **거짓 표시**가 된다.
  const rawBizNo = clean(formData.get("bizRegNo"), 40);
  const nextBizNo = rawBizNo && isValidBizRegNoFormat(rawBizNo) ? formatBizRegNo(rawBizNo) : rawBizNo;
  const prev = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { bizRegNo: true },
  });
  const bizNoChanged = (prev?.bizRegNo ?? null) !== (nextBizNo ?? null);

  await prisma.company.update({
    where: { id: me.companyId }, // 회사 격리: 본인 회사만 수정
    data: {
      name,
      // 기본정보
      bizRegNo: nextBizNo,
      ...(bizNoChanged ? { bizRegNoVerifiedAt: null } : {}),
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

// 첨부문서 삭제 — 관리자만, 내 회사 문서만(회사 격리). DB 기록과 실제 파일을 함께 지운다.
export async function deleteCompanyDoc(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "문서를 찾을 수 없습니다." };

  const doc = await prisma.companyDocument.findFirst({
    where: { id, companyId: me.companyId }, // 회사 격리
  });
  if (!doc) return { error: "문서를 찾을 수 없습니다." };

  await prisma.companyDocument.delete({ where: { id: doc.id } });
  await deleteCompanyDocFile(me.companyId, doc.storedName);

  revalidatePath("/company");
  return { ok: true };
}

// 회사 로고 삭제 — 관리자만. Company.logoName을 비우고 파일도 지운다. 사이드바는 "근" 글자로 되돌아간다.
export async function deleteCompanyLogo(
  _prev: { error?: string; ok?: boolean }
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const c = await prisma.company.findUnique({ where: { id: me.companyId }, select: { logoName: true } });
  // DB를 먼저 비운 뒤 파일을 지운다. (반대로 하면 파일만 없고 logoName이 남아,
  //  사이드바가 폴백('근') 대신 깨진 이미지를 전 화면에 띄우는 사고가 난다.)
  await prisma.company.update({ where: { id: me.companyId }, data: { logoName: null } });
  if (c?.logoName) await deleteCompanyDocFile(me.companyId, c.logoName);

  revalidatePath("/company");
  return { ok: true };
}
