// [관리자 전용] 회사 첨부문서 열람/다운로드 — 회사 격리·인증 확인 후 파일을 내려준다.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { readCompanyDoc } from "@/lib/company-doc";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ message: "관리자만 볼 수 있습니다." }, { status: 403 });

  const { id } = await params;
  // 회사 격리 — 반드시 내 회사 문서만
  const doc = await prisma.companyDocument.findFirst({ where: { id, companyId: me.companyId } });
  if (!doc) return NextResponse.json({ message: "문서를 찾을 수 없습니다." }, { status: 404 });

  try {
    const buf = await readCompanyDoc(doc.companyId, doc.storedName);
    // 원본 파일명(한글 포함)을 안전하게 전달 — RFC 5987 인코딩
    const encoded = encodeURIComponent(doc.originalName);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    console.error("[company-doc] 열람 실패:", e);
    return NextResponse.json({ message: "문서를 여는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
