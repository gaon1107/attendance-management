// PC-OFF 프로그램 내려받기 주소·안내 문구 — **단일 출처**(관리자 [PC관리]와 직원 [계정]이 같은 말을 하게).
// 순수 모듈(import 없음) — 브라우저에서 써도 된다.
//
// 2026-11-20 사장님 요청: "관리자가 직원에게 설치 주소를 전달하면 직원이 내려받아 설치".
//  · 파일은 운영 서버 nginx가 직접 내려준다(deploy/server/nginx/attend.newgaon.com.conf `location = /download/pc-off`).
//    개발 서버(localhost)에는 이 주소가 없다(404) — 화면 확인은 문구·복사만.
//  · 전체 주소(도메인 포함)는 화면을 연 브라우저에서 만든다(초대 링크처럼 브라우저 주소 기준 — 어디에 배포되든 맞게).

export const PC_OFF_DOWNLOAD_PATH = "/download/pc-off";

/**
 * 지금 그 주소의 파일이 "시험판"인가(plan-PC-OFF-상품화.md 2·3단계 전).
 * 시험판: 압축 파일을 풀어 실행 · 서버 주소 직접 입력 · PC를 다시 켜면 다시 실행해야 함.
 * 정식 설치 파일로 바꾸면 false로 내리고 아래 문구의 시험판 안내를 지운다.
 */
export const PC_OFF_IS_PREVIEW = true;

/** 관리자가 카톡·문자에 그대로 붙여 넣을 안내문. origin = "https://attend.newgaon.com" 같은 사이트 주소. */
export function pcOffGuideText(origin: string): string {
  const lines = [
    "[근태관리] PC 근무시간 프로그램(PC-OFF) 설치 안내",
    "",
    `① 회사 PC에서 이 주소를 열어 내려받으세요(약 60MB): ${origin}${PC_OFF_DOWNLOAD_PATH}`,
    "   (브라우저가 '일반적으로 다운로드되지 않는 파일'이라고 하면 [유지]를 누르세요)",
    "② 내려받은 압축 파일을 풀고 NewgaonPcOff.exe 를 실행하세요.",
    "   ('Windows의 PC 보호' 창이 뜨면 [추가 정보] → [실행])",
    "③ 처음 실행하면 연결 창이 저절로 뜹니다.",
    "   (안 뜨면 화면 오른쪽 아래 시계 옆 ^ 안의 전원 아이콘을 오른쪽 클릭 → [상태 · 연결 설정...])",
    `④ 서버 주소에 ${origin} 을 넣으세요.`,
    "⑤ 근태 앱 [계정] → [내 PC 연결] → [연결코드 발급]으로 받은 6자리를 넣으면 끝입니다.",
  ];
  if (PC_OFF_IS_PREVIEW) {
    lines.push("", "※ 지금은 시험판이라 PC를 다시 켜면 NewgaonPcOff.exe 를 다시 실행해 주세요.");
  }
  return lines.join("\n");
}
