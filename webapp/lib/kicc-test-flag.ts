// 결제(아이원/KICC) 테스트 도구를 켤지 말지 결정한다. 화면·API가 같은 기준을 쓰도록 여기 한 곳에 둔다.
//
// 왜 필요한가 (2026-08-02 종합검수 후속):
//  · /kicc-test 화면에는 뉴가온 가맹점 정보(sitekey·터미널ID·사업자번호)가 들어 있다.
//  · 이 제품은 누구나 회원가입하면 자기 회사의 관리자(role="admin")가 되는 구조라
//    "관리자만"이라는 잠금은 사실상 "가입만 하면 누구나"와 같다.
//  · 그래서 운영 빌드에서는 이 도구를 아예 존재하지 않게 만든다(404).
//
// 운영에서 잠깐 켜야 하면 .env 에 KICC_TEST_ENABLED=1 을 넣는다(기본은 꺼짐).
export function isKiccTestEnabled(): boolean {
  if (process.env.KICC_TEST_ENABLED === "1") return true;
  return process.env.NODE_ENV !== "production";
}
