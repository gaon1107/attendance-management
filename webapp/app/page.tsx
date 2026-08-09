// 랜딩 페이지 (공개) — 목업 디자인 적용. 서버 컴포넌트(FAQ는 JS 없이 <details>로 동작).
// ⚠️ 섹션 순서·구성은 기존 그대로 두고 "겉모습"만 목업에 맞췄다(2026-08-05 사장님 확정).
//    좁은 화면에서 숨기고 접는 규칙은 globals.css의 `landing-*` 클래스에 있다(서버는 화면 크기를 모른다).
import Link from "next/link";
import { getLandingStats, TREND_DAYS } from "@/lib/public-stats";

// 공개 페이지라 방문자마다 DB를 때리면 안 된다 → 5분마다 한 번만 다시 계산하고 그 사이는 같은 화면을 준다.
// ⚠️ 이 값을 0으로 바꾸면 방문자 수만큼 집계 쿼리가 돈다(14일치 근태 기록 스캔). 낮추지 말 것.
export const revalidate = 300;

// ── 헤더 메뉴 — 실제로 존재하는 섹션에만 연결한다(빈 링크 금지) ──
const nav = [
  { label: "기능", href: "#features" },
  { label: "도입 절차", href: "#how" },
  { label: "직원/관리자", href: "#roles" },
  { label: "자주 묻는 질문", href: "#faq" },
  // ⚠️ 원래 "문의하기"였으나 이 섹션에 이메일·전화·문의폼이 하나도 없어 라벨을 바꿨다.
  //    연락처가 정해지면 CTA 밴드에 넣고 라벨을 "문의하기"로 되돌린다.
  { label: "지금 시작하기", href: "#contact" },
];

