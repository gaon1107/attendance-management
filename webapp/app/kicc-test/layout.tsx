// 🔒 결제 테스트 화면 접근 제한 (2026-08-02 종합검수 C-1 + 후속 검수 반영)
//
// 이 폴더의 화면은 아이원(ione24) 결제 연동을 시험해 보는 뉴가온 내부 도구다.
// 화면에 **뉴가온 가맹점 정보(sitekey·터미널ID·사업자번호)** 가 들어 있어 외부에 보이면 안 된다.
//
// ⚠️ "관리자만"으로는 부족한 이유:
//    이 제품은 누구나 회원가입하면 자기 회사의 관리자(role="admin")가 되는 구조다.
//    즉 role 검사만으로는 "가입만 하면 누구나"와 같아진다. 그래서 아래 2중으로 막는다.
//      ① 운영 빌드(NODE_ENV=production)에서는 아예 없는 페이지(404)로 만든다.
//      ② 개발·검증 환경에서도 관리자 로그인은 필요하다.
//    운영에서 결제 테스트가 필요하면 KICC_TEST_ENABLED=1 을 명시적으로 켠다(기본 꺼짐).
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { isKiccTestEnabled } from "@/lib/kicc-test-flag";

export default async function KiccTestLayout({ children }: { children: React.ReactNode }) {
  if (!isKiccTestEnabled()) notFound(); // 운영에서는 존재하지 않는 주소로 취급
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");
  return <>{children}</>;
}
