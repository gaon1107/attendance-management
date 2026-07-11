// [관리자 전용] 출퇴근 촬영 사진 열람 — 암호화 파일을 복호화해 이미지로 내려준다.
// 보호 장치: ① 관리자만 ② 내 회사 사진만(회사 격리) ③ 열람 기록(누가·언제) ④ 파기된 사진은 안내만.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { readClockPhoto, purgeExpiredPhotos } from "@/lib/clock-photo";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ message: "관리자만 볼 수 있습니다." }, { status: 403 });

  const { id } = await params;
  // 회사 격리 — 반드시 내 회사 사진만
  const photo = await prisma.clockPhoto.findFirst({ where: { id, companyId: me.companyId } });
  if (!photo) return NextResponse.json({ message: "사진 기록을 찾을 수 없습니다." }, { status: 404 });

  // 열람 전에 보관기간 파기부터(하루 1회만 실제 동작) — 기한 지난 사진이 열리는 일 방지
  await purgeExpiredPhotos();
  const fresh = await prisma.clockPhoto.findUnique({ where: { id: photo.id }, select: { fileDeletedAt: true } });
  if (photo.fileDeletedAt || fresh?.fileDeletedAt) {
    return NextResponse.json({ message: "보관기간(90일)이 지나 파기된 사진입니다." }, { status: 410 });
  }

  try {
    const jpeg = await readClockPhoto(photo.fileName);
    // 열람 기록 — 누가 언제 봤는지(생체정보 접근 통제)
    await prisma.clockPhoto.update({
      where: { id: photo.id },
      data: { lastViewedBy: `${me.name} (${me.email})`, lastViewedAt: new Date() },
    });
    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // 생체정보 — 브라우저·중간 캐시에 남기지 않는다
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    console.error("[clock-photo] 열람 실패:", e);
    return NextResponse.json({ message: "사진을 여는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