// ── 히어로 아래 특징칩 4개 ──
const chips = [
  { icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', text: "5분이면 설정 완료" },
  { icon: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>', text: "얼굴·GPS 직원이 선택" },
  // ⚠️ "생체정보 암호화 보관"이라고 쓰면 안 된다 — 코드로 확인되는 암호화는 출퇴근 사진(lib/clock-photo.ts,
  //    AES-256-GCM)뿐이고, 얼굴 데이터는 사내 얼굴서버 보관이라 이 저장소에서 증명할 수 없다(허위표시 위험).
  { icon: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', text: "출퇴근 사진 암호화 보관" },
  { icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>', text: "근로기준법 자동 대응" },
];

// ── 미리보기 KPI 4칸의 아이콘 (숫자·라벨은 lib/public-stats.ts가 DB에서 뽑아 온다) ──
// 여기는 한 회사의 대시보드가 아니라 **근태관리 사용자 전체(회원사 합계) 통계**다(2026-08-08 결정).
// 🔴 **이 화면의 숫자는 전부 실제 DB 값이다. 예시·목업 값을 다시 넣지 말 것**(2026-08-09 결정).
//    값이 0이어도 그대로 보여준다("처음부터 보여줘", 2026-08-09). DB 조회가 실패했을 때만 감춘다.
const PEEK_ICONS = {
  auth: '<path d="M20 6 9 17l-5-5"/>',
  company: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01"/>',
  employee: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><path d="M19 8v6M22 11h-6"/>',
  hours: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

// 도넛 조각 색. ⚠️ 두 번째 색은 연파랑(#93C5FD)이었는데 첫 색과 같은 계열이라 조각 경계가 흐렸다 → 보라.
//    보라(#8B5CF6)는 아래 차별점 카드 아이콘에 이미 쓰는 색이라 화면 전체 색 수는 늘지 않는다.
const MIX_COLORS = ["var(--primary)", "#8B5CF6"];

// 증감 배지 — 앞 기간과 비교해 "+12.5%" 같은 문구와 색을 만든다.
// ⚠️ 앞 기간이 0이면 **비율을 만들 수 없다**(0으로 나누기). 그럴 때는 배지를 아예 달지 않는다 —
//    "신규"·"+100%" 같은 말을 만들어 붙이면 없는 근거를 지어내는 셈이다.
// ⚠️ minPrev: 앞 기간 값이 너무 작으면 비율이 의미를 잃는다(1시간 → 24시간이면 "+2,300%"가 붙는다).
//    근거가 없는 건 아니지만 광고 화면에 쓸 수 있는 수치가 아니라 배지를 생략한다(검수 지적).
function delta(now: number, prev: number, minPrev: number): { text: string; color: string } | null {
  if (prev <= 0 || prev < minPrev) return null;
  const pct = ((now - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return { text: "변동 없음", color: "var(--text-sub)" };
  const rounded = (Math.round(Math.abs(pct) * 10) / 10).toFixed(1);
  return pct > 0
    ? { text: `+${rounded}%`, color: "var(--success)" }
    : { text: `-${rounded}%`, color: "var(--danger)" };
}

// "이번 달 +N개사"처럼 개수 증가만 있는 배지(앞 기간 비교가 아니라 신규 등록 수). 0이면 달지 않는다.
function newBadge(n: number, unit: string): { text: string; color: string } | null {
  return n > 0 ? { text: `+${n.toLocaleString("ko-KR")}${unit}`, color: "var(--success)" } : null;
}

// ── WHY: 차별점 ──
// 🔴 2026-08-09: 세 개를 같은 크기 카드로 늘어놓으니 **뭐가 우리 무기인지 눈으로 알 수 없다**는
//    외부 디자인 리뷰를 받아, 첫 번째(실근무시간)만 큰 블록으로 올리고 나머지 둘은 카드로 내렸다.
//
// 🔴 **문구를 고친 이유 — 예전 문구는 사실이 아니었다(2026-08-09 코드 확인).**
//    예전: "출퇴근·외출·**자리비움**을 **자동 반영**해 …"
//    실제: `lib/worktime.ts` 계산식은 **(퇴근 − 출근) − 외출시간 합**이 전부다.
//      · "자리비움"을 자동으로 감지해 빼는 기능은 **없다**(유휴시간 차감 코드 없음 — 전수 검색).
//        직원이 [외출] 버튼을 눌러 기록해야 빠진다(app/attendance/OnboardingTour.tsx도 그렇게 안내한다).
//      · `pc-agent`는 **퇴근 후 PC를 잠그는 기능**이지 실근무 측정이 아니다.
//      · 휴게(점심)도 별도 계산이 아니라 외출 기록으로 잡힌다(lib/break-rule.ts 주석).
//    → 그래서 "자동 감지"가 아니라 **"기록하면 자동으로 빼서 계산한다"**로 정정했다.
//    ⚠️ PC 활동 기반 자동 측정은 로드맵에 있는 것(2026-07-15 결정)이지 **지금 있는 기능이 아니다.**
//       그 기능이 실제로 붙기 전에는 이 문구에 "자동 감지"를 다시 넣지 말 것(표시광고 위험).
const featureLead = {
  badge: "핵심 차별점",
  title: "정직한 실근무시간",
  desc: "출근·퇴근 시각의 차이만 세지 않습니다. 외출·복귀를 기록하면 그 시간을 빼고 실제로 일한 시간만 계산합니다.",
  // 🔴 세 줄 모두 **코드로 증명되는 것만** 적는다(검수에서 한 줄이 되짚혔다).
  //   ① 처음엔 "자리를 비운 만큼"이라고 썼는데, 그건 방금 지운 "자리비움 자동 감지"를 말만 바꿔
  //      되살린 것이었다. 실제로는 **[외출] 버튼으로 기록한 시간만** 빠진다(lib/worktime.ts).
  //   ② `effectiveEnd`가 미퇴근 기록의 계산상 종료를 최대 약 24시간으로 자른다(lib/worktime.ts).
  //      화면에도 '미퇴근'으로 표시한다(records·DetailTable·인쇄·엑셀 4곳 확인).
  //   ③ **"실근무시간은"으로 주어를 좁혔다.** 실근무 계산식은 실제로 한 곳(workedMinutes)에서 나오지만,
  //      지각·조퇴 판정은 records·reports·dashboard가 각자 구현한 4벌이다(webapp/CLAUDE.md).
  //      주어를 안 좁히면 "판정까지 하나"로 읽혀 거짓이 된다(검수 지적).
  points: [
    "[외출]로 기록한 시간만큼은 근무로 세지 않습니다",
    "퇴근을 깜빡한 기록은 '미퇴근'으로 표시 — 수백 시간으로 부풀지 않습니다",
    "실근무시간은 모든 화면·리포트·법정 근로기록이 같은 계산식을 씁니다",
  ],
};

// 위 큰 블록 아래에 2열로 놓는 나머지 차별점.
const features = [
  { icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>', grad: "linear-gradient(135deg,#6366F1,#8B5CF6)", title: "법규 자동 준수", desc: "주 12시간 초과근무 한도를 실시간으로 관리하고, 근로시간 기록을 3년간 안전하게 보존합니다." },
  { icon: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>', grad: "linear-gradient(135deg,#0EA5E9,#38BDF8)", title: "강제 없는 얼굴인증", desc: "얼굴인증과 GPS 중 직원이 직접 선택합니다. 동의는 강제가 아니며 언제든 철회·삭제할 수 있어요." },
];

// ── 큰 블록 오른쪽 그림: 하루 시간 띠 (그림 파일이 아니라 네모 몇 개로 그린다) ──
// 09:00 출근 → 18:00 퇴근 = 540분. 그중 [외출]로 기록한 100분(점심 60 + 외출 40) → 실근무 440분.
// ⚠️ 이 숫자는 **설명용 예시**다. 화면에도 "예시"라고 적어 둔다(진짜 통계로 오해하지 않게).
// ⚠️ 회색 조각은 "자동으로 빠지는 시간"이 아니라 **직원이 [외출]로 기록한 시간**이다.
//    점심도 마찬가지다 — 휴게를 자동으로 빼 주는 기능은 없다(lib/break-rule.ts: "실근무시간을 바꾸지 않는다").
//    그래서 라벨에 "(외출 기록)"을 붙이고 띠 아래에도 한 줄로 밝힌다(검수 지적: 그림이 본문 조건을 배신함).
// ⚠️ **여기 min 값을 고칠 때 손으로 함께 고쳐야 하는 것은 시각 표기(09:00·12:00 …)뿐이다.**
//    "9시간"·"7시간 20분"·"1시간 40분"은 아래 DayBar가 이 배열에서 **계산**한다(직접 적지 말 것).
const daySegments: { min: number; work: boolean; label: string }[] = [
  { min: 180, work: true, label: "근무 09:00–12:00" },
  { min: 60, work: false, label: "점심(외출 기록) 12:00–13:00" },
  { min: 200, work: true, label: "근무 13:00–16:20" },
  { min: 40, work: false, label: "외출 기록 16:20–17:00" },
  { min: 60, work: true, label: "근무 17:00–18:00" },
];
// ⚠️ 합계를 손으로 적지 않고 **더해서 구한다** — 예전엔 540을 따로 적어 뒀는데, 조각을 고치면
//    합이 어긋나 띠가 넘치거나(찌그러짐) 모자라도(오른쪽 빈칸) **에러 없이 그림만 틀린다**(검수 지적).
const DAY_SPAN_MIN = daySegments.reduce((a, s) => a + s.min, 0);
const DAY_START = "09:00", DAY_END = "18:00";
// 분 → "N시간" / "N시간 M분". 앱 다른 곳(lib/format.ts formatMinutes)과 같은 규칙으로 적는다.
const hhmm = (min: number) => (min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`);

// ── 기존 방식과의 비교표 (2026-08-09) ──
// 🔴 **경쟁사 이름을 쓰지 않는다.** "시프티는 ✗" 같은 표는 ①상대가 기능을 추가하면 우리 화면이
//    바로 거짓이 되고 ②비교광고 분쟁의 대상이 된다. 그래서 회사가 아니라 **일하는 방식**과 비교한다.
// 🔴 우리 칸에 적는 것은 **코드로 확인된 것만** 적는다:
//    · 외출 제외 계산 = lib/worktime.ts (퇴근−출근−외출)
//    · 주 52시간·초과근무 한도 = lib/overtime.ts / overtime-week.ts
//    · 3년 보관·내보내기 = 법정 근로기록 화면 + reports/export(엑셀)
//    · 얼굴/GPS 선택 = auth-method (강제 금지가 이 프로젝트의 법적 가드레일)
//    ⚠️ 여기에 "자리비움 자동 감지" 같은 **없는 기능**을 넣지 말 것.
// ⚠️ 남의 칸은 단정하지 않는다. 단말기 제품마다 기능이 달라 "제품마다 다름"으로 적고,
//    표 아래에 "제품·운영 방식에 따라 다를 수 있습니다"를 반드시 남긴다.
// ⚠️ 왼쪽 두 칸(남의 방식)은 **확실하지 않으면 전부 "제품마다 다름"**으로 통일한다.
//    일부만 단정하면 "왜 여기만 단정했냐"는 반문에 답할 논리가 없다(검수 지적).
//    예: 요즘 지문·카드 단말기는 클라우드 저장도 흔하고, 지문+카드+얼굴을 함께 지원하는 제품도 많다.
const compareCols = ["종이·엑셀 수기", "지문·카드 단말기", "근태관리"] as const;
const OURS_COL = compareCols.length - 1; // 우리 칸(마지막 열) — 헤더·본문이 같은 값을 보게 한 곳에서 정한다
// ⚠️ cells를 **3칸 고정 튜플**로 둔다. string[]로 두면 칸 수가 어긋나도 타입검사가 못 잡아
//    체크 표시가 엉뚱한 칸에 찍히고 key가 undefined가 된다(검수 지적).
const compareRows: { label: string; cells: readonly [string, string, string]; noCheck?: boolean }[] = [
  { label: "출퇴근 기록 방법", cells: ["사람이 직접 적음", "단말기 앞에서 찍음", "웹·모바일에서 버튼 한 번"] },
  { label: "외출 시간을 빼고 계산", cells: ["손으로 계산", "제품마다 다름", "기록하면 자동 계산"] },
  // 🔴 "실시간으로 관리"라고 썼다가 되짚혔다. 계산은 지금(now)까지로 정확하지만(lib/overtime.ts),
  //    **자동 새로고침·알림이 없다** — 관리자가 화면을 열어야 보인다. 그래서 "자동 집계 + 경고 표시".
  { label: "주 52시간·초과근무 한도", cells: ["직접 챙겨야 함", "제품마다 다름", "자동 집계 + 한도 경고 표시"] },
  // 이 칸에 "3년"이라는 숫자를 쓰지 않은 내력(지우지 말 것):
  //  · 원래 "법정 근로기록 3년 보관"이라고 썼다가, 그것을 지키는 코드가 하나도 없어 뺐다(검수 지적).
  //  · 2026-08-09 근거가 생겼다 — lib/work-record-retention.ts가 3년 지난 근로기록을 자동 파기한다.
  //    이제 숫자를 써도 거짓이 아니지만, 문구 변경은 사장님 결정 사항이라 그대로 둔다.
  //  ⚠️ 다만 홈화면 다른 3곳(숫자 밴드·FAQ·차별점 카드)의 "3년"은 이제 **"3년 뒤 자동 삭제"라는 사실을
  //     고객에게 알리지 않고 있다**. 고지 문구는 사장님 확인 필요(보고함).
  { label: "근로기록 보관·내보내기", cells: ["파일을 직접 관리", "제품마다 다름", "자동 보관 + 언제든 내보내기"] },
  { label: "직원이 인증 방식을 고름", cells: ["해당 없음", "제품마다 다름", "얼굴·GPS 중 직원이 선택"] },
  // noCheck: 종이·엑셀도 "없음"이라 우리만 체크가 붙으면 억지스럽다(검수 지적) → 이 줄만 체크를 뺀다.
  { label: "단말기 구입·설치 비용", cells: ["없음", "필요", "없음(웹 구독)"], noCheck: true },
];

// ── HOW IT WORKS: 도입 3단계 ──
const steps = [
  { icon: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01"/>', title: "회사 계정 만들기", desc: "이메일로 5분이면 가입. 회사 근무시간과 사업장 위치만 설정하면 준비 끝." },
  { icon: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><path d="M19 8v6M22 11h-6"/>', title: "직원 초대", desc: "이메일로 직원을 초대하면 각자 얼굴인증 또는 GPS 중 편한 방식을 선택합니다." },
  { icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', title: "바로 출퇴근", desc: "버튼 한 번으로 출퇴근. 관리자는 대시보드에서 실시간으로 확인." },
];

// ── 역할별 체크리스트 ──
const roleEmployee = ["버튼 한 번으로 출퇴근·외출 기록", "얼굴인증 또는 GPS, 원하는 방식 선택", "내 실근무시간·상세 실시간 확인", "휴가·근태 정정을 앱에서 바로 신청"];
const roleAdmin = ["출근·지각·결근 오늘 상황 한 눈에", "주 52시간·초과근무 한도 자동 관리", "휴가·정정 결재를 한 곳에서 처리", "법정 근로기록·리포트 자동 정리"];

// ── 숫자 밴드 ── ⚠️ 사실인 것만 적는다(성과·만족도 같은 근거 없는 수치 금지)
const stats = [
  { value: "5분", label: "평균 도입 소요 시간", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { value: "3년", label: "근로기록 안전 보존", icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>' },
  { value: "2가지", label: "출퇴근 인증 방식", icon: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>' },
  { value: "100%", label: "근로기준법 대응", icon: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>' },
];

// ── FAQ ──
const faqs = [
  { q: "얼굴인증을 꼭 써야 하나요?", a: "아니요. 얼굴인증과 GPS 중 직원이 직접 고를 수 있고, 둘 다 강제가 아닙니다. 생체정보 동의는 언제든 철회·삭제할 수 있어요." },
  { q: "5인 미만 사업장도 쓸 수 있나요?", a: "네. 인원 수 제한 없이 사용할 수 있습니다. 5인 이상 사업장에 필요한 근로시간 기록·보존 기능도 기본으로 제공합니다." },
  { q: "기존 급여 프로그램과 연동되나요?", a: "실근무시간·근태 데이터를 내보낼 수 있어 급여 정산에 활용할 수 있습니다. 주요 급여 서비스와의 직접 연동은 순차적으로 추가하고 있습니다." },
  { q: "근로시간 기록은 얼마나 보관되나요?", a: "근로기준법에 따라 3년간 안전하게 보관하며, 언제든 법정 근로기록으로 내보낼 수 있습니다." },
];

const WRAP = 1080;
// ⚠️ 이 함수의 결과는 dangerouslySetInnerHTML로 그대로 삽입된다.
//    **반드시 이 파일 안에 직접 적은 글자(리터럴)만** 넣을 것. DB 값·사용자 입력을 넣으면 즉시 보안 구멍(XSS)이 된다.
const svg = (path: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export default async function Home() {
  // 홈화면 미리보기에 쓸 **실제 통계**. 값이 0이어도 그대로 보여준다("처음부터 보여줘", 2026-08-09).
  // 미리보기를 감추는 경우는 **DB 조회 실패(live.ok === false)** 하나뿐이다.
  // ⚠️ 변수명이 `live`인 이유: 이 파일에는 아래쪽 숫자 밴드용 모듈 상수 `stats`가 이미 있다.
  //    `stats`로 두면 그것을 덮어버려 밴드가 깨진다(실제로 한 번 깨뜨렸다).
  const live = await getLandingStats();
  const peek = [
    // ⚠️ "최근 N일"의 N은 손으로 적지 않고 TREND_DAYS에서 가져온다 — 집계 기간과 글자가 어긋나지 않게.
    // ⚠️ 라벨이 "인증"이 아니라 **"출퇴근 기록"**인 이유: [근태 정정]으로 관리자가 만든 기록은
    //    얼굴·GPS 인증을 거치지 않았는데 같이 세어진다. "인증"이라 쓰면 과대 표현이다(검수 지적).
    // ⚠️ "가입한 회사"인 이유: 해지·이탈·미사용 회사를 걸러낼 표시가 아직 없어서 "사용 중"이라 쓸 수 없다.
    { label: `최근 ${TREND_DAYS}일 출퇴근 기록`, value: live.auth7, unit: "건", badge: delta(live.auth7, live.auth7Prev, 30), badgeSub: `지난 ${TREND_DAYS}일 대비`, tone: "var(--primary)", icon: PEEK_ICONS.auth },
    { label: "가입한 회사", value: live.companies, unit: "개사", badge: newBadge(live.companiesNewThisMonth, "개사"), badgeSub: "이번 달", tone: "var(--text)", icon: PEEK_ICONS.company },
    { label: "등록 직원", value: live.employees, unit: "명", badge: newBadge(live.employeesNewThisMonth, "명"), badgeSub: "이번 달", tone: "var(--text)", icon: PEEK_ICONS.employee },
    { label: `최근 ${TREND_DAYS}일 실근무`, value: live.work7Hours, unit: "시간", badge: delta(live.work7Hours, live.work7PrevHours, 40), badgeSub: `지난 ${TREND_DAYS}일 대비`, tone: "var(--text)", icon: PEEK_ICONS.hours },
  ];
  // ⚠️ 아래 최상위 <div>의 wordBreak: "keep-all" — 한글 줄바꿈을 **낱말 단위**로 묶는다(2026-08-09 사장님 지시).
  //    브라우저 기본값은 한글을 글자 단위로 아무데나 끊어서 "근로기준법은 자 / 동으로",
  //    "실제로 일 / 한 시간만", "원하는 방식 선 / 택"처럼 낱말 한가운데가 갈라졌다(홈화면 7군데 실측).
  // ⚠️ overflowWrap: "break-word"는 **짝으로 함께 둔다** — keep-all만 주면 띄어쓰기 없는 긴 낱말이
  //    칸보다 길 때 그대로 삐져나간다. break-word는 "그 낱말 하나가 줄을 통째로 써도 안 들어갈 때만"
  //    예외로 끊어 준다.
  //    ⚠️ 단, break-word는 **칸 폭이 이미 정해진 곳에서만** 통한다. 표·격자처럼 내용에 맞춰 칸 폭이
  //       정해지는 자리에서는 긴 낱말이 칸을 밀어내 가로 스크롤이 생길 수 있다(그건 "anywhere"가 막는다).
  //       지금 이 페이지에는 사람이 입력한 글자가 없어서(통계는 전부 숫자) 문제가 되지 않는다.
  //       나중에 회사명 같은 **입력값을 이 페이지에 찍게 되면** 그 자리는 anywhere로 바꿀 것.
  // ⚠️ 이 페이지(홈화면) 안에만 적용된다. 로그인 후 화면에도 주고 싶으면 globals.css에서 따로 줄 것.
  return (
    <div id="top" style={{ minHeight: "100vh", background: "#FFFFFF", color: "var(--text)", wordBreak: "keep-all", overflowWrap: "break-word" }}>
      {/* 헤더 */}
      {/* ⚠️ 헤더 아래 선과 푸터 위 선은 **남긴다** — 스크롤할 때 고정된 헤더와 본문이 겹쳐 보이므로
             경계가 필요하다. 색만 회색 → 파랑으로 맞추되 **진한 쪽(-strong)**을 쓴다.
             헤더 배경이 반투명(0.9)이라 아래로 지나가는 푸른 섹션이 비쳐 올라오는데, 옅은 쪽을
             쓰면 그 구간에서 선 대비가 1.10까지 떨어져 헤더와 본문이 붙어 보인다(검수 지적). */}
      {/* 🎨 2026-08-09 색 정리에 딸린 보완: 히어로 배경이 흰색이 되면 고정 메뉴바와 본문의 경계가
             **1px 선 하나**만 남는다(사장님께 여쭤 두었던 0-A ① 항목이 바로 이것이다).
             그래서 그림자를 더해 메뉴바가 본문 위에 떠 있는 것으로 읽히게 한다.
             ⚠️ 처음엔 rgba(37,99,235,0.06)+blur 4px로 넣었는데, 계산해 보니 가장 진한 지점이
                흰색 대비 **1.04**로 사실상 안 보였다(테두리 #CBD9F0이 1.43인 것과 비교). 그래서
                검정 기운 8%로 올렸다. **이보다 더 옅게 내리면 없는 것과 같아진다.**
             ⚠️ 스크롤 위치와 무관하게 항상 켜져 있다. 맨 위에서도 그림자가 보이는 게 싫으면
                클라이언트 컴포넌트로 바꿔 스크롤 위치를 봐야 한다(지금은 서버 컴포넌트라 못 한다).
             ⚠️ 히어로 배경을 다시 파랗게 되돌린다면 이 그림자는 빼도 된다(선만으로 충분해진다). */}
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--landing-border-strong,#CBD9F0)", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={logoBox(28, 7, 15)}>근</div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>근태관리</span>
          </div>
          <nav className="landing-nav">
            {nav.map((n) => (
              <a key={n.href} href={n.href}>{n.label}</a>
            ))}
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/login" style={{ height: 40, padding: "0 16px", display: "flex", alignItems: "center", color: "#374151", fontSize: 15, fontWeight: 700, textDecoration: "none", borderRadius: 7 }}>로그인</Link>
            <Link href="/signup" style={{ height: 40, padding: "0 18px", display: "flex", alignItems: "center", borderRadius: 7, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", boxShadow: "0 6px 16px rgba(37,99,235,0.28)" }}>무료로 시작하기</Link>
          </div>
        </div>
      </header>

      {/* 히어로 — 배경은 화면 끝까지, 글은 가운데. 오른쪽 그림은 넓은 화면에서만 보인다.
          오른쪽으로 삐져나온 그림을 잘라내는 처리는 globals.css의 `.landing-hero-wrap`에 있다
          (인라인 스타일로는 옛 사파리용 폴백 두 줄을 쓸 수 없다). */}
      {/* 🎨 2026-08-09 색 정리: 연파랑 → **거의 흰색**.
             섹션 배경으로 연파랑이 깔린 면적이 52.6%였고(실측), 그중 절반이 이 히어로였다(26.0%).
             지금은 섹션 기준 12.2%(도입 3단계 한 곳)다.
             #FAFBFD는 흰색에 아주 약간 회색이 섞인 값 — 완전한 흰색(#FFFFFF)이면 아래 미리보기 카드의
             푸른빛 바탕(--landing-bg)이 붕 떠 보여서, 바닥을 아주 살짝만 낮춰 둔다.
             ── 배경 그림 이야기 (2026-08-06 이력) ─────────────────────────────
             배경 그림 두 조각(물결·사람)은 **흰 바탕으로 구워진** 이미지다(투명 PNG면 233KB, 흰 배경이면 23KB).
             그래서 파란 배경 위에 얹으면 흰 네모가 드러났고, globals.css에서 두 그림에
             `mix-blend-mode: multiply`(곱하기 합성)를 걸어 흰색이 투명처럼 동작하게 만들었다.
             ⚠️ 지금은 배경이 거의 흰색이라 그 blend가 하는 일이 거의 없다. 그래도 **빼지 말 것** —
                배경에 색을 다시 넣는 순간 흰 네모가 즉시 다시 보인다(globals.css의 짝 주석 참고). */}
      <div className="landing-hero-wrap" style={{ background: "linear-gradient(180deg,#FAFBFD 0%,#FFFFFF 60%)" }}>
        <section className="landing-hero-inner" style={{ position: "relative", maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,10vw,104px) 24px clamp(48px,8vw,80px)", textAlign: "center" }}>
          {/* 배경 그림(물결 + 사람·방패)은 globals.css의 `.landing-hero-wrap::before`가 깐다.
              여기에 <img>로 두지 않는 이유: 글자 뒤에 깔리는 장식이라 문서 내용이 아니고,
              좁은 화면에서 통째로 빼야 하는데 그건 CSS만 할 수 있기 때문이다. */}
          {/* ⚠️ maxWidth: 700 — 오른쪽 배경 그림과 글자가 겹치지 않게 하는 **안전장치**다.
                 그림의 잉크가 시작되는 지점은 화면 가운데에서 오른쪽으로 354px 되는 곳이고(화면 폭과 무관한 값),
                 이 상자를 700px로 묶으면 어떤 글줄도 가운데에서 350px을 넘지 못한다.
                 → 문구를 길게 고치거나 글꼴이 바뀌어도 겹치는 대신 **줄바꿈**이 된다(안전한 실패).
                 ⚠️ 이 값을 키우거나 없애면 특징칩 마지막 칸이 방패 그림 위로 올라탄다. */}
          <div style={{ position: "relative", zIndex: 1, maxWidth: 700, margin: "0 auto" }}>
            {/* ⚠️ 알약 배경색 #D3E1FA의 이력:
                   2026-08-06 히어로가 파란 배경이던 시절, 예전 값 #E8F1FE가 히어로 상단색과 거의 같은 색
                   (대비 1.00)이 되어 배지가 통째로 묻혔다 → #D3E1FA까지 내려 대비 1.16을 확보했다.
                   2026-08-09 히어로가 다시 거의 흰색이 되면서 **같은 값의 대비가 1.32로 올라갔다**(계산).
                   즉 예전보다 알약이 또렷하다. 묻히는 문제는 사라졌고, 장식치고 진하다 싶으면
                   #DCE8FA(흰색 대비 1.22)쯤으로 한 단계 올려도 된다. 지금은 그대로 둔다.
                   실제로 글자를 읽히게 하는 건 알약색이 아니라 진한 글자색(#1D4ED8)이다.
                   ⚠️ 히어로 배경색을 또 바꾸면 이 대비를 다시 계산할 것. */}
            <div style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 16px", background: "#D3E1FA", borderRadius: 16, marginBottom: 24, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1D4ED8" }}>중소기업을 위한 근태관리 SaaS</span>
            </div>
            <h1 style={{ fontSize: "clamp(30px,5.5vw,52px)", fontWeight: 700, lineHeight: 1.22, letterSpacing: "-0.02em", margin: "0 auto 20px", maxWidth: 720 }}>
              정직한 실근무시간,
              <br />
              <span style={{ color: "var(--primary)" }}>강제하지 않는 얼굴인증</span>
            </h1>
            <p style={{ fontSize: "clamp(16px,2.4vw,19px)", color: "var(--text-sub)", lineHeight: 1.6, margin: "0 auto 32px", maxWidth: 560 }}>
              출퇴근부터 휴가·급여 연동까지. 직원을 감시하지 않으면서 근로기준법은 자동으로 지키는 근태관리.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
              <Link href="/signup" style={{ height: 52, padding: "0 28px", display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 10, background: "linear-gradient(135deg,#2563EB,#3B82F6)", color: "#fff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", boxShadow: "0 12px 26px rgba(37,99,235,0.32)" }}>
                무료로 시작하기
                <span style={{ width: 17, height: 17, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 17) }} />
              </Link>
              {/* ⚠️ 이 버튼은 배경이 흰색이고 히어로 바탕도 흰색이라 **테두리가 유일한 경계**다.
                     옅은 쪽(--landing-border)을 쓰면 버튼 모양 자체가 흐려진다 → 반드시 -strong. */}
              <a href="#features" style={{ height: 52, padding: "0 24px", display: "inline-flex", alignItems: "center", border: "1px solid var(--landing-border-strong,#CBD9F0)", borderRadius: 10, background: "#fff", color: "#374151", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", boxShadow: "0 2px 8px rgba(37,99,235,0.07)" }}>기능 둘러보기</a>
            </div>
            {/* 특징칩 4개 */}
            {/* ⚠️ 알약 배경·테두리를 뺐다(2026-08-06, 시안에 맞춤). 히어로 배경이 파랗게 바뀌어
                   흰 알약 4개가 배경 위에 도드라져 보였다. 시안은 아이콘+글자만 놓는다.
                   ⚠️ 여기 바로 위에 있던 회색 안내문구("신용카드 없이 5분이면 시작 · 5인 이상 …")는
                      시안에 없어 뺐다. 되살리려면 이 자리에 다시 넣으면 된다(내용은 커밋 메시지에 있음).
                      "5분이면 설정 완료"는 아래 칩에 이미 있어 정보가 사라지지는 않는다. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 22, justifyContent: "center", marginTop: 34 }}>
              {chips.map((c) => (
                <div key={c.text} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, fontSize: 13, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--primary)", width: 15, height: 15, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg(c.icon, 15) }} />
                  {c.text}
                </div>
              ))}
            </div>
          </div>

          {/* 제품 미리보기 — **전부 실제 DB 통계**(lib/public-stats.ts). 목업 값 금지.
              ⚠️ live.ok가 false = **DB 조회 실패**일 때만 이 블록을 렌더하지 않는다(0으로 채운 화면을
                 진짜 데이터처럼 보여주지 않으려고). 데이터가 적다는 이유로는 감추지 않는다 —
                 "그냥 처음부터 보여줘"(2026-08-09 사장님 지시). 감추는 기준을 되살리려면 lib/public-stats.ts.
              ⚠️ 예전에 맨 위에 있던 브라우저 창 흉내 줄(신호등 3점·주소·"예시 화면·가상 데이터"·"실시간")은
                 **지웠다** — 실데이터로 바뀌어 "가상 데이터" 표기가 사실과 달라졌고, 사장님이 이 줄 자체를
                 걷어내라고 확정했다(2026-08-09). 되살릴 일이 생기면 가상 데이터 표기부터 다시 판단할 것. */}
          {/* ⚠️ 그림자만 --landing-shadow(8%)를 안 쓰고 13%로 따로 준다 — 이 카드는 화면에서 가장 큰
                 덩어리라 같은 8%로는 흰 히어로 바탕 위에서 떠 보이지 않는다(다른 카드보다 진하게). */}
          {live.ok && (
          <div style={{ position: "relative", zIndex: 1, marginTop: "clamp(40px,6vw,64px)", borderRadius: 16, background: "var(--landing-bg,#F5F8FF)", overflow: "hidden", textAlign: "left", boxShadow: "0 24px 60px rgba(37,99,235,0.13)" }}>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* ⚠️ 미리보기 **안쪽** 카드들(아래 KPI 4칸·차트 2개)은 테두리를 지우지 않는다.
                     여기는 바깥 카드 바탕이 푸른빛(--landing-bg)이라 흰 칸이 배경과는 구분되지만,
                     칸끼리는 12px 간격으로만 떨어져 있어 선이 없으면 4칸이 한 덩어리로 읽힌다.
                     경계가 사라지는 건 아니므로 약한 쪽(--landing-border)으로 충분하다. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
                {peek.map((p) => (
                  <div key={p.label} style={{ background: "#fff", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 12, padding: "16px 18px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{p.label}</span>
                      <span style={{ color: p.tone, width: 15, height: 15, display: "inline-flex", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: svg(p.icon, 15) }} />
                    </div>
                    {/* 단위(건·명·시간)를 값에서 떼어 작게 붙인다 — 숫자만 크게 남아 눈에 먼저 들어온다.
                        alignItems: "baseline"이라 24px 숫자와 13px 단위의 밑선이 맞는다.
                        ⚠️ whiteSpace: nowrap — 실데이터는 자릿수가 자라므로(예: 6자리) 좁은 칸에서
                           단위가 아래 줄로 떨어지지 않게 묶어 둔다(검수 지적). */}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3, whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: 24, fontWeight: 700, color: p.tone, fontVariantNumeric: "tabular-nums" }}>{p.value.toLocaleString("ko-KR")}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-sub)" }}>{p.unit}</span>
                    </div>
                    {/* 증감 배지 — "정지된 표"가 아니라 살아 있는 화면으로 읽히게 하는 요소.
                        ⚠️ 색·문구는 delta()·newBadge()가 실제 증감으로 만든다. 비교할 앞 기간 값이 없으면
                           배지 자체가 없다(없는 근거를 지어내지 않는다). */}
                    {p.badge && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: p.badge.color, fontVariantNumeric: "tabular-nums" }}>{p.badge.text}</span>
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>{p.badgeSub}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="landing-chart-grid">
                <TrendChart trend={live.trend} />
                {/* 아직 아무도 인증 방식을 고르지 않았으면 도넛은 그릴 것이 없다 → 꺾은선만 한 줄로 넓게 */}
                {live.authMix.length > 0 && <AuthDonut authMix={live.authMix} />}
              </div>
            </div>
          </div>
          )}
        </section>
      </div>

      {/* WHY — 차별점 */}
      {/* ⚠️ scrollMarginTop: 메뉴를 눌러 이동할 때 고정 헤더가 섹션 머리를 덮지 않게 한다.
             헤더가 실제로 먹는 높이는 **61px**(안쪽 60 + 아래 테두리 1)이라 68은 여유가 7px뿐이다.
             **헤더 높이를 바꾸면 이 값도 함께 올릴 것.**
             globals.css의 html{scroll-padding-top}으로 하면 로그인 후 전 화면에 영향이 가므로 여기서만 준다. */}
      {/* 🎨 2026-08-09 색 정리(미리보기): 연파랑 배경 → **흰색**.
             ⚠️ 배경을 지웠으면 **카드에 테두리를 반드시 살려야 한다**(아래 border). 이 카드들이 테두리 없이
                버틴 이유가 바로 "배경이 푸른빛이라 흰 카드가 저절로 구분된다"였기 때문이다.
                테두리 없이 배경만 희게 하면 흰 바탕에 흰 카드가 되어 윤곽이 녹는다 —
                그림자(8%)만으로는 밝은 사무실 모니터에서 안 보인다는 것이 이 프로젝트의 기존 결론이다.
                ⚠️ 테두리는 여기 인라인이 아니라 **globals.css의 `.landing-hover-card`**가 갖는다
                   (인라인으로 두면 마우스 올림 효과가 테두리를 못 바꾼다).
             ※ 예전 배경(연파랑 그라데이션)과 48px 페이드에 대한 설명은 아래 [도입 3단계] 섹션으로 옮겼다.
                연파랑을 **섹션 배경**으로 쓰는 곳은 이제 거기 하나뿐이다.
                (섹션 말고도 히어로 안 미리보기 카드 바탕에 같은 색 `--landing-bg`를 쓴다 — 그건 별개다.) */}
      <section id="features" style={{ background: "#FFFFFF", scrollMarginTop: 68 }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <div style={eyebrow}>WHY 근태관리</div>
            <h2 style={h2}>일하는 사람도, 관리하는 사람도 편하게</h2>
          </div>
          {/* ── 큰 블록: 핵심 차별점 하나만 크게 (2026-08-09) ──
              왼쪽에 글, 오른쪽에 "하루 시간 띠" 그림. 좁아지면 globals.css가 위아래로 접는다.
              ⚠️ 처음엔 **일부러 마우스 올림 효과를 빼 뒀다**(카드가 아니라 읽는 내용이라 움직이면
                 거슬릴까 봐). 사장님이 "여기만 효과가 없다"고 하셔서 **다른 카드와 똑같이** 맞췄다.
              ⚠️ 그래서 배경·테두리·둥근모서리·그림자를 인라인에서 뺐다 — `.landing-hover-card`가 갖는다.
                 인라인으로 되돌리면 이 블록만 또 테두리·그림자가 안 변한다(인라인이 CSS를 이긴다).
              ⚠️ 아래 카드들과의 간격(28)을 카드끼리의 간격(16)보다 넓게 둔다 —
                 같으면 큰 블록과 카드가 "같은 무리"로 보여 위계가 사라진다(검수 지적). */}
          <div className="landing-feature-lead landing-hover-card" style={{ marginBottom: 28, padding: "clamp(24px,3vw,34px)" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 12px", borderRadius: 13, background: "#D3E1FA", color: "#1D4ED8", fontSize: 12, fontWeight: 700, marginBottom: 14 }}>{featureLead.badge}</div>
              <h3 style={{ fontSize: "clamp(21px,2.6vw,27px)", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 12px" }}>{featureLead.title}</h3>
              <p style={{ fontSize: 16, color: "var(--text-sub)", lineHeight: 1.65, margin: "0 0 18px" }}>{featureLead.desc}</p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {featureLead.points.map((p) => (
                  <li key={p} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--success)", flexShrink: 0, width: 18, height: 18, display: "inline-flex", marginTop: 1 }} dangerouslySetInnerHTML={{ __html: svg('<path d="M20 6 9 17l-5-5"/>', 18) }} />
                    <span style={{ fontSize: 15, lineHeight: 1.5 }}>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <DayBar />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
            {/* 카드의 배경·테두리·둥근모서리·그림자는 globals.css의 `.landing-hover-card`가 갖는다.
                ⚠️ 인라인 style로 다시 옮기면 마우스 올림 효과가 죽는다(인라인이 CSS를 이긴다). */}
            {features.map((f) => (
              <div key={f.title} className="landing-hover-card" style={{ padding: "28px 26px" }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: f.grad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, boxShadow: "0 8px 18px rgba(37,99,235,0.22)" }} dangerouslySetInnerHTML={{ __html: svg(f.icon, 23) }} />
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>

          {/* ── 기존 방식과의 비교표 ──
              ⚠️ 표는 좁은 화면에서 줄일 수 없다(칸이 4개라 글자가 세로로 무너진다).
                 그래서 **표만 가로로 밀어 보는 상자**에 담는다. 페이지 자체는 가로 스크롤이 생기지 않는다.
              ⚠️ 마우스 올림 효과(.landing-hover-card)는 주지 않는다 — 표는 읽는 것이고,
                 움직이면 가로로 밀어 보는 동작과 충돌한다. */}
          <div style={{ marginTop: 40 }}>
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <h3 id="cmp-title" style={{ fontSize: "clamp(19px,2.4vw,24px)", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 6px" }}>지금 쓰시는 방식과 무엇이 다른가요?</h3>
              <p style={{ fontSize: 14, color: "var(--text-sub)", margin: 0 }}>회사 이름이 아니라 <b style={{ color: "var(--text)" }}>일하는 방식</b>으로 비교했습니다.</p>
            </div>
            {/* ⚠️ tabIndex/role/aria-labelledby — 좁은 화면에서 표를 **키보드로도 밀어 볼 수 있게** 한다.
                   이게 없으면 마우스를 못 쓰는 분은 3·4번째 칸을 영영 볼 수 없다(크롬은 알아서 해 주지만
                   파이어폭스·사파리는 아니다 — 검수 지적). aria-labelledby는 위 제목을 표 이름으로 쓴다. */}
            <div className="landing-compare-scroll" tabIndex={0} role="region" aria-labelledby="cmp-title">
              <table style={{ width: "100%", minWidth: 640, borderCollapse: "separate", borderSpacing: 0, fontSize: 14 }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...cmpCell, textAlign: "left", color: "var(--text-sub)", fontWeight: 600, background: "transparent", borderTop: 0, borderLeft: 0 }}>비교 항목</th>
                    {compareCols.map((c, i) => {
                      const ours = i === OURS_COL;
                      return (
                        // ⚠️ 머리줄은 전부 borderTop: 0 — 그래야 ①가로선이 첫 칸부터 통일되고
                        //    ②파란 배경 위에 옅은 회색 선이 얼룩처럼 얹히지 않는다(검수 지적).
                        // ⚠️ 색이 #2563EB→#3B82F6이었는데 오른쪽 끝에서 흰 글자 대비가 3.68까지 떨어졌다
                        //    (14px 굵은 글씨는 4.5 이상 필요) → 한 단계 진하게 낮췄다.
                        <th key={c} scope="col" style={{ ...cmpCell, fontWeight: 700, borderTop: 0, borderRight: i === compareCols.length - 1 ? "1px solid var(--landing-border,#DCE5F4)" : undefined, color: ours ? "#fff" : "var(--text-sub)", background: ours ? "linear-gradient(135deg,#1D4ED8,#2563EB)" : "var(--landing-bg,#F5F8FF)", borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>{c}</th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r, ri) => {
                    // 표 바깥 테두리를 닫는다 — cmpCell은 위·왼쪽 선만 그리므로 마지막 줄·마지막 칸에
                    // 아래·오른쪽 선을 따로 넣지 않으면 격자가 열린 채로 끝난다(검수 지적).
                    const last = ri === compareRows.length - 1;
                    const edge = "1px solid var(--landing-border,#DCE5F4)";
                    return (
                    <tr key={r.label}>
                      <th scope="row" style={{ ...cmpCell, textAlign: "left", fontWeight: 600, borderLeft: 0, borderBottom: last ? edge : undefined }}>{r.label}</th>
                      {r.cells.map((v, i) => {
                        const ours = i === OURS_COL;
                        return (
                          <td key={compareCols[i]} style={{ ...cmpCell, borderRight: i === r.cells.length - 1 ? edge : undefined, borderBottom: last ? edge : undefined, color: ours ? "var(--text)" : "var(--text-sub)", fontWeight: ours ? 700 : 400, background: ours ? "rgba(37,99,235,0.06)" : "transparent" }}>
                            {/* 우리 칸에만 체크 표시. ⚠️ 색만으로 구분하지 않기 위해 아이콘을 함께 둔다.
                                ⚠️ noCheck 줄은 뺀다 — 남의 칸과 결과가 같은데 우리만 체크면 억지스럽다. */}
                            {ours && !r.noCheck && <span aria-hidden style={{ color: "var(--success)", width: 15, height: 15, display: "inline-flex", verticalAlign: "-2px", marginRight: 5 }} dangerouslySetInnerHTML={{ __html: svg('<path d="M20 6 9 17l-5-5"/>', 15) }} />}
                            {v}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* 🔴 이 한 줄을 지우지 말 것 — 남의 제품 기능을 단정하지 않는다는 표시다(비교광고 방어) */}
            <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "12px 0 0", lineHeight: 1.6 }}>
              ※ 왼쪽 두 칸은 일반적인 운영 방식을 정리한 것으로, 실제 제품·운영 방식에 따라 다를 수 있습니다.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — 3단계 */}
      {/* 🎨 2026-08-09 색 정리: 이 섹션이 **연파랑을 섹션 배경으로 쓰는 유일한 곳**이 됐다.
             (히어로 안 미리보기 카드도 같은 색 `--landing-bg`를 바탕으로 쓴다 — 섹션이 아니라 카드다.)
             왜 없애지 않고 여기로 모았나 — 히어로·차별점·역할을 전부 흰색으로 만들면 위에서 CTA까지
             흰색이 6구간 연속이라 구간 구분이 사라지고 밋밋해진다. 연파랑을 한 군데로 몰아 주면
             `흰 → 흰 → 🩵 → 흰 → 🔵밴드 → 흰 → 🔵CTA` 리듬이 생긴다.
             ⚠️ 전에는 이 섹션 자체가 가운데 정렬 상자(maxWidth)였다. 배경을 깔려면 **화면 끝까지** 칠해야 해서
                바깥에 섹션을 하나 더 두고 안쪽에 원래 상자를 넣는 구조로 바꿨다.
                이 구조를 되돌리면 배경이 가운데 1080px에만 칠해지고 좌우가 흰색으로 남는다.
             ⚠️ 배경 그라데이션의 위·아래 끝이 **흰색**인 이유: 앞(차별점)과 뒤(역할)가 둘 다 흰 바탕이다.
                양 끝을 흰색으로 두면 선 없이도 색이 서서히 번져 한 장으로 이어진다.
                **앞뒤 섹션 배경을 바꾸면 이 0%/100% 색도 같이 바꿀 것.**
             ⚠️ 색이 바뀌는 지점을 %가 아니라 **48px 고정**으로 둔 이유(2026-08-06 검수 반영):
                ① %로 두면 섹션이 길어질수록 흰색 구간도 같이 길어진다. 폰에서 카드가 세로로 쌓이면
                   그 지점이 카드 한가운데에 걸려 카드가 배경에 묻힌다.
                ② 48인 이유: 이 섹션의 위아래 여백이 최소 56px이라, 색이 변하는 구간이 그 여백 안에서
                   끝나야 카드 영역을 침범하지 않는다(120px로 잡았더니 카드 아래 64px가 걸렸다 — 실측).
                   ⚠️ 섹션 패딩의 최소값을 줄이면 이 48px도 함께 줄일 것. */}
      <section id="how" style={{ background: "linear-gradient(180deg,#FFFFFF 0,var(--landing-bg,#F5F8FF) 48px,var(--landing-bg,#F5F8FF) calc(100% - 48px),#FFFFFF 100%)", scrollMarginTop: 68 }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <div style={eyebrow}>HOW IT WORKS</div>
            <h2 style={h2}>도입은 3단계면 충분해요</h2>
          </div>
          {/* ⚠️ 카드 사이 화살표를 "카드 안"에 두면 안 된다 — 카드에 overflow:hidden이 있어 잘려서
                 아예 보이지 않는다(실측으로 확인). 그래서 격자(grid) 자체에 얹고 칸 사이 여백 좌표를
                 계산해 놓는다(globals.css의 .landing-step-arrow). 카드가 3열이 아닐 땐 숨긴다. */}
          {/* 🔴 카드 테두리를 **지우면 안 된다.** "배경이 푸른빛이니 테두리 없이도 구분되겠지"는 틀렸다 —
                 실제 대비를 계산하면 카드 위쪽(#FFFFFF) 대 섹션 바탕(#F5F8FF)이 **1.06**,
                 카드 아래쪽(#F8FBFF) 대 바탕이 **1.02**다. 이 파일 위쪽 색 주석이 "1.17도 안 보인다"고
                 박제해 둔 기준보다 한참 아래라, 테두리를 빼면 카드가 그냥 사라진다(검수 지적).
                 테두리 자체는 globals.css의 `.landing-hover-card`가 갖는다. */}
          <div className="landing-steps" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
            {steps.map((s, i) => (
              <div key={s.title} className="landing-hover-card" style={{ position: "relative", padding: "28px 26px", overflow: "hidden" }}>
                <span style={{ position: "absolute", top: 8, right: 18, fontSize: 64, fontWeight: 800, color: "#F1F5FB", lineHeight: 1, userSelect: "none" }}>{i + 1}</span>
                <div style={{ position: "relative", width: 48, height: 48, borderRadius: 13, background: "linear-gradient(135deg,#2563EB,#60A5FA)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, boxShadow: "0 8px 18px rgba(37,99,235,0.22)" }} dangerouslySetInnerHTML={{ __html: svg(s.icon, 23) }} />
                <div style={{ position: "relative", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                <div style={{ position: "relative", fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
            <span className="landing-step-arrow landing-step-arrow-1" dangerouslySetInnerHTML={{ __html: svg('<path d="M9 6l6 6-6 6"/>', 20) }} />
            <span className="landing-step-arrow landing-step-arrow-2" dangerouslySetInnerHTML={{ __html: svg('<path d="M9 6l6 6-6 6"/>', 20) }} />
          </div>
        </div>
      </section>

      {/* 역할별 */}
      {/* 🎨 2026-08-09 색 정리(미리보기): 연파랑 배경 → **흰색**.
             ⚠️ 짝으로 아래 RoleCard에 테두리를 살렸다(차별점 카드와 같은 이유 — 그쪽 주석 참고). */}
      <section id="roles" style={{ background: "#FFFFFF", scrollMarginTop: 68 }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <h2 style={h2}>직원도, 관리자도 각자 필요한 만큼만</h2>
          </div>
          {/* ⚠️ 최소폭이 500px인 이유(320px 아님): 카드 오른쪽에 기기 그림 자리(최대 232px)를 비워 두므로,
                 카드가 좁으면 글자 칸이 남지 않는다. 실측: 320px 기준이면 768px 화면에서 카드 344px →
                 관리자 카드 **글자 폭 31px**(한 줄에 두 글자, 카드 높이 1003px)로 무너졌다.
                 500px면 1064px 미만에서 한 줄로 접혀 카드가 넓어진다. 기기 그림 폭을 바꾸면 이 값도 다시 볼 것. */}
          {/* ⚠️ min(500px,100%)로 감싼 이유: 그냥 minmax(500px,1fr)로 두면 화면이 500px보다 좁을 때
                 칸이 500px을 고집해 화면 밖으로 삐져나간다(375px에서 가로 스크롤 149px 발생 — 실측). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(500px,100%),1fr))", gap: 16 }}>
            <RoleCard title="직원" sub="복잡한 건 가려지고" items={roleEmployee} iconPath='<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>' device="phone" />
            <RoleCard title="관리자" sub="PC 대시보드 한 곳에" items={roleAdmin} iconPath='<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' device="laptop" />
          </div>
        </div>
      </section>

      {/* 숫자 밴드 */}
      <section style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(48px,7vw,72px) 24px" }}>
        {/* ⚠️ 칸을 나누는 규칙(4칸 → 2×2 → 1줄)은 globals.css의 `.landing-stats`에 있다.
               인라인 style로는 "화면이 좁아지면"(@media)을 쓸 수 없어서 클래스로 뺐다.
               아이콘을 왼쪽으로 옮기면서 한 칸에 필요한 폭이 커져, 예전 auto-fit(minmax 160px)으로는
               4칸이 되는 지점의 여유가 0.7px밖에 안 남는다(=라벨이 두 줄로 갈라진다).
               접는 지점을 정한 계산은 전부 그 CSS 주석에 적어 뒀다. */}
        <div className="landing-stats" style={{ background: "linear-gradient(120deg,#2563EB 0%,#3B82F6 55%,#6366F1 100%)", borderRadius: 20, padding: "clamp(32px,4vw,44px) 24px", boxShadow: "0 18px 40px rgba(37,99,235,0.25)" }}>
          {stats.map((s) => (
            // 아이콘은 왼쪽, 숫자·설명은 그 오른쪽에 위아래로(2026-08-09 사장님 시안).
            // ⚠️ justifyContent: "center" — 덩어리 자체는 칸 가운데에 두고, **덩어리 안에서만** 왼쪽정렬한다.
            //    flex-start로 바꾸면 네 덩어리의 왼쪽 끝은 칼같이 맞지만(칸 폭이 1fr로 같으므로) 남는 여백이
            //    전부 오른쪽에 몰려 밴드가 왼쪽으로 쏠려 보인다. center는 그 반대로, 여백을 양쪽에 나누는
            //    대신 **네 덩어리의 글자 시작선이 최대 8px까지 어긋난다**(칸마다 내용 폭이 달라서).
            //    시안이 "글자 시작선이 나란한" 그림이면 flex-start로 바꿀 것 — 지금은 시안대로 center다.
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "#fff" }}>
              {/* ⚠️ flexShrink: 0 — 칸이 좁아질 때 아이콘 상자가 찌그러져 타원이 되는 것을 막는다 */}
              <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: svg(s.icon, 20) }} />
              <div style={{ textAlign: "left" }}>
                {/* ⚠️ lineHeight: 1.1 — 기본 줄높이(1.5)면 38px 글자 위아래에 빈 틈이 10px씩 생겨
                       숫자와 설명이 멀어 보인다. 시안처럼 붙이려면 줄높이를 조여야 한다. */}
                <div style={{ fontSize: "clamp(28px,4vw,38px)", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ — 넓은 화면에선 방패 그림과 2단 */}
      <section id="faq" style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(40px,6vw,64px) 24px", scrollMarginTop: 68 }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(28px,4vw,40px)" }}>
          <div style={eyebrow}>FAQ</div>
          <h2 style={h2}>자주 묻는 질문</h2>
        </div>
        <div className="landing-faq-grid">
          <div className="landing-faq-art" style={{ textAlign: "center" }}>
            {/* ⚠️ 2026-08-09 사장님이 만든 3D 방패 그림으로 교체(예전 shield-check.svg는 삭제).
                   원본 PNG 1254×1254·1.0MB → 720×720 WebP 16KB. 화면 표시는 240px이라 3배 화면까지 선명하다.
                   ⚠️ 예전 SVG는 **벡터**라 어떤 배율에서도 선명했지만 이건 사진 형식이다. 그래서 2배가 아니라
                      3배(720px)로 뽑았다 — 화면 배율 225% 같은 어중간한 값에서도 뭉개지지 않게.
                   다시 만들려면 `node scripts/make-landing-images.mjs`(자르는 규칙까지 그 파일에 있다).
                ⚠️ 이 그림은 **투명 배경이 아니라 거의 흰색(254)** 이다. 지금은 이 섹션 바탕도 흰색(255)이라
                   눈에 띄지 않는다(차이 1). 히어로 그림들처럼 `mix-blend-mode: multiply`를 걸어 흰색을 지우는
                   방법도 있지만 **여기서는 일부러 안 썼다** — 흰 바탕 위에서는 곱해도 결과가 똑같아 효과가 없고,
                   안드로이드의 강제 다크모드에서는 배경만 어두워지고 그림은 그대로라 오히려 그림이 뭉개진다.
                   ⚠️ 나중에 이 섹션 배경을 **흰색이 아닌 색**으로 바꾸면 그때는 옅은 네모가 드러난다.
                      그때 multiply를 쓰려면 globals.css 규칙대로 `isolation: isolate`와 짝으로 넣을 것.
                ⚠️ loading="lazy" — 이 그림은 첫 화면 밖(페이지 아래쪽)이고 900px 이하에서는 아예 감춰진다.
                   이게 없으면 브라우저가 먼저 받으려 들어 히어로 표시가 늦어진다(검수 지적). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 장식용 그림. 최적화 대상 아님 */}
            <img src="/shield-check.webp" alt="" width={240} height={240} loading="lazy" decoding="async" />
          </div>
          {/* ⚠️ 아래 질문 카드에도 3단계 카드와 같은 이유로 테두리를 **남긴다** — FAQ 섹션도 배경이
                 없어 순수 흰 바탕이다. 게다가 이건 눌러서 접었다 펴는 **버튼**이라, 경계가 사라지면
                 누를 수 있다는 것 자체를 알 수 없게 된다(검수 지적: 질문 4개가 한 덩어리로 보임). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* 아래 <details>의 테두리·그림자는 globals.css의 `details.landing-faq`가 갖는다
                (마우스 올림 효과가 이기게 하려고). ⚠️ 인라인 style로 다시 옮기면 효과가 죽는다. */}
            {faqs.map((f, i) => (
              <details key={f.q} className="landing-faq" open={i === 0} style={{ background: "#fff", borderRadius: 12, padding: "4px 20px" }}>
                <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "16px 0", fontSize: 16, fontWeight: 700 }}>
                  <span>{f.q}</span>
                  <span className="faq-chevron" style={{ color: "#9CA3AF", flexShrink: 0, width: 18, height: 18, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg('<path d="m6 9 6 6 6-6"/>', 18) }} />
                </summary>
                <div style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.7, padding: "0 0 18px" }}>{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 마지막 CTA (파란 밴드) */}
      {/* 위쪽 패딩이 0이라 scrollMarginTop을 넉넉히(84) 준다 — 68이면 파란 박스 윗부분이 헤더에 가린다 */}
      <section id="contact" style={{ maxWidth: WRAP, margin: "0 auto", padding: "0 24px clamp(56px,8vw,88px)", scrollMarginTop: 84 }}>
        {/* ⚠️ 2026-08-09 사장님이 만든 배너 그림으로 배경 교체. 그림 안에 **물결·왼쪽 점무늬·오른쪽
               얼굴스캔 그림이 이미 그려져 있어서**, 코드로 그리던 ①배경 도트 패턴 ②네 모서리 스캔 프레임 4개를
               **지웠다**(같이 두면 장식이 겹쳐 지저분해진다). 되살리려면 이 커밋을 되돌리면 된다.
            ⚠️ 배경 지정은 전부 globals.css의 `.landing-cta`에 있다(인라인으로 두면 안 되는 이유도 거기 적었다).
               ⚠️ position: "relative"는 **그 CSS가 좁은 화면에서 까는 점무늬(::before)의 기준**이다. 빼지 말 것.
            ⚠️ 그림을 다시 만들려면 `node scripts/make-landing-images.mjs` (자르는 규칙까지 그 파일에 있다). */}
        <div className="landing-cta" style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: "clamp(48px,7vw,72px) 24px", textAlign: "center", boxShadow: "0 20px 44px rgba(37,99,235,0.28)" }}>
            <div style={{ position: "relative" }}>
              <h2 style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 14px", color: "#fff" }}>오늘부터 근태를 정직하게</h2>
              <p style={{ fontSize: 16, color: "rgba(255,255,255,0.85)", margin: "0 0 28px" }}>5분이면 회사 계정을 만들고 직원을 초대할 수 있어요.</p>
              <Link href="/signup" style={{ height: 52, padding: "0 30px", display: "inline-flex", alignItems: "center", borderRadius: 10, background: "#fff", color: "var(--primary)", fontSize: 16, fontWeight: 700, textDecoration: "none", boxShadow: "0 10px 24px rgba(0,0,0,0.18)" }}>무료로 시작하기</Link>
            </div>
        </div>
      </section>

      {/* 푸터 */}
      <footer style={{ borderTop: "1px solid var(--landing-border,#DCE5F4)" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "28px 24px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={logoBox(24, 6, 13)}>근</div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>근태관리</span>
          </div>
          {/* ⚠️ 이용약관·개인정보처리방침은 아직 페이지가 없다. 눌러도 아무 데도 안 가는 링크는 만들지 않는다.
                 페이지가 생기면 여기 글자를 <Link>로 바꾸면 된다. */}
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>© 2026 근태관리 · 이용약관 · 개인정보처리방침</div>
          <a href="#top" aria-label="맨 위로" style={{ width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--landing-border,#DCE5F4)", background: "#fff", color: "var(--text-sub)", display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }} dangerouslySetInnerHTML={{ __html: svg('<path d="m18 15-6-6-6 6"/>', 18) }} />
        </div>
      </footer>
    </div>
  );
}

// ── 하루 시간 띠 (차별점 큰 블록의 오른쪽 그림) ──
// "출퇴근 시각의 차이"와 "실제로 일한 시간"을 같은 폭으로 나란히 놓아 차이를 눈으로 보여준다.
// ⚠️ 그림 파일이 아니라 **네모(div) 몇 개**로 그린다: 숫자를 고칠 때 이미지를 다시 만들 필요가 없고,
//    옆에 붙는 시각·시간 글자가 진짜 글자라 화면 확대·번역에서 그대로 읽힌다.
//    다만 **띠 자체(색 조각)는 화면낭독기가 읽을 수 없으므로** 띠 묶음에 role="img"과 설명을 달아 둔다.
//    (예전엔 조각마다 title만 달았는데, title은 낭독기·터치기기에서 전달되지 않는다 — 검수 지적)
// ⚠️ 화면에 보이는 시간 숫자는 **전부 daySegments에서 계산**한다. 직접 적지 말 것.
function DayBar() {
  const workMin = daySegments.filter((s) => s.work).reduce((a, s) => a + s.min, 0);
  const offMin = DAY_SPAN_MIN - workMin;
  const pct = (min: number) => `${((min / DAY_SPAN_MIN) * 100).toFixed(2)}%`;
  const rowLabel: React.CSSProperties = { fontSize: 13, color: "var(--text-sub)", marginBottom: 7 };
  const barBox: React.CSSProperties = { display: "flex", height: 34, borderRadius: 8, overflow: "hidden" };
  const 설명 = `예시. ${DAY_START} 출근, ${DAY_END} 퇴근으로 ${hhmm(DAY_SPAN_MIN)}. 그중 외출로 기록한 ${hhmm(offMin)}을 빼면 실제로 일한 시간은 ${hhmm(workMin)}.`;
  return (
    <div>
      {/* ⚠️ "예시"라고 반드시 밝힌다 — 이 화면의 다른 숫자(미리보기 카드)는 전부 실제 집계값이라,
             표기가 없으면 이 숫자도 실적으로 오해된다(2026-08-09 사장님의 "목업 데이터 금지" 지시).
             ⚠️ 색을 #9CA3AF(대비 2.5)에서 --text-sub(4.8)로 올리고 12px로 키웠다. 이건 장식이 아니라
                **면책 표시**라, 본문보다 흐리면 광고 심사에서 가장 먼저 지적받는다(검수 지적). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>같은 하루, 두 가지 계산</span>
        <span style={{ fontSize: 12, color: "var(--text-sub)", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 10, padding: "2px 8px" }}>예시</span>
      </div>

      <div role="img" aria-label={설명}>
        <div style={rowLabel}>출근·퇴근 시각의 차이</div>
        <div aria-hidden style={{ ...barBox, background: "#E5EAF3" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, marginBottom: 20, fontSize: 12, color: "var(--text-sub)" }}>
          <span>{DAY_START} 출근</span>
          <span style={{ fontWeight: 700, color: "var(--text)" }}>{hhmm(DAY_SPAN_MIN)}</span>
          <span>{DAY_END} 퇴근</span>
        </div>

        <div style={rowLabel}>실제로 일한 시간</div>
        <div aria-hidden style={barBox}>
          {daySegments.map((s) => (
            <div
              key={s.label}
              title={s.label}   /* 마우스로 짚었을 때만 뜨는 보조 설명. 이것에 정보를 의존하지 않는다 */
              style={{
                width: pct(s.min),
                background: s.work ? "linear-gradient(180deg,#3B82F6,#2563EB)" : "#E5EAF3",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "var(--text-sub)" }}>
          <span>{DAY_START} 출근</span>
          <span style={{ fontWeight: 700, color: "var(--primary)" }}>{hhmm(workMin)}</span>
          <span>{DAY_END} 퇴근</span>
        </div>
      </div>

      {/* 🔴 회색이 "자동으로 빠지는 시간"으로 오해되지 않게 한 줄 밝힌다. 휴게(점심)를 자동으로 빼 주는
             기능은 없다 — 직원이 [외출]로 기록해야 빠진다(lib/break-rule.ts). */}
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.5 }}>
        회색은 직원이 <b style={{ color: "var(--text)" }}>[외출]</b>로 기록한 시간입니다(점심 포함).
      </div>

      {/* 색 설명 — 색만으로 구분하면 색을 구별하기 어려운 분이 읽을 수 없다.
          ⚠️ 괄호 안 시간은 손으로 적지 않고 계산한다(조각을 고쳐도 어긋나지 않게). */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 12, color: "var(--text-sub)", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "linear-gradient(180deg,#3B82F6,#2563EB)", display: "inline-block" }} />일한 시간 ({hhmm(workMin)})
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "#E5EAF3", display: "inline-block" }} />점심·외출 ({hhmm(offMin)})
        </span>
      </div>
    </div>
  );
}

// ── 꺾은선 차트 (일별 출퇴근 기록 추이) ──
// 라이브러리 없이 SVG로 직접 그린다.
// ⚠️ viewBox를 실제 표시 비율(가로가 세로의 약 5배)에 맞춰 놓고 preserveAspectRatio는 기본값을 쓴다.
//    예전처럼 320×120 + preserveAspectRatio="none"으로 하면 가로로 1.9배 늘어나 **점이 타원**이 되고
//    선 두께가 방향마다 달라진다(검수 지적).
// ⚠️ y축 범위는 데이터에서 뽑되 **"보기 좋은 간격"(1·2·2.5·5·10 ×10ⁿ)으로 올림·내림**한다.
//    눈금 숫자를 화면에 적기 때문이다. 예전처럼 최소·최대에 25%씩 덧대면 눈금이 868·1104처럼 나온다.
// ⚠️ 눈금 숫자와 말풍선은 **SVG가 아니라 HTML**로 얹는다. SVG 안에 넣으면 viewBox와 함께 줄어들어
//    폰에서 글자가 5px까지 작아진다. HTML로 두면 크기가 고정되고, 세로 위치를 %로 주면
//    차트가 어떤 폭이든 격자선과 정확히 같은 높이에 붙는다.
// ⚠️ gradientId: SVG의 id는 문서 전체에서 하나뿐이어야 한다. 이 차트를 한 페이지에 두 번 놓을 일이
//    생기면 두 번째에는 반드시 다른 id를 넘겨야 색이 섞이지 않는다(서버 컴포넌트라 useId를 못 쓴다).
function TrendChart({ trend, gradientId = "trendFill" }: { trend: { label: string; count: number }[]; gradientId?: string }) {
  if (trend.length < 2) return null; // 점이 1개 이하면 선을 그릴 수 없다(0개면 아래 계산에서 오류)
  const W = 580, H = 112, PAD_L = 8, PAD_R = 8, TOP = 12, BOTTOM = 96;
  const vals = trend.map((t) => t.count);
  const hi = Math.max(...vals);
  // 🔴 **y축은 반드시 0에서 시작한다.** 예전엔 최솟값 근처에서 시작했는데(잘린 축), 그러면
  //    [3,3,3,3,3,3,4]처럼 1건 차이가 **화면 높이만큼 치솟은 것처럼** 보인다(검수 지적 — 데이터 과장).
  //    여기는 광고 화면이고 지표가 "건수"라 0 기준이 정직하다. **MIN을 다시 데이터에 맞추지 말 것.**
  const MIN = 0;
  // 눈금 간격: (최댓값 / 4)를 넘는 가장 작은 "보기 좋은 수" → 눈금이 3~5개로 떨어진다.
  // 🔴 `|| 1`은 **0으로 나누기를 막는 유일한 방어**다. 지우면 hi=0에서 Math.log10(0)=-Infinity →
  //    mag=0 → step=NaN이 되어 차트가 즉시 깨진다. 그리고 **"전부 0"은 지금 실제로 일어나는 상태다**
  //    (실고객이 아직 0개사라 KPI·추이가 전부 0). 예전 주석은 "감추는 조건 때문에 0인 경우는 안 온다"고
  //    적혀 있었는데, 그 조건을 없앴으므로(2026-08-09) 거짓이 됐다. **절대 정리하지 말 것.**
  const rough = hi / 4 || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  // ⚠️ 2.5는 **자리수(mag)가 10 이상일 때만** 후보로 쓴다. mag=1에서 2.5가 뽑히면 눈금이
  //    "0 / 2.5 / 5 / 7.5"로 소수가 되어 **"출퇴근 기록 2.5건"**이 된다. 하루 9~10건일 때
  //    걸리는데, 직원 4~5명 규모에서 가장 흔한 값이다(검수 지적 — hi/4로 바꾸면서 새로 생긴 결함).
  const cand = mag >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  // Math.max(1, …): 건수 지표라 눈금 간격이 1보다 작아지지 않게 묶는다(hi가 1~3일 때).
  const step = Math.max(1, (cand.find((m) => m * mag >= rough) ?? 10) * mag);
  const MAX = Math.max(step, Math.ceil(hi / step) * step); // 최댓값이 눈금에 딱 걸려도 칸이 0이 되지 않게
  const span = MAX - MIN; // MIN=0, MAX≥step이라 0이 될 수 없다
  const yOf = (v: number) => BOTTOM - ((v - MIN) / span) * (BOTTOM - TOP);
  const pctOf = (y: number) => Math.round((y / H) * 1000) / 10; // SVG y → 상자 높이 대비 %
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const stepX = (W - PAD_L - PAD_R) / (trend.length - 1);
  const pts = trend.map((t, i) => ({ x: r1(PAD_L + i * stepX), y: r1(yOf(t.count)), ...t }));
  // 눈금은 0부터 step씩 MAX까지.
  const ticks = Array.from({ length: Math.round((MAX - MIN) / step) + 1 }, (_, i) => MIN + step * i);

  // 부드러운 곡선(카디널 스플라인): 각 점의 기울기를 "앞뒤 점을 이은 방향"으로 잡아 베지어 제어점을 만든다.
  // 직선으로 이으면(예전 polyline) 각이 져 보였다.
  // ⚠️ 곡선은 점 사이를 **없는 값으로 메운 그림**이다. 이 차트는 "하루 합계"의 흐름을 보여주는
  //    용도라 그 정도 매끄러움은 허용하지만, **정확한 수치를 읽어야 하는 화면**(리포트·법정 근로기록)
  //    에는 쓰지 말 것 — 점 사이 값이 실제보다 높거나 낮게 읽힌다.
  const tan = pts.map((p, i) => {
    const prev = pts[i - 1] ?? p, next = pts[i + 1] ?? p;
    const d = i === 0 || i === pts.length - 1 ? 3 : 6; // 끝점은 한쪽 이웃만 있으므로 나누는 값이 다르다
    return { x: (next.x - prev.x) / d, y: (next.y - prev.y) / d };
  });
  // 제어점의 높이를 TOP~BOTTOM 안으로 가두는 **보험**이다. 원리상 제어점은 (BOTTOM−TOP)/6 = 14단위까지
  // 점 밖으로 벗어날 수 있어, 값이 급하게 튀는 데이터에서는 곡선이 상자를 넘길 여지가 있다.
  // ⚠️ 다만 **현재 7일 실데이터 범위에서는 한 번도 개입하지 않는다**(2차 검수에서 베지어를 구간당 200점
  //    샘플링해 확인: 클램프 유무와 곡선 y범위가 완전히 동일). 즉 지금 모양에는 영향이 없다.
  // ⚠️ 클램프가 실제로 작동하면 그 점의 좌우 접선 대칭이 깨져 **미세한 각(kink)**이 생긴다 —
  //    "상자 밖으로 나감"을 "살짝 각짐"으로 바꾸는 거래다.
  const clampY = (y: number) => r1(Math.min(BOTTOM, Math.max(TOP, y)));
  const curve = pts.slice(1).reduce((d, p, i) => {
    const a = pts[i], ta = tan[i], tb = tan[i + 1];
    return `${d} C${r1(a.x + ta.x)},${clampY(a.y + ta.y)} ${r1(p.x - tb.x)},${clampY(p.y - tb.y)} ${p.x},${p.y}`;
  }, `M${pts[0].x},${pts[0].y}`);
  const area = `${curve} L${pts[pts.length - 1].x},${BOTTOM} L${pts[0].x},${BOTTOM} Z`;
  // 말풍선으로 값을 보여줄 지점 = **가장 기록이 많았던 날**(실데이터라 미리 정할 수 없다).
  // ⚠️ 양 끝(첫날·마지막날)은 고르지 않는다 — 말풍선이 차트 좌우로 잘린다. 그래서 안쪽 점들 중에서만
  //    고르고, 점이 3개 미만이면 안쪽 점이 없으므로 말풍선을 달지 않는다(mark = null).
  // ⚠️ 0건인 점은 절대 가리키지 않는다. 안쪽 점이 전부 0이면 reduce가 그중 첫 점(0건)을 돌려주므로
  //    "8.04 · 0건" 말풍선이 붙는다 — 실제로 도입 직후(활동이 오늘 하루만 있을 때) 가장 흔한 상태다(검수 지적).
  const inner = pts.slice(1, -1);
  const best = inner.length > 0 ? inner.reduce((b, p) => (p.count > b.count ? p : b), inner[0]) : null;
  const mark = best && best.count > 0 ? best : null;

  return (
    <div style={{ background: "#fff", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 12, padding: "16px 18px 12px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>일별 출퇴근 기록</div>
      {/* "최근 N일"의 N은 실제로 그린 점 개수에서 뽑는다(손으로 적으면 기간을 바꿀 때 거짓말이 된다) */}
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 10 }}>최근 {trend.length}일 · 전체 사용자 합계(건)</div>
      <div className="landing-chart-plot">
        {/* 왼쪽 눈금 숫자 — 좁은 화면에선 CSS가 숨긴다(글자끼리 붙어 읽을 수 없어진다).
            aria-hidden: 아래 SVG의 aria-label이 이미 값을 읽어준다. 안 붙이면 화면읽기 프로그램이
            숫자만 문맥 없이 한 번 더 읽는다(검수 지적). 말풍선도 같은 이유로 숨긴다. */}
        {ticks.map((v) => (
          <span key={v} className="landing-ytick" aria-hidden="true" style={{ top: `${pctOf(yOf(v))}%` }}>
            {v.toLocaleString("ko-KR")}
          </span>
        ))}
        {/* 이 상자는 SVG와 크기가 같다 — 말풍선의 % 좌표 기준이 된다.
            ⚠️ 말풍선을 바깥(.landing-chart-plot)에 두면 왼쪽 눈금 자리(padding)까지 100%에 들어가
               가로 위치가 점보다 오른쪽으로 밀린다. */}
        <div style={{ position: "relative" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`최근 ${trend.length}일 일별 출퇴근 기록 수 추이. ${trend.map((t) => `${t.label} ${t.count.toLocaleString("ko-KR")}건`).join(", ")}`}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2563EB" stopOpacity="0.20" />
                <stop offset="1" stopColor="#2563EB" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* vectorEffect="non-scaling-stroke": 선 두께를 화면 크기와 무관하게 유지한다.
                없으면 폰(차트 폭 252px)에서 선이 1.1px까지 얇아져 거의 안 보인다(검수 지적). */}
            {ticks.map((v) => (
              <line key={v} x1={PAD_L} y1={r1(yOf(v))} x2={W - PAD_R} y2={r1(yOf(v))} stroke="#EEF2F7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill={`url(#${gradientId})`} />
            <path d={curve} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {/* 점: 예전엔 6개 모두 흰 속·굵은 테두리라 다 똑같이 튀어 시선이 흩어졌다.
                → 평소 점은 작게 꽉 채우고, 말풍선이 가리키는 점 하나만 크게 + 흰 테두리로 강조한다.
                ⚠️ 점의 반지름은 화면 폭에 따라 **같이 줄어든다**(선 두께만 non-scaling-stroke로 고정).
                   폰(차트 폭 249px = 배율 0.43)에서 지름이 2.7px까지 줄어 2.5px 선에 먹혀 사라지고,
                   강조점의 흰 테두리는 2px 고정이라 파란 심을 덮어 **선이 끊긴 흰 얼룩**으로 보였다(검수 지적).
                   → 폰에서는 CSS(.landing-dot)로 점을 전부 숨긴다. 선·면만 남아 오히려 깔끔하고,
                     그 폭에서는 말풍선도 숨기므로 강조점만 남아 이유 없이 튀는 문제도 함께 사라진다. */}
            {pts.map((p) => (
              p === mark ? null : <circle className="landing-dot" key={p.label} cx={p.x} cy={p.y} r="3.2" fill="var(--primary)" />
            ))}
            {mark && <circle className="landing-dot" cx={mark.x} cy={mark.y} r="5.2" fill="var(--primary)" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          </svg>
          {/* 값 말풍선 — 점 **아래쪽**에 놓는다. 가장 높은 점을 가리킬 때 위에 놓으면 카드 밖으로 잘린다. */}
          {mark && (
            <div className="landing-chart-tip" aria-hidden="true" style={{ left: `${r1((mark.x / W) * 100)}%`, top: `${pctOf(mark.y)}%` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />
              {mark.label} · {mark.count.toLocaleString("ko-KR")}건
            </div>
          )}
        </div>
      </div>
      {/* aria-hidden: 위 SVG의 aria-label이 날짜·건수를 이미 문장으로 읽어준다. 여기까지 노출하면
          화면읽기 프로그램이 "8.01 8.02 …"를 문맥 없이 한 번 더 읽는다(검수 지적). */}
      <div className="landing-chart-x" aria-hidden="true">
        {trend.map((t) => (
          <span key={t.label}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 도넛 차트 (출퇴근 인증 방식 비율) ──
function AuthDonut({ authMix }: { authMix: { label: string; pct: number }[] }) {
  const R = 40, C = 2 * Math.PI * R;
  // 각 조각의 시작 위치(앞 조각들의 합)를 그리기 전에 미리 계산해 둔다.
  // ⚠️ map 안에서 변수를 누적하면 리액트 규칙 위반이다(렌더 중 값 변경 금지) — 린트가 잡는다.
  // ⚠️ 합이 100이 아니어도 조각이 겹치거나 비지 않도록 "전체 합" 기준으로 나눈다.
  const total = authMix.reduce((sum, p) => sum + p.pct, 0) || 1;
  const segs = authMix.map((a, i) => ({
    ...a,
    // 색은 화면 쪽 상수(MIX_COLORS)에서 순서대로 가져온다 — 집계 함수는 색을 모른다.
    // 조각이 색 개수보다 많아지면 마지막 색을 돌려 쓴다(색이 없어 투명해지는 것 방지).
    color: MIX_COLORS[Math.min(i, MIX_COLORS.length - 1)],
    dash: (a.pct / total) * C,
    offset: -(authMix.slice(0, i).reduce((sum, p) => sum + p.pct, 0) / total) * C,
  }));
  return (
    <div style={{ background: "#fff", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 12, padding: "16px 18px 12px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>인증 방식 비율</div>
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 8 }}>전체 사용자가 고른 출퇴근 방식</div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {/* ⚠️ 링 두께 19 + 반지름 R(40)이면 링의 바깥 끝이 40+9.5=49.5로 viewBox 반지름 55 안에 들어온다.
               **R + 두께/2 가 55를 넘으면 링이 잘린다** — 둘 중 하나를 키울 때 반드시 같이 확인할 것. */}
        {/* aria-label은 authMix에서 만든다 — 손으로 "62퍼센트"라 적어두면 비율을 고쳤을 때 라벨이 거짓이 된다(검수 지적) */}
        <svg viewBox="0 0 110 110" width="118" height="118" role="img" aria-label={`출퇴근 인증 방식 비율: ${authMix.map((a) => `${a.label} ${a.pct}퍼센트`).join(", ")}`}>
          <g transform="rotate(-90 55 55)">
            <circle cx="55" cy="55" r={R} fill="none" stroke="#F1F5F9" strokeWidth="19" />
            {segs.map((a) => (
              <circle key={a.label} cx="55" cy="55" r={R} fill="none" stroke={a.color} strokeWidth="19" strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={a.offset} />
            ))}
          </g>
          {/* 가운데를 비워 두면 도넛이 "덜 그려진 것"처럼 보인다 → 옅은 파란 원 + 사람 아이콘을 넣는다.
              ⚠️ 위의 rotate(-90) 그룹 **밖**에 둬야 한다 — 안에 넣으면 아이콘이 90도 누워 버린다. */}
          <circle cx="55" cy="55" r="23" fill="#EFF6FF" />
          <g transform="translate(55 55) scale(1.05) translate(-12 -12)" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="9.6" r="3.4" />
            <path d="M5.9 19.4a6.2 6.2 0 0 1 12.2 0" />
          </g>
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {segs.map((a) => (
          <span key={a.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-sub)" }}>
            {/* 범례 점은 원형 — 도넛(둥근 조각)과 모양을 맞춘다. 색은 조각과 같은 segs에서 가져와야 어긋나지 않는다. */}
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: a.color }} />
            {a.label} {a.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 역할 카드 ─────────────────────────────────────────────────────
// 2026-08-09 사장님 지시로 오른쪽 그림을 제공 일러스트로 교체했다. 그러면서 **구조도 바꿨다**:
//  · 예전: SVG 기기 테두리를 카드 오른쪽 아래에 **절대배치**로 얹고, 그 위에 우리 화면을 본뜬 UI
//         (출근 버튼·관리자 메뉴바·KPI 칸)를 손으로 그려 넣었다. 글자가 그림 위로 올라타지 않게
//         `padding-right`로 자리를 비워 뒀는데, **그림 폭과 그 값이 짝**이라 한쪽만 고치면 겹쳤다.
//  · 지금: 카드 안을 **가로 2칸(글 | 그림)**으로 나눈다. 그림이 자기 자리를 차지하므로 겹칠 수가 없고
//         `padding-right` 짝 맞추기도 필요 없다(그 CSS는 지웠다). 얹었던 UI도 삭제 —
//         일러스트에 화면이 이미 그려져 있어 두 개가 겹쳤다.
//
// 그림은 사장님 원본(1536×1024)에서 **일러스트 한 덩어리씩 통째로** 잘랐다(후광 원 포함):
//   role-employee.webp ← 원본 (90,168)에서 672×618 → 460px폭
//   role-admin.webp    ← 원본 (834,176)에서 648×614 → 460px폭
//   방식: 네 모서리 색을 배경으로 잡고 **허용오차 10 안쪽만 가장자리부터 채워** 투명 처리 → WebP(q82/알파90).
// ⚠️ 배경 판정을 "순백(min≥252)"으로 하면 **거의 지워지지 않는다** — 원본 배경이 순백이 아니라
//    연파랑(약 241,247,254)인 자리도 있어서다. 실제로 그렇게 했다가 투명 픽셀이 1.7%뿐이어서
//    카드 위에 **연파랑 네모가 그대로 드러났다**(검수 지적). **반드시 모서리 실측색 + 허용오차로 할 것.**
// ⚠️ 후광이 잘리지 않게 일러스트 **전체**를 감싸 자른다. 안쪽에서 자르면 후광 단면이 직선으로 남는다.
// ⚠️ 허용오차를 40까지 올려 후광까지 지우면 기기를 더 크게 쓸 수 있지만, **일러스트가 상한다** —
//    배지 주변 스캔 프레임과 방패(연파랑 ~200~220)가 갉아먹혔다(실제로 만들어 보고 확인). 10을 유지할 것.
//
// ⚠️ 그림 폭 200px의 근거: 카드 안쪽 폭 454 − 글 항목이 한 줄에 필요한 최대폭(실측 248) − 간격 18 = 188.
//    (456이었다가 2026-08-09에 카드 테두리 1px×2가 생기면서 **454로 2px 줄었다** — 검수 지적)
//    여기에 10px 더해 200으로 잡았다(8개 항목 중 가장 긴 1개만 두 줄). **더 키우면 항목이 전부 두 줄이 된다**
//    (230으로 했을 때 실측: 글자 폭 208 → 8개 전부 두 줄). 글을 늘리거나 줄이면 이 값을 다시 재야 한다.
const ROLE_ART_W = 200;
function RoleCard({ title, sub, items, iconPath, device }: { title: string; sub: string; items: string[]; iconPath: string; device: "phone" | "laptop" }) {
  // 두 그림의 가로:세로가 조금 달라 각자 넘긴다(460×423 / 460×436)
  const art = device === "phone"
    ? { src: "/role-employee.webp", w: 460, h: 423 }
    : { src: "/role-admin.webp", w: 460, h: 436 };
  const h = Math.round((ROLE_ART_W * art.h) / art.w);
  return (
    // 최소 높이는 globals.css의 .landing-role-card에 있다.
    // ⚠️ 인라인으로 두면 안 된다 — 기기 그림이 사라지는 좁은 화면(≤640px)에서 해제할 방법이 없어
    //    그림도 없는 카드 아래에 빈 띠가 남는다(검수 지적).
    // 🎨 2026-08-09 색 정리(미리보기)로 테두리를 살렸다 — 이 카드가 놓이는 [역할별] 섹션 배경이
    //    연파랑에서 흰색으로 바뀌었기 때문이다. 테두리가 없으면 흰 바탕에 흰 카드가 된다.
    <div className="landing-role-card landing-hover-card" style={{ display: "flex", alignItems: "center", gap: 18, overflow: "hidden", padding: "28px 26px" }}>
      {/* minWidth: 0 — 없으면 글자가 안 줄어들어 그림을 밀어내고 카드가 가로로 넘친다(격자 기본값 함정) */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: "linear-gradient(135deg,#2563EB,#60A5FA)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: svg(iconPath, 20) }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
            <div style={{ fontSize: 13, color: "var(--text-sub)" }}>{sub}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((it) => (
            <div key={it} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ color: "var(--success)", flexShrink: 0, width: 18, height: 18, display: "inline-flex", marginTop: 1 }} dangerouslySetInnerHTML={{ __html: svg('<path d="M20 6 9 17l-5-5"/>', 18) }} />
              <span style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.5 }}>{it}</span>
            </div>
          ))}
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 장식용 이미지. 최적화 대상 아님 */}
      <img className="landing-device" src={art.src} alt="" width={ROLE_ART_W} height={h} loading="lazy" decoding="async" style={{ flexShrink: 0 }} />
    </div>
  );
}

// 비교표 칸 공통 — 칸마다 같은 값을 적지 않으려고 한 곳에 모은다.
// ⚠️ borderCollapse를 쓰지 않고(그러면 둥근 모서리가 안 먹는다) **위·왼쪽 선만** 그려 격자를 만든다.
//    그래서 바깥 테두리는 JSX에서 따로 닫아 준다:
//      · 머리줄 전체 borderTop: 0   (가로선 시작점을 맞추고, 파란 헤더 위 회색 얼룩을 없앤다)
//      · 맨 왼쪽 칸 borderLeft: 0   (세로선 시작점)
//      · 마지막 열 borderRight, 마지막 줄 borderBottom  (안 넣으면 격자가 열린 채 끝난다)
//    ⚠️ 예전 주석은 "맨 위 줄과 맨 왼쪽 칸에서 지운다"고만 적어 뒀는데, 실제로는 머리줄 첫 칸 하나만
//       지워져 있어 가로선이 중간부터 시작하고 오른쪽·아래가 열려 있었다(검수 지적 → 위처럼 고쳤다).
const cmpCell: React.CSSProperties = {
  padding: "13px 14px",
  textAlign: "center",
  borderTop: "1px solid var(--landing-border,#DCE5F4)",
  borderLeft: "1px solid var(--landing-border,#DCE5F4)",
  verticalAlign: "middle",
};

const eyebrow: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--primary)", marginBottom: 10, letterSpacing: "0.02em" };
const h2: React.CSSProperties = { fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 };

function logoBox(size: number, radius: number, fontSize: number): React.CSSProperties {
  return { width: size, height: size, borderRadius: radius, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize, fontWeight: 700, flexShrink: 0 };
}
// ※ 브라우저 창 흉내 줄(신호등 3점)을 걷어내면서 그 점을 만들던 dot() 함수도 함께 지웠다(2026-08-09).
