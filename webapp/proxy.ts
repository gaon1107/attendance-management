// 운영자(본사) 백오피스 앞의 **1차 관문**. 2026-08-18 신설 (검수 M-4).
//
// 🔴 왜 만들었나 — "빠뜨렸을 때의 결과"를 안전한 쪽으로 바꾸는 그물이다.
//    `/operator` 아래 화면은 회사 칸막이(companyId 격리)를 넘어 **전체 회원사**를 본다.
//    지금은 각 page 맨 위에서 getCurrentOperator()로 막고 있는데(그게 정석이다 — Next의 layout은
//    page와 나란히 렌더돼 방어가 되지 않는다), 앞으로 화면·내려받기 라우트가 늘어나다가
//    **한 곳이 그 검사를 잊으면 그 화면이 비로그인에게 전체 회원사 데이터를 그대로 내준다.**
//    이 저장소가 이미 겪은 사고 유형이다(lib/session.ts 주석: "AppShell만 막아서 156곳이 뚫렸다").
//
// 🔴 이 관문이 하는 일은 **쿠키가 있는지 보는 것뿐이다.** 유효한지는 보지 않는다.
//    · 여기서 DB를 조회하지 않는 이유: Next 문서가 "proxy는 렌더 코드와 별개로 실행되며 공유
//      모듈·전역에 의존하지 말라"고 명시한다(node_modules/next/dist/docs/.../proxy.md).
//      실제 인증(만료·유휴·계정 끄기 확인)은 그대로 각 page의 getCurrentOperator()가 한다.
//    · 그래서 이것은 **보안의 전부가 아니라 백스톱**이다. page의 검사를 빼도 된다는 뜻이 절대 아니다.
//
// ⚠️ Next 16에서 이 파일의 이름은 `middleware.ts`가 아니라 **`proxy.ts`**다(구 이름은 폐기 예정).
//    함수 이름도 `proxy`여야 한다. 위치는 app 폴더와 같은 높이(=webapp 루트).
// ⚠️ matcher를 넓히지 말 것. `/operator` 밖의 요청에는 이 파일이 아예 실행되지 않아야 한다
//    (matcher가 없으면 CSS·이미지·모든 화면에 걸려 엉뚱한 것이 막힌다 — 문서의 경고).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// lib/operator-session.ts 의 쿠키 이름과 **같아야 한다.**
//  · 왜 import하지 않나: 그 파일은 next/headers·prisma를 끌어오는 서버 전용 모듈이라
//    이 관문에서 불러오면 안 된다(위 "공유 모듈에 의존하지 말라"). 그래서 값만 적고 여기에 못 박는다.
const OPERATOR_COOKIE = "op_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 로그인 화면 자체는 통과시켜야 한다 — 안 그러면 로그인할 방법이 없어진다(무한 이동).
  if (pathname === "/operator/login") return NextResponse.next();

  if (!request.cookies.has(OPERATOR_COOKIE)) {
    return NextResponse.redirect(new URL("/operator/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // ⚠️ 두 개를 다 적는다. `/operator/:path*` 하나만 두면 **하위 경로 없는 `/operator` 자체**가
  //    빠질 수 있는지가 버전마다 미묘하다. 확실하게 둘 다 적어 애매함을 없앤다.
  matcher: ["/operator", "/operator/:path*"],
};
