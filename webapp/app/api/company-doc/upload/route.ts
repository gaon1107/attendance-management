// [관리자 전용] 회사 첨부문서 업로드 — 종류(kind)별 최신 1건만 유지(재업로드 시 기존 파일·기록 교체).
// ※ 서버 액션(본문 4MB 한도) 대신 라우트 핸들러로 받아 최대 10MB 파일을 허용한다.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import {
  saveCompanyDoc,
  deleteCompanyDocFile,
  detectMime,
  MAX_SIZE,
  DOC_KIND_KEYS,
} from "@/lib/company-doc";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ message: "관리자만 업로드할 수 있습니다." }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ message: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");

  if (!DOC_KIND_KEYS.includes(kind)) {
    return NextResponse.json({ message: "문서 종류가 올바르지 않습니다." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "파일을 선택해주세요." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ message: "파일 크기는 10MB 이하만 가능합니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // 멀티파트 파싱 후 실제 크기 기준으로 재확인
  if (buffer.length === 0 || buffer.length > MAX_SIZE) {
    return NextResponse.json({ message: "파일 크기는 10MB 이하만 가능합니다." }, { status: 400 });
  }
  // 신고된 MIME(file.type)은 조작 가능 → 실제 파일 내용(매직바이트)으로 판별한다.
  const mime = detectMime(buffer);
  if (!mime) {
    return NextResponse.json({ message: "PDF·JPG·PNG 파일만 올릴 수 있습니다." }, { status: 400 });
  }

  let storedName: string;
  try {
    storedName = await saveCompanyDoc(me.companyId, buffer, mime);
  } catch (e) {
    console.error("[company-doc] 저장 실패:", e);
    return NextResponse.json({ message: "파일 저장 중 오류가 발생했습니다." }, { status: 500 });
  }

  try {
    // 같은 종류의 기존 문서를 찾아(교체 시 이전 파일 삭제용) 저장한다.
    // (companyId, kind) 유니크 제약 + upsert로 동시 업로드 시에도 중복 레코드가 생기지 않는다.
    const prev = await prisma.companyDocument.findUnique({
      where: { companyId_kind: { companyId: me.companyId, kind } },
    });

    await prisma.companyDocument.upsert({
      where: { companyId_kind: { companyId: me.companyId, kind } },
      update: {
        originalName: file.name.slice(0, 255),
        storedName,
        mimeType: mime,
        size: buffer.length,
        uploadedBy: me.name,
        uploadedAt: new Date(),
      },
      create: {
        companyId: me.companyId,
        kind,
        originalName: file.name.slice(0, 255),
        storedName,
        mimeType: mime,
        size: buffer.length,
        uploadedBy: me.name,
      },
    });

    // 레코드가 새 파일로 갱신된 뒤 이전 파일 삭제(고아 파일 방지). 파일명이 다를 때만.
    if (prev && prev.storedName !== storedName) await deleteCompanyDocFile(me.companyId, prev.storedName);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[company-doc] 기록 저장 실패:", e);
    // DB 반영에 실패하면 방금 저장한 파일을 정리(고아 파일 방지)
    await deleteCompanyDocFile(me.companyId, storedName);
    return NextResponse.json({ message: "문서 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
