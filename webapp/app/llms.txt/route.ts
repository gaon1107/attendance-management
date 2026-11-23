// /llms.txt — AI 검색(챗GPT·퍼플렉시티 등)이 제품을 정확히 소개하도록 정리한 글(2026-11-23 검색 노출 기본 설정).
//  llms.txt는 "사이트를 AI가 읽기 쉽게 요약한 마크다운"을 사이트 맨 위 주소에 두자는 공개 제안이다.
//  🔴 **홈 화면에 있는 사실만** 적는다(홈 app/page.tsx의 문구 근거 주석들 — "자리비움 자동 감지" 같은 없는 기능 금지).
//  🔴 요금·무료 기간은 화면과 **같은 설정값**에서 만든다(lib/pricing.ts·trial.ts). 숫자를 손으로 적지 않는다.
//  ⚠️ 아래 "문의"의 사업자 정보는 홈 app/page.tsx의 BIZ와 같은 값이다(page 파일은 다른 값을 내보낼 수 없어 옮겨 적었다).
//     BIZ를 바꾸면 여기도 함께 바꿀 것.
import { PRICE_TIERS, QUOTE_OVER, formatWon, tierLabel } from "@/lib/pricing";
import { TRIAL_DAYS } from "@/lib/trial";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/site";

export const dynamic = "force-static";

function body(): string {
  const tiers = PRICE_TIERS.map((t, i) => `- ${tierLabel(i) ?? `${t.max}명까지`}: 월 ${formatWon(t.monthly)}`).join("\n");
  return `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME}는 가온(대한민국)이 운영하는 중소기업용 웹 근태관리 서비스입니다. 설치 없이 웹 브라우저와 휴대폰에서 씁니다.

## 핵심 기능
- 정직한 실근무시간: 출근·퇴근 시각의 차이만 세지 않고, [외출]로 기록한 시간을 빼서 실제로 일한 시간을 계산합니다. 퇴근을 깜빡한 기록은 '미퇴근'으로 표시합니다.
- 강제하지 않는 얼굴인증: 출퇴근 본인 확인은 얼굴인증과 GPS 중 직원이 직접 고릅니다. 생체정보 동의는 언제든 철회·삭제할 수 있습니다.
- 법규 대응: 주 52시간(주 12시간 초과근무 한도)을 관리하고, 근로시간 기록을 3년간 보존합니다.
- 휴가·결재: 연차 관리, 휴가 신청·승인, 근태 정정, 결재선 처리.
- 통계·보고서: 기간별 근태 현황, 급여 정산용 자료 내려받기(엑셀·PDF).
- 출퇴근 사진은 암호화해 보관하고 90일 뒤 자동 삭제합니다.

## 요금 (직원 수 구간제, 부가세 별도, 월)
${tiers}
- ${QUOTE_OVER}명 초과: 별도 협의
- 가입 후 ${TRIAL_DAYS}일 무료 체험. 결제는 관리자가 직접 신청할 때만 시작됩니다.

## 링크
- 홈(기능·요금·자주 묻는 질문): ${SITE_URL}/
- 이용약관: ${SITE_URL}/terms
- 개인정보처리방침: ${SITE_URL}/privacy

## 문의
- 운영: 가온 · 대표 이주은 · 사업자등록번호 373-66-00087 · 전화 031-281-3980 · 전자우편 psh01@newgaon.co.kr
`;
}

export function GET(): Response {
  return new Response(body(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
