// [관리자 전용] 회사 로고 업로드 — 사이드바에 표시할 이미지. PNG·JPG만, 최대 2MB.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { saveCompanyDoc, deleteCompanyDocFile, detectMime } from "@/lib/company-doc";

const MAX_LOGO = 2 * 1024 * 1024; // 2MB

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

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "파일을 선택해주세요." }, { status: 400 });
  }
  if (file.size > MAX_LOGO) {
    return NextResponse.json({ message: "로고는 2MB 이하 이미지만 가능합니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_LOGO) {
    return NextResponse.json({ message: "로고는 2MB 이하 이미지만 가능합니다." }, { status: 400 });
  }
  // 실제 내용으로 형식 판별 — 로고는 이미지(PNG·JPG)만 허용(PDF 등 거부)
  const mime = detectMime(buffer);
  if (mime !== "image/png" && mime !== "image/jpeg") {
    return NextResponse.json({ message: "PNG 또는 JPG 이미지만 올릴 수 있습니다." }, { status: 400 });
  }

  const prev = await prisma.company.findUnique({ where: { id: me.companyId }, select: { logoName: true } });

  let storedName: string;
  try {
    storedName = await saveCompanyDoc(me.companyId, buffer, mime);
  } catch (e) {
    console.error("[company-logo] 저장 실패:", e);
    return NextResponse.json({ message: "로고 저장 중 오류가 발생했습니다." }, { status: 500 });
  }

  try {
    await prisma.company.update({ where: { id: me.companyId }, data: { logoName: storedName } });
    // 이전 로고 파일 삭제(교체)
    if (prev?.logoName && prev.logoName !== storedName) await deleteCompanyDocFile(me.companyId, prev.logoName);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[company-logo] 기록 저장 실패:", e);
    await deleteCompanyDocFile(me.companyId, storedName); // 고아 파일 방지
    return NextResponse.json({ message: "로고 정보를 저장하지 못했습니다." }, { status: 500 });
  }
}
