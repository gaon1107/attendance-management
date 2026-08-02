// 🔒 결제 테스트 화면 접근 제한 (2026-08-02 종합검수 C-1 반영)
//
// 이 폴더의 화면은 아이원(ione24) 결제 연동을 시험해 보는 내부 도구다.
// 예전에는 로그인 없이 누구나 열 수 있었다. 관리자만 들어오게 서버에서 막는다.
// (실제 호출을 처리하는 app/api/kicc-test/route.ts 에도 같은 검사가 들어 있다 — 둘 다 필요)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function KiccTestLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");
  return <>{children}</>;
}
