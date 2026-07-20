// [직원] 신청서 첨부파일 업로드 — 본인의 대기(pending) 신청에만, 신청당 최대 5개.
// ※ 서버 액션(본문 4MB 한도) 대신 라우트 핸들러로 받아 파일당 최대 10MB를 허용한다.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { detectMime, MAX_SIZE } from "@/lib/company-doc";
import { isAttachableType, MAX_FILES, saveAttachmentFile, deleteAttachmentFile } from "@/lib/request-attachment";
import { canAttachToRequest } from "@/lib/request-attachment-server";

// 요청 본문 상한(메모리 DoS 방어) — 파일 최대개수×개당한도 + 멀티파트 오버헤드 여유.
const MAX_BODY = MAX_FILES * MAX_SIZE + 2 * 1024 * 1024;

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });

  // 본문을 메모리로 버퍼링(formData)하기 전에 Content-Length로 조기 거부한다(초대형 업로드 OOM 방지).
  const lenHeader = req.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_BODY) {
    return NextResponse.json({ message: "업로드 용량이 너무 큽니다." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ message: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const requestType = String(form.get("requestType") ?? "");
  const requestId = String(form.get("requestId") ?? "");
  if (!isAttachableType(requestType)) return NextResponse.json({ message: "첨부할 수 없는 신청 유형입니다." }, { status: 400 });
  if (!/^[a-z0-9]+$/i.test(requestId)) return NextResponse.json({ message: "잘못된 신청입니다." }, { status: 400 });

  // 본인의 대기 신청인지 확인(남의 신청·처리완료 건에는 첨부 불가).
  if (!(await canAttachToRequest(me, requestType, requestId))) {
    return NextResponse.json({ message: "본인의 대기 중인 신청에만 첨부할 수 있습니다." }, { status: 403 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ message: "파일을 선택해주세요." }, { status: 400 });

  // 개수 상한: 기존 첨부 + 이번 업로드가 MAX_FILES를 넘지 않아야 한다.
  const existing = await prisma.requestAttachment.count({ where: { companyId: me.companyId, requestType, requestId } });
  if (existing + files.length > MAX_FILES) {
    return NextResponse.json({ message: `첨부는 신청당 최대 ${MAX_FILES}개까지 가능합니다. (현재 ${existing}개)` }, { status: 400 });
  }

  // 각 파일 검증(크기·매직바이트 형식) 후 저장. 하나라도 실패하면 이번에 저장한 파일을 되돌린다(부분 저장 방지).
  const saved: { storedName: string; originalName: string; mime: string; size: number }[] = [];
  try {
    for (const file of files) {
      if (file.size > MAX_SIZE) return NextResponse.json({ message: "파일 크기는 10MB 이하만 가능합니다." }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_SIZE) return NextResponse.json({ message: "파일 크기는 10MB 이하만 가능합니다." }, { status: 400 });
      const mime = detectMime(buffer);
      if (!mime) return NextResponse.json({ message: "PDF·JPG·PNG 파일만 올릴 수 있습니다." }, { status: 400 });
      const storedName = await saveAttachmentFile(me.companyId, buffer, mime);
      saved.push({ storedName, originalName: file.name.slice(0, 255), mime, size: buffer.length });
    }
  } catch (e) {
    console.error("[request-attachment] 저장 실패:", e);
    await Promise.all(saved.map((s) => deleteAttachmentFile(me.companyId, s.storedName)));
    return NextResponse.json({ message: "파일 저장 중 오류가 발생했습니다." }, { status: 500 });
  }

  try {
    // 개수 상한을 원자적으로 강제 — 트랜잭션 안에서 재조회 후 삽입(동시 업로드가 5개를 넘기지 못하게).
    // (SQLite는 쓰기를 직렬화하므로 트랜잭션이 경합을 순서화한다.)
    await prisma.$transaction(async (tx) => {
      const now = await tx.requestAttachment.count({ where: { companyId: me.companyId, requestType, requestId } });
      if (now + saved.length > MAX_FILES) throw new Error("ATTACH_LIMIT");
      await tx.requestAttachment.createMany({
        data: saved.map((s) => ({
          companyId: me.companyId,
          requestType,
          requestId,
          originalName: s.originalName,
          storedName: s.storedName,
          mimeType: s.mime,
          size: s.size,
          uploadedBy: me.name,
        })),
      });
    });
    return NextResponse.json({ ok: true, count: saved.length });
  } catch (e) {
    // 삽입 실패(경합으로 상한 초과 포함) → 방금 저장한 파일 정리(고아 방지).
    await Promise.all(saved.map((s) => deleteAttachmentFile(me.companyId, s.storedName)));
    if (e instanceof Error && e.message === "ATTACH_LIMIT") {
      return NextResponse.json({ message: `첨부는 신청당 최대 ${MAX_FILES}개까지 가능합니다.` }, { status: 400 });
    }
    console.error("[request-attachment] 기록 저장 실패:", e);
    return NextResponse.json({ message: "첨부 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
