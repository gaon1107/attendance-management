// 신청서 첨부파일 열람/다운로드(GET) + 삭제(DELETE) — 회사 격리·권한 확인 후 처리.
//  · GET: 신청자 본인 / 관리자 / 그 신청의 결재자만 열람 가능.
//  · DELETE: 신청자 본인이 자기 대기(pending) 신청의 첨부를 제거할 때만.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { isAttachableType, readAttachmentFile, deleteAttachmentFile } from "@/lib/request-attachment";
import { canViewRequestAttachments, canAttachToRequest } from "@/lib/request-attachment-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await params;
  // 회사 격리 — 반드시 내 회사 첨부만
  const att = await prisma.requestAttachment.findFirst({ where: { id, companyId: me.companyId } });
  if (!att || !isAttachableType(att.requestType)) return NextResponse.json({ message: "첨부를 찾을 수 없습니다." }, { status: 404 });

  // 권한: 본인/관리자/결재자
  if (!(await canViewRequestAttachments(me, att.requestType, att.requestId))) {
    return NextResponse.json({ message: "열람 권한이 없습니다." }, { status: 403 });
  }

  try {
    const buf = await readAttachmentFile(att.companyId, att.storedName);
    const encoded = encodeURIComponent(att.originalName);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[request-attachment] 열람 실패:", e);
    return NextResponse.json({ message: "파일을 여는 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const att = await prisma.requestAttachment.findFirst({ where: { id, companyId: me.companyId } });
  if (!att || !isAttachableType(att.requestType)) return NextResponse.json({ message: "첨부를 찾을 수 없습니다." }, { status: 404 });

  // 삭제는 본인이 자기 '대기' 신청의 첨부일 때만(처리된 신청의 근거 파일은 못 지운다).
  if (!(await canAttachToRequest(me, att.requestType, att.requestId))) {
    return NextResponse.json({ message: "본인의 대기 중인 신청 첨부만 삭제할 수 있습니다." }, { status: 403 });
  }

  await prisma.requestAttachment.deleteMany({ where: { id: att.id, companyId: me.companyId } });
  await deleteAttachmentFile(att.companyId, att.storedName);
  return NextResponse.json({ ok: true });
}
