// 비즈모아샷 홈페이지 링크 — [설정 → 문자·알림톡] 화면의 단계 버튼이 쓴다. 비밀이 아니다(화면 코드에서도 불러도 된다).
//
// 출처: 학원관리 backend/.env.example (비즈모아샷이 2026-09-07·09-29에 준 주소).
//  · 가입: **근태관리 전용 가입 주소**다. 이 주소로 가입해야 비즈모아샷이 "가온(근태관리) 고객"으로 구분한다.
//    학원관리 전용(…/ag/newgaonlms)과 섞으면 안 된다.
//  · 충전·잔액 / 발신번호 사전등록: 비즈모아샷에 로그인한 뒤 그 화면으로 바로 간다.
//  ⚠️ 비즈모아샷이 주소를 바꾸면 여기만 고친다.
export const MOASHOT_LINKS = {
  signup: "https://biz.moashot.com/ag/newgaonhr",
  charge: "https://biz.moashot.com/html/svcinfo/service_info_charge_send.asp",
  senderRegister: "https://biz.moashot.com/html/manage/manage_num_registration_sms.asp",
} as const;
