"use server";
// 개인 결재선(custom 모드) 저장/삭제 — 직원이 신청 종류별로 자기 결재자 순서를 저장한다.
//  · 저장된 라인은 신청 시 createApprovalStepsIfNeeded(custom)가 로드해 자동 적용한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { isRequestType, filterActiveApprovers, type RequestType } from "@/lib/approval-server";

// 신청유형 → 신청 페이지 경로(저장 후 갱신용).
const PATH: Record<RequestType, string> = {
  leave: "/leave",
  correction: "/corrections",
  outing: "/outing",
  remote: "/remote",
  overtime: "/overtime",
  trip: "/trip",
};

// 직원: 특정 신청 종류의 내 결재선 저장. 결재자 없으면(빈 값) 저장된 라인을 삭제(미설정으로).
export async function saveApprovalLine(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const requestType = String(formData.get("requestType") ?? "");
  if (!isRequestType(requestType)) return { error: "신청 종류가 올바르지 않습니다." };

  const raw = String(formData.get("approverIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // 유효 결재자만(같은 회사·재직·본인 제외·중복 제거·최대 5명).
  const ids = await filterActiveApprovers(me.companyId, me.id, raw);

  if (ids.length === 0) {
    // 빈 결재선 = 미설정으로 되돌림(있으면 삭제).
    await prisma.approvalLineTemplate.deleteMany({ where: { userId: me.id, requestType } });
    revalidatePath(PATH[requestType]);
    return { ok: true };
  }

  const csv = ids.join(",");
  await prisma.approvalLineTemplate.upsert({
    where: { userId_requestType: { userId: me.id, requestType } },
    update: { approverIdsCsv: csv, companyId: me.companyId },
    create: { companyId: me.companyId, userId: me.id, requestType, approverIdsCsv: csv },
  });
  revalidatePath(PATH[requestType]);
  return { ok: true };
}
