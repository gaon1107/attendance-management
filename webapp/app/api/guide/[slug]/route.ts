// [관리자 전용] 고객사 사용 안내서 열람·내려받기 — 로그인 확인 후 webapp/guide-files 의 사본을 내려준다.
//  · 주소 끝에 `?download=1` 이 붙으면 **파일로 저장**, 없으면 **새 탭에서 바로 보기**.
//  · 만드는 방식은 기존 [회사 문서] 통로(app/api/company-doc/[id]/route.ts)와 같게 맞췄다(새 방식을 만들지 않는다).
//  · 안내서는 **우리가 만든 파일**이고 움직이는 코드(script)가 0개다(글·그림만) → 우리 주소에서 그대로 보여도 안전하다.
//    ⚠️ 나중에 안내서에 script 를 넣게 되면 그 코드는 우리 사이트 권한으로 돌게 되므로 이 전제를 다시 검토할 것.
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getCurrentUser } from "@/lib/session";
import { guideBySlug, guidePath } from "@/lib/guide";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const me = await getCurrentUser();
  // ⚠️ 이 주소는 화면의 <a href>로 **브라우저가 직접 여는** 링크다(대시보드 [사용 안내서] 카드).
  //    로그인이 풀린 뒤 클릭하면 새 탭에 날 텍스트(JSON)만 뜨므로 로그인 화면으로 보낸다(사람이 여는 GET).
  if (!me) return NextResponse.redirect(new URL("/login", req.url));
  if (me.role !== "admin") return NextResponse.json({ message: "관리자만 볼 수 있습니다." }, { status: 403 });

  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return NextResponse.json({ message: "안내서를 찾을 수 없습니다." }, { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";

  try {
    const buf = await fs.readFile(guidePath(guide));
    // 한글 파일명을 안전하게 전달 — RFC 5987 인코딩(회사문서 통로와 같은 방식)
    const encoded = encodeURIComponent(guide.file);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
        // **로그인해야 받는 파일**이므로 어디에도 남기지 않는다(회사문서 통로와 같은 값).
        // 공용 PC 에서 로그아웃한 뒤 뒤로가기로 다시 열리는 일을 막는다.
        "Cache-Control": "no-store, private",
        // 브라우저가 내용을 보고 파일 종류를 멋대로 추측(MIME 스니핑)하지 못하게 막는다.
        "X-Content-Type-Options": "nosniff",
        // 🔒 화면에 띄울 때는 **이 문서가 할 수 있는 일을 글·그림·글자모양으로 못 박는다**(검수 중간 5).
        //    지금 안내서에는 움직이는 코드가 0개지만, 안내서 원본은 사람이 손으로 쓰는 HTML 이라
        //    나중에 누가 스크립트 한 줄(또는 외부에서 복사한 조각)을 넣으면 **우리 사이트 권한으로** 돌게 된다.
        //    `sandbox` 로 권한을 떼고 바깥 연결을 전부 막아, 그 사고가 일어날 수 없게 미리 묶어 둔다.
        //    (내려받는 응답에는 붙이지 않는다 — 파일로 저장될 뿐 화면에 그려지지 않는다.)
        ...(download
          ? {}
          : {
              "Content-Security-Policy":
                "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:",
            }),
      },
    });
  } catch (e) {
    console.error("[guide] 안내서 열람 실패:", e);
    return NextResponse.json({ message: "안내서를 여는 중 오류가 발생했습니다." }, { status: 500 });
  }
}
