// [관리자 전용] 출퇴근 촬영 사진 열람 — 암호화 파일을 복호화해 이미지로 내려준다.
// 보호 장치: ① 관리자만 ② 내 회사 사진만(회사 격리) ③ 열람 기록(누가·언제) ④ 파기된 사진은 안내만
//          ⑤ **정상(ok) 확인된 사진은 열람 차단** — 관리자의 상시 감시 우려를 줄인다(개인정보 최소열람).
//            열람 목적은 "부정 방지 재검토"뿐이므로, 재검토가 필요한 위조 의심(suspect)·판독 실패(error)만 연다.
//            ⚠️ 화면 링크를 숨기는 것만으로는 부족하다(URL 직접 접근) — 여기 서버에서 실제로 막아야 한다.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { readClockPhoto, purgeExpiredPhotos, isPhotoExpired } from "@/lib/clock-photo";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { headers } from "next/headers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  // ⚠️ 화면의 <a href>로 **브라우저가 직접 여는** 링크다(DetailTable.tsx). 로그인이 풀린 뒤 클릭하면
  //    날 JSON이 새 탭에 뜬다(검수 중간 5) → 로그인 화면으로 보낸다.
  if (!me) return NextResponse.redirect(new URL("/login", _req.url));
  if (me.role !== "admin") return NextResponse.json({ message: "관리자만 볼 수 있습니다." }, { status: 403 });

  const { id } = await params;
  // 회사 격리 — 반드시 내 회사 사진만
  //  · 열람기록에 "누구의 사진인지"를 남기려고 대상 직원 이름을 함께 읽는다(검수 M-18).
  const photo = await prisma.clockPhoto.findFirst({
    where: { id, companyId: me.companyId },
    include: { attendance: { select: { user: { select: { name: true } } } } },
  });
  if (!photo) return NextResponse.json({ message: "사진 기록을 찾을 수 없습니다." }, { status: 404 });

  // ⑤ 열람은 부정 방지 재검토가 필요한 건(위조 의심·판독 실패)만 허용한다 — 정상 확인 사진은 차단.
  //    ⚠️ **화이트리스트**로 막는다: "정상(ok)만 차단"이 아니라 "suspect·error만 허용".
  //    이유 — 나중에 판정 상태값이 하나라도 늘면(예: pending) 블랙리스트("ok만 차단")는 그 사진을 자동 노출한다.
  //    생체정보 최소열람이 목적이므로, 모르는 상태는 막는 쪽(fail-safe)이 맞다.
  //    화면 링크를 숨겨도 URL로 직접 요청할 수 있으므로 서버에서 실제로 거부한다.
  if (photo.livenessStatus !== "suspect" && photo.livenessStatus !== "error") {
    return NextResponse.json({ message: "정상 확인된 사진은 열람 대상이 아닙니다." }, { status: 403 });
  }

  // 🔴 보관기간 판정은 **날짜로 먼저** 한다(검수 치명 1).
  //    예전엔 "파기 표시가 찍혔는가"만 봤는데, 파기 작업이 아직 그 사진에 도달하지 않았으면
  //    90일이 지난 사진도 열렸다. 파기 진행 상황과 무관하게 기한이 지나면 무조건 막는다.
  if (isPhotoExpired(photo.createdAt)) {
    return NextResponse.json({ message: "보관기간(90일)이 지나 파기된 사진입니다." }, { status: 410 });
  }

  // 열람 전에 보관기간 파기도 함께 돌린다(하루 1회만 실제 동작) — 실제 파일 삭제를 미루지 않기 위함.
  await purgeExpiredPhotos();
  const fresh = await prisma.clockPhoto.findUnique({ where: { id: photo.id }, select: { fileDeletedAt: true } });
  if (photo.fileDeletedAt || fresh?.fileDeletedAt) {
    return NextResponse.json({ message: "보관기간(90일)이 지나 파기된 사진입니다." }, { status: 410 });
  }

  try {
    const jpeg = await readClockPhoto(photo.fileName);
    // 열람 기록 ① 사진 행에 "마지막으로 본 사람" — 화면이 바로 옆에 보여주는 값(기존 동작 유지).
    await prisma.clockPhoto.update({
      where: { id: photo.id },
      data: { lastViewedBy: `${me.name} (${me.email})`, lastViewedAt: new Date() },
    });
    // 열람 기록 ② 🔴 [검수 M-18] **열람할 때마다 접속기록에 1건**을 남긴다.
    //    예전엔 ①만 있어 관리자가 10번 봐도 기록이 1건이었다 — 생체정보 접근이력을 2년 보관하라는
    //    개인정보 안전성 확보조치 기준의 취지를 못 맞춘다(이 파일이 스스로 적어둔 기준과도 모순이었다).
    //    ⚠️ 기록이 실패해도 열람 자체는 막지 않는다(lib/audit.ts 원칙 ①과 동일).
    try {
      const { ip, userAgent } = readClientMeta(await headers());
      await recordAccess({
        companyId: me.companyId,
        userId: me.id,
        actorName: me.name,
        kind: "data_view",
        result: "success",
        ip,
        userAgent,
        // 누구의 사진을 봤는지가 감사의 핵심이다(파기 기록과 같은 예외 — lib/audit.ts 원칙 ②).
        //  · 사진 id 끝 6자를 붙여 **어떤 사진**을 봤는지도 특정할 수 있게 한다(같은 사람 사진이 여러 장이므로).
        meta: `clock_photo:${photo.attendance.user.name} (${photo.id.slice(-6)})`,
      });
    } catch (e) {
      console.warn("[clock-photo] 열람 기록 실패(열람은 정상 처리됨):", e);
    }
    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // 생체정보 — 브라우저·중간 캐시에 남기지 않는다
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    // 파일이 없으면 관리자에게는 "파기됨"으로 안내한다(파기 중 서버가 멈춰 표시가 안 찍힌 경우 등).
    //  🔴 단, **DB에 파기 표시를 자동으로 찍지는 않는다**(검수 치명).
    //     "파일 하나가 없다"와 "저장 폴더가 통째로 안 잡혔다"가 같은 오류(ENOENT)로 오는데,
    //     후자는 배포 경로가 어긋난 것일 뿐 사진은 예전 폴더에 멀쩡히 살아 있다.
    //     그때 파기 표시를 찍으면 위조의심 증거 사진이 **되돌릴 수 없이** 봉인되고
    //     파기 대장에는 "파기함"이라는 거짓이 남는다.
    //     ("폴더가 있는지" 확인으로도 못 막는다 — 얼굴 출퇴근이 1건만 저장되면
    //      저장 로직이 그 잘못된 경로에 폴더를 자동으로 만들어 버린다)
    //     그래서 자동 보정 대신 **로그만 남겨 사람이 확인**하게 한다.
    if (e && typeof e === "object" && (e as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        `[clock-photo] 사진 파일이 없습니다 — 파기 표시는 찍지 않습니다(사람 확인 필요). ` +
          `사진 ${photo.id}, 파일 ${photo.fileName}. 저장 폴더 설정(CLOCK_PHOTO_DIR)이 바뀌지 않았는지 확인하세요.`,
      );
      // ⚠️ 여기까지 온 사진은 위에서 이미 "90일 안 지났고 파기 표시도 없음"이 확인된 것이다.
      //    그런데 파일이 없다 = 정상 파기가 아니라 **비정상 상황**(저장 폴더 오설정·파일 유실).
      //    이걸 "파기되었습니다"로 안내하면 관리자가 정상 절차로 오해해 조사를 끝내버린다(검수 치명).
      return NextResponse.json(
        { message: "사진 파일을 찾을 수 없습니다. 아직 보관기간(90일) 안의 사진이므로 관리자 확인이 필요합니다." },
        { status: 500 },
      );
    }
    console.error("[clock-photo] 열람 실패:", e);
    return NextResponse.json({ message: "사진을 여는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
