// [신청서 첨부] DB 로직 — 소유/권한 확인·정리. (회사격리 필수)
//  · 저장 파일 자체는 lib/request-attachment.ts.
import { prisma } from "@/lib/db";
import { type AttachableType, deleteAttachmentFile } from "@/lib/request-attachment";

type Me = { id: string; role: string; companyId: string };

// 신청유형+id로 원본 신청의 소유자(userId)·상태(status)를 조회한다. 없으면 null. (회사격리)
export async function loadRequestOwner(
  companyId: string,
  requestType: AttachableType,
  requestId: string,
): Promise<{ userId: string; status: string } | null> {
  const where = { id: requestId, companyId };
  const select = { userId: true, status: true };
  switch (requestType) {
    case "outing": return prisma.outingRequest.findFirst({ where, select });
    case "remote": return prisma.remoteWorkRequest.findFirst({ where, select });
    case "overtime": return prisma.overtimeRequest.findFirst({ where, select });
    case "trip": return prisma.businessTripRequest.findFirst({ where, select });
    default: return null;
  }
}

// 업로드 권한: 내가 이 신청의 소유자이고 아직 대기(pending) 상태여야 첨부할 수 있다.
export async function canAttachToRequest(me: Me, requestType: AttachableType, requestId: string): Promise<boolean> {
  const owner = await loadRequestOwner(me.companyId, requestType, requestId);
  return !!owner && owner.userId === me.id && owner.status === "pending";
}

// 다운로드/열람 권한: 회사가 같고 (신청자 본인 OR 관리자 OR 이 신청의 결재자)면 허용.
export async function canViewRequestAttachments(me: Me, requestType: AttachableType, requestId: string): Promise<boolean> {
  const owner = await loadRequestOwner(me.companyId, requestType, requestId);
  if (!owner) return false;
  if (owner.userId === me.id) return true;      // 신청자 본인
  if (me.role === "admin") return true;          // 관리자
  // 부서장 결재선: 이 신청의 결재 단계에 내가 결재자로 포함돼 있으면 열람 가능(대기/처리 무관).
  const step = await prisma.approvalStep.findFirst({
    where: { companyId: me.companyId, requestType, requestId, approverUserId: me.id },
    select: { id: true },
  });
  return !!step;
}

// 한 신청의 첨부를 모두 삭제(DB 행 + 실제 파일). 신청 취소 시 호출(고아 방지).
export async function deleteAttachmentsForRequest(companyId: string, requestType: AttachableType, requestId: string): Promise<void> {
  const rows = await prisma.requestAttachment.findMany({
    where: { companyId, requestType, requestId },
    select: { id: true, storedName: true },
  });
  if (rows.length === 0) return;
  await Promise.all(rows.map((r) => deleteAttachmentFile(companyId, r.storedName)));
  await prisma.requestAttachment.deleteMany({ where: { companyId, requestType, requestId } });
}

// 신청들의 첨부 목록(표시용). requestId → 첨부 배열(id·이름·크기).
export type AttachmentInfo = { id: string; originalName: string; size: number; mimeType: string };
export async function getAttachmentsMap(
  companyId: string,
  requestType: AttachableType,
  requestIds: string[],
): Promise<Map<string, AttachmentInfo[]>> {
  const map = new Map<string, AttachmentInfo[]>();
  if (requestIds.length === 0) return map;
  const rows = await prisma.requestAttachment.findMany({
    where: { companyId, requestType, requestId: { in: requestIds } },
    select: { id: true, requestId: true, originalName: true, size: true, mimeType: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    const arr = map.get(r.requestId) ?? [];
    arr.push({ id: r.id, originalName: r.originalName, size: r.size, mimeType: r.mimeType });
    map.set(r.requestId, arr);
  }
  return map;
}
