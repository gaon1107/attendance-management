// 회사 로고 표시 — 로그인한 사람은 "자기 회사 로고"만 볼 수 있다(관리자·직원 공통, 회사 격리).
// 사이드바가 <img src="/api/company-logo?v=..."> 로 부른다.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { readCompanyDoc } from "@/lib/company-doc";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });

  const logoName = me.company.logoName;
  if (!logoName) return NextResponse.json({ message: "로고가 없습니다." }, { status: 404 });

  try {
    const buf = await readCompanyDoc(me.companyId, logoName);
    const contentType = logoName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // 회사 로고는 자주 바뀌지 않지만, 교체 시 즉시 반영되도록 재검증 캐시. 회사 격리라 private.
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[company-logo] 열람 실패:", e);
    return NextResponse.json({ message: "로고를 여는 중 오류가 발생했습니다." }, { status: 404 });
  }
}
