// 랜딩 페이지 (공개) — 목업 디자인 적용. 서버 컴포넌트(FAQ는 JS 없이 <details>로 동작).
// ⚠️ 섹션 순서·구성은 기존 그대로 두고 "겉모습"만 목업에 맞췄다(2026-08-05 사장님 확정).
//    좁은 화면에서 숨기고 접는 규칙은 globals.css의 `landing-*` 클래스에 있다(서버는 화면 크기를 모른다).
import { GRACE_DAYS } from "@/lib/service-access";
import Link from "next/link";
import { getLandingStats, TREND_DAYS } from "@/lib/public-stats";
import { TRIAL_DAYS } from "@/lib/trial";
// 구독 요금(구간제, 2026-11-20 확정). ⚠️ 금액을 이 파일에 직접 적지 말 것 — 요금은 lib/pricing.ts
//    한 곳에서만 온다. 화면과 청구가 다른 값을 쓰면 "광고한 값과 청구한 값이 다른" 분쟁이 된다.
import { PRICE_TIERS, QUOTE_OVER, formatWon, tierLabel } from "@/lib/pricing";
// 히어로의 3D 일러스트 — 마우스 위치를 읽어야 해서 **그림 한 장만** 클라이언트 컴포넌트로 떼어 냈다.
// 이 페이지는 그대로 서버 컴포넌트다(FAQ도 여전히 JS 없이 <details>로 동작한다).
import { LandingHeroFigure } from "@/app/components/LandingHeroFigure";
// [맨 위로] 떠 있는 버튼 — 스크롤 위치를 알아야 해서 클라이언트 컴포넌트다(아래 푸터 뒤에 놓았다).
import { LandingScrollTop } from "@/app/components/LandingScrollTop";
import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/site";

// 공개 페이지라 방문자마다 DB를 때리면 안 된다 → 5분마다 한 번만 다시 계산하고 그 사이는 같은 화면을 준다.
// ⚠️ 이 값을 0으로 바꾸면 방문자 수만큼 집계 쿼리가 돈다(14일치 근태 기록 스캔). 낮추지 말 것.
export const revalidate = 300;

// ── 검색 결과·공유 미리보기 (2026-11-23 검색 노출 기본 설정) ──
//  · 공통 틀(app/layout.tsx)의 제목은 로그인 뒤 화면 탭 이름("근태관리")이라 그대로 두고, **홈에만** 제품 이름을 단 제목을 준다.
//  · 미리보기 그림 public/og.png(1200×630)는 한글 글꼴이 없어 자동 생성 대신 그림 파일로 만들었다. 문구를 바꾸면 다시 만들 것.
//  · 설명은 lib/site.ts 한 곳 — robots·sitemap·/llms.txt와 같은 값을 쓴다.
export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — 중소기업 근태관리 (얼굴인증·GPS 출퇴근, 실근무시간)` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    locale: "ko_KR",
    title: `${SITE_NAME} — 정직한 실근무시간, 강제하지 않는 얼굴인증`,
    description: SITE_DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: ["/og.png"] },
};

// ── 헤더 메뉴 — 실제로 존재하는 섹션에만 연결한다(빈 링크 금지) ──
const nav = [
  { label: "기능", href: "#features" },
  { label: "도입 절차", href: "#how" },
  { label: "직원/관리자", href: "#roles" },
  { label: "요금제", href: "#pricing" },
  { label: "자주 묻는 질문", href: "#faq" },
  // 2026-08-17: 연락처(전화·이메일)를 CTA 밴드와 푸터에 넣었으므로 라벨을 "문의하기"로 되돌렸다.
  // (한동안 "지금 시작하기"였던 이유: 그때는 이 섹션에 문의 수단이 하나도 없어 라벨이 거짓이었다.)
  // ⚠️ CTA 밴드에서 연락처를 빼면 이 라벨도 함께 되돌릴 것 — 둘이 짝이다.
  { label: "문의하기", href: "#contact" },
];

// ── 사업자 정보 (전자상거래법 제10조 표시사항) ──
// 🔴 **2026-11-22 사장님 지시로 운영 주체를 "뉴가온" → "가온"으로 바꿨다.**
//    상호·대표자·사업자등록번호·주소가 **모두** 바뀌었다(= 예전 뉴가온과 다른 사업자다).
//    전화·이메일·홈페이지 도메인은 그대로 쓴다(사장님 확인). 예전 값은 git 이력에 있다.
//    사장님이 확인해 주신 명의 처리(2026-11-22):
//      · 결제(KICC) 가맹점 명의 = **가온으로 변경 진행 중**
//      · 비즈모아샷 계정·발신번호 등록 = **뉴가온 명의 그대로 유지**(재등록 서류·승인 대기를 피한다)
//        → 문자 발신 명의와 이 화면의 사업자가 **서로 다른 상태**다. 나중에 비즈모아샷이 명의 확인을
//          요구할 수 있다. "왜 다르지?"로 혼선이 생기면 이 줄을 볼 것.
//      · 고객사 계약 = 아직 정식 계약 전  /  · 개인정보처리방침 처리자 = **가온**
// 🔴 **대표자 생년월일은 절대 넣지 않는다** — 사업자등록증에는 있지만 개인정보이고 표시 의무도 아니다.
// ⚠️ 통신판매업 신고번호: **신고는 마쳤고 번호를 기다리는 중**(2026-11-22 사장님). 번호가 나오면
//    아래 BIZ에 `mailOrder: "제0000-경기용인기흥-0000호"` 형태로 넣고 푸터에 한 줄 더한다.
// ⚠️ 이 값들은 **법적 표시 사항**이라 임의로 줄이거나 예쁘게 다듬지 말 것(주소는 사장님이 주신 표기 그대로다).
const BIZ = {
  name: "가온",
  ceo: "이주은",
  // 개인정보 보호법이 표시하도록 한 **정보(보호)책임자**. 대표자와 다른 사람이라 칸을 따로 둔다.
  manager: "박성헌",
  regNo: "373-66-00087",
  address: "경기도 용인시 기흥구 구성로 392",
  tel: "031-281-3980",
  email: "psh01@newgaon.co.kr",
  site: "www.newgaon.co.kr",
};
// tel: 링크에 넣을 번호(하이픈 제거). 화면에 보이는 글자는 하이픈이 있어야 읽기 쉽다.
const TEL_HREF = `tel:${BIZ.tel.replace(/-/g, "")}`;

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

// ── 실제 화면 3장 (기능 카드 아래) — 2026-08-23 ──
// 왜 넣었나: 홈화면이 "AI가 만든 느낌"이라는 지적의 가장 큰 원인이 **제품 화면이 한 장도 없다**는 것이었다
//   (2026-08-23 디자인 검토 5순위). 그림과 설명만으로는 진짜 도는 물건인지 알 수 없다.
//
// 🔴 **이 그림들은 "만든 그림"이 아니라 실제로 돌아가는 화면을 찍은 것이다.**
//    다시 찍으려면: ① `node scripts/seed-demo.mjs "<비밀번호>"` 로 데모 회사 데이터를 만들고
//    ② 로그인해서 각 화면을 캡처한 뒤 ③ 폭 1320px webp로 줄여 public/ 에 같은 이름으로 덮어쓴다.
//    ⚠️ **화면을 그림판으로 그려 넣지 말 것.** 실제와 다른 화면을 광고하면 표시광고법 문제가 된다.
//    ⚠️ 캡처는 **평일에** 할 것 — 주말에 찍으면 날짜 표시가 "일"이 되고 근태 화면에 "휴일근무"가 붙는다.
//
// ⚠️ 히어로(맨 위)에는 넣지 않았다. 그 자리의 그림 폭이 약 640px이라 표 글씨가 8~10px가 되어
//    읽히지 않는다(2026-08-23 실제로 끼워 보고 확인). 되살릴 생각이 들면 그 실측부터 다시 할 것.
// ⚠️ 좌우 교차 배치·좁은 화면 접기는 globals.css의 `.landing-shot-row`가 갖는다(서버는 화면 크기를 모른다).
const appShots = [
  {
    src: "/shot-live.webp",
    title: "지금 누가, 어디서 일하는지",
    desc: "사무실·재택·외근을 한 화면에서 봅니다. 지도에는 사무실 반경만 그리고 직원 개인 위치는 표시하지 않습니다.",
    // ⚠️ 아래 문구는 실제 화면에 있는 것만 적는다. 화면에 없는 기능을 여기 적으면 그게 곧 허위광고다.
    points: ["사무실 반경 안에서만 출근 인정", "개인 위치는 저장하지 않음", "30초마다 자동 갱신"],
  },
  {
    src: "/shot-records.webp",
    title: "지각·조퇴는 자동으로 표시",
    desc: "회사가 정한 출퇴근 기준시각과 유예 시간을 그대로 적용해 판정합니다. 관리자가 일일이 세지 않아도 됩니다.",
    points: ["기준시각·유예시간은 회사가 설정", "실근무 = (퇴근−출근) − 외출", "기간·이름으로 바로 검색"],
  },
  {
    src: "/shot-dashboard.webp",
    title: "오늘 상황을 열자마자",
    desc: "출근 인원, 실근무 평균, 승인 대기 중인 휴가까지 한 화면에 모읍니다. 이번 달 일정도 함께 봅니다.",
    points: ["미출근·지각·조퇴 즉시 확인", "승인 대기 건수 바로 표시", "공휴일·회사 휴무일 자동 반영"],
  },
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
//  2026-08-23 디자인 검토로 4칸 중 2칸을 갈아 끼웠다. **이 파일이 이미 세워 둔 원칙을 스스로 어기고 있었다.**
//   · "5분 / 평균 도입 소요 시간" → 뺐다. "평균"은 여러 회사를 재 봤다는 **통계 주장**인데 잰 적이 없다.
//     (없어져도 정보가 사라지지 않는다 — 히어로 칩과 3단계 카드에 "5분이면 설정 완료"가 그대로 있다.)
//   · "100% / 근로기준법 대응" → 뺐다. 법 대응을 100%라고 단정하면 **지킬 수 없는 약속**이 되고,
//     분쟁이 났을 때 표시광고 문제로 번질 수 있다.
//   · 대신 **증빙되는 숫자**로 채웠다: 무료 체험 30일은 lib/trial.ts의 TRIAL_DAYS를 그대로 쓰고,
//     단말기 0원은 지문·카드 단말기를 안 쓰는 웹 구독이라는 사실 그대로다(비교표에도 있다).
//   · "3년"·"2가지"는 그대로 둔다 — 3년은 lib/work-record-retention.ts가 실제로 지키고(위 주석 참조),
//     2가지는 얼굴인증·GPS 두 방식이 실제로 있다.
const stats = [
  // ⚠️ 여기에 **가격을 넣지 말 것.** 두 가지 이유로 한 번 넣었다가 되돌렸다(2026-08-23 검수).
  //   ① 이 밴드는 요금 섹션보다 **위**에 있다. 여기까지만 보고 나가는 방문자에게 "1,000원"만 보이면
  //      "부가세 별도"가 빠진 광고가 된다(아래 요금제 주석의 표시광고 경고 참조).
  //   ② 881~950px 구간은 이 밴드가 4열이라 한 칸이 132px뿐이다. 부가세 표기를 라벨에 넣으면
  //      "직원 1명당 월(부가세 / 별도)"처럼 **괄호가 갈라져** 두 줄이 된다(실측).
  //  대신 무료 체험 일수를 쓴다 — lib/trial.ts의 TRIAL_DAYS를 그대로 가져오므로 값이 어긋날 수 없다.
  { value: `${TRIAL_DAYS}일`, label: "무료 체험 기간", icon: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>' },
  { value: "3년", label: "근로기록 안전 보존", icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>' },
  { value: "2가지", label: "출퇴근 인증 방식", icon: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>' },
  { value: "0원", label: "단말기 구입 비용", icon: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>' },
];

// ── FAQ ──
/**
 * FAQ에서 예로 드는 구간(두 번째 = 6~10명).
 * ⚠️ `PRICE_TIERS[1]`을 직접 쓰지 않는 이유: lib/pricing.ts에서 구간을 1개로 줄이면 undefined가 되고,
 *    이 배열은 모듈 최상위라 **빌드/프리렌더 단계에서 터진다**(공개 홈화면이 안 뜬다). (검수 중간 5)
 */
const FAQ_TIER_INDEX = Math.min(1, PRICE_TIERS.length - 1);
const FAQ_TIER = PRICE_TIERS[FAQ_TIER_INDEX];
const faqs = [
  { q: "얼굴인증을 꼭 써야 하나요?", a: "아니요. 얼굴인증과 GPS 중 직원이 직접 고를 수 있고, 둘 다 강제가 아닙니다. 생체정보 동의는 언제든 철회·삭제할 수 있어요." },
  { q: "5인 미만 사업장도 쓸 수 있나요?", a: "네. 인원 수 제한 없이 사용할 수 있습니다. 5인 이상 사업장에 필요한 근로시간 기록·보존 기능도 기본으로 제공합니다." },
  // ── 요금 질문 3개 (2026-11-20 구간제 전환과 함께 추가) ──
  //    ⚠️ 금액·구간 이름은 lib/pricing.ts에서 가져온다. 여기 숫자를 직접 적으면 요금표와 어긋난다.
  //    ⚠️ **"자동으로 결제되지 않습니다"라고 쓰지 않는다.** 자동결제(KIS 빌링)는 가입 때 카드 등록을
  //       권하는 방식이라(plan-구독결제-요금제.md 3장), 그 고객은 체험이 끝나면 **실제로 자동 결제된다.**
  //       그날 이 문장은 거짓이 되고 캡처 한 장으로 끝나는 표시광고 분쟁이 된다. (검수 치명 2)
  //       쓸 수 있는 말은 각주와 같은 **"결제는 직접 신청하실 때만 시작됩니다"**다(시작 시점에 한정).
  //    ⚠️ 반대로 **"체험이 끝나도 계속 쓸 수 있다"는 뜻으로도 쓰지 않는다** — 미납 시 직원 출퇴근 차단이
  //       확정돼 있다(lib/trial.ts 주석). 다만 그 차단은 **아직 만들지 않았다.** 그래서 "출퇴근이 멈춘다"고
  //       지금 적으면 그것도 거짓이다. 어느 쪽도 단정하지 않고 "안내드린다"까지만 쓴다.
  //       → 6단계(미납 차단)를 만들 때 이 답에 차단 범위를 **반드시 추가**할 것. (검수 중간 1)
  //    ⚠️ "직원이 줄면 내려간다"는 **시점을 반드시 밝힌다.** 그냥 "내려갑니다"라고 쓰면 월중 감원 시
  //       "지금 내려 달라, 차액 돌려 달라"는 요구가 되고, 환불 정책(plan 4장: 결제한 기간 환불 없음)과
  //       충돌한다. (검수 중간 2)
  { q: "며칠만 일하는 알바도 1명으로 세나요?", a: `재직 중인 직원으로 셉니다. 다만 요금은 구간제라 구간 안에서는 인원이 늘어도 요금이 같습니다. 예를 들어 ${tierLabel(FAQ_TIER_INDEX) ?? ""} 구간은 몇 명이든 월 ${formatWon(FAQ_TIER.monthly)}입니다(부가세 별도).` },
  // ⚠️ "체험이 끝나기 전에 안내드립니다"라고 쓰지 않는다 — **만료 사전 안내를 보내는 기능이 없다.**
  //    `trialStatus`를 쓰는 곳은 관리자 대시보드의 남은 기간 띠와 운영자 목록의 "곧 만료" 분류뿐이고
  //    메일·문자 발송 경로가 없다. 지킬 주체가 없는 약속은 적지 않는다 — 숫자 밴드에서 "100% 근로기준법
  //    대응"을 뺀 것과 같은 기준이다. (검수 중간 3)
  //    대신 **지금도 참이고 결제가 붙은 뒤에도 참인 것**만 적는다: ① 결제는 신청할 때 시작된다(정책)
  //    ② 남은 기간은 로그인 후 화면에 보인다(실제 동작) ③ 계속 쓰려면 유료 신청이 필요하다(확정 정책).
  //    ③이 "안 내면 그냥 계속 쓰는 건가?"라는 오해를 막는다. 차단 **범위**는 6단계에서 추가한다.
  { q: `${TRIAL_DAYS}일 무료 체험이 끝나면 어떻게 되나요?`, a: `결제는 직접 신청하실 때만 시작됩니다. 남은 체험 기간은 로그인 후 관리자 화면 맨 위에 표시되며, 요금은 이 페이지에 공개돼 있습니다. 체험이 끝난 뒤에도 계속 이용하시려면 유료 신청이 필요합니다. 카드 결제가 시작된 뒤에는, 결제 없이 이용 기간이 끝나면 최소 ${GRACE_DAYS}일의 유예 뒤 직원의 새 출근·외출 기록이 멈춥니다. 그때도 관리자 기능과 쌓인 근로기록 조회·엑셀 내보내기는 그대로 쓰실 수 있습니다.` },
  { q: "직원이 늘면 요금은 어떻게 되나요?", a: "구간을 넘을 때만 올라갑니다. 올리기 전에 금액을 먼저 보여 드리고 동의를 받으며, 직원이 줄면 다음 결제분부터 낮은 구간으로 적용됩니다." },
  { q: "기존 급여 프로그램과 연동되나요?", a: "실근무시간·근태 데이터를 내보낼 수 있어 급여 정산에 활용할 수 있습니다. 주요 급여 서비스와의 직접 연동은 순차적으로 추가하고 있습니다." },
  { q: "근로시간 기록은 얼마나 보관되나요?", a: "근로기준법에 따라 3년간 안전하게 보관하며, 언제든 법정 근로기록으로 내보낼 수 있습니다." },
];

// ── 요금제 (사장님 확정 2026-11-20 — **구간제**) ──
//   ① 무료: 30일 체험  ② **직원 수 구간별 정액**, 전부 **부가세 별도**
//   ③ **공개 표의 마지막 구간을 넘으면 공개 가격이 없다(별도 협의).** 지금은 150명이 마지막이다.
//      🔴 이 숫자를 주석에 적어 두지 않는다 — 화면은 `QUOTE_OVER`(마지막 구간의 max 파생값)를 쓴다.
//      구간이 바뀌면 화면은 따라가는데 주석만 옛 숫자로 남아, 다음 사람이 "주석에는 201명이라 적혀
//      있으니 구간이 빠진 게 실수"라고 판단해 **카드로 받을 수 없는 구간을 되살린다**(검수 중간 1).
//      왜 150명에서 끊기는지는 lib/pricing.ts 머리말 ①(KIS 한도는 부가세 포함 총액 기준)에 있다.
//   ④ 경쟁사 가격은 적지 않음  ⑤ **관리자는 1명까지만 과금하지 않는다**(2026-11-23 변경, 그 전 08-09엔 관리자 전부 제외)
//      — 재직 직원 + 2명째부터의 관리자(lib/pricing-server.ts FREE_ADMIN_COUNT).
//   ⚠️ 2026-08-09의 "직원 1명당 1,000원 / 최소 결제 인원 없음"은 **폐기됐다.** 알바·계약직이 며칠만 일해도
//      1명분이 과금되면 고객이 그들을 등록하지 않아 근로기록에 구멍이 난다(사장님 지적 2026-11-20).
//   ⚠️ **금액을 이 파일에 적지 않는다.** 구간표는 lib/pricing.ts 한 곳에만 있다(위 import 주석 참조).
//   ⚠️ 가격은 고객과의 약속이다. 숫자·구간을 바꿀 때는 **반드시 사장님 확인**을 받는다.
//   ⚠️ "부가세 별도"는 표시광고 상 반드시 함께 보여야 한다(빼면 5,500원을 5,000원이라 광고한 셈이 된다).
//      규칙은 **"금액이 보이는 모든 자리"**다(개수를 세어 적지 말 것 — 자리가 늘면 주석만 틀어진다).
//      지금은 제목(h2)·요금표 caption 2개·FAQ 문장이 해당된다.
//   근거·결정 과정·앞으로의 단계: 루트 plan-구독결제-요금제.md

/**
 * 홈화면 요금표에서 접지 않고 바로 보여 줄 구간 수. 타겟이 중소기업 사무직이라 30명까지는 펼쳐 둔다.
 * ⚠️ `Math.min`을 쓰는 이유: lib/pricing.ts에서 구간을 6개 이하로 줄이면 `PRICE_TIERS[TIERS_SHOWN - 1]`이
 *    undefined가 되어 **공개 홈화면이 통째로 500**이 된다. "요금은 pricing.ts만 고치면 된다"고 적어 둔
 *    약속이 홈페이지를 내리게 하면 안 된다. (검수 중간 5)
 */
const TIERS_SHOWN = Math.min(6, PRICE_TIERS.length);
/** 접어 둘 구간이 실제로 있는지. 없으면 `<details>`를 아예 그리지 않는다. */
const HAS_FOLDED_TIERS = PRICE_TIERS.length > TIERS_SHOWN;
// 여기 적는 것은 **실제로 있는 기능만**이다(홈화면 비교표와 같은 원칙).
//  · 없는 기능을 적으면 그대로 허위광고가 된다. 새 줄을 넣기 전에 코드에 그 기능이 있는지 확인할 것.
const priceIncludes = [
  "얼굴인증·GPS 출퇴근 — 직원이 직접 고름(강제 없음)",
  "실근무시간 자동 계산 — 외출 기록만큼 빼고 셈",
  "주 52시간·초과근무 자동 집계 + 한도 경고 표시",
  "근로기록 보관 + 엑셀 내보내기",
  // ⚠️ "야근"이 아니라 **초과근무**다 — 제품 안 라벨이 전부 그렇다(lib/pending-approvals.ts).
  //    홈화면에서 "야근 신청"을 본 고객은 로그인 후 그 메뉴를 찾지 못한다.
  "휴가·근태정정·외출·재택·초과근무·출장 신청과 결재",
  // ⚠️ [PC 자동 잠금]은 일부러 뺐다(검수 지적). 기능은 있지만 **고객이 받을 방법이 아직 없다** —
  //    윈도우 전용 설치 프로그램인데 배포 파일(.exe/.zip)이 제품 어디에도 없고, 교대근무 회사는
  //    아예 동작하지 않는다(lib/pcoff-policy.ts: shift_unsupported). 받을 수 없는 것을 요금에
  //    포함시키면 허위광고다. **배포 경로가 생기면 조건과 함께 다시 넣을 것.**
];

const WRAP = 1080;
// ⚠️ 이 함수의 결과는 dangerouslySetInnerHTML로 그대로 삽입된다.
//    **반드시 이 파일 안에 직접 적은 글자(리터럴)만** 넣을 것. DB 값·사용자 입력을 넣으면 즉시 보안 구멍(XSS)이 된다.
const svg = (path: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

// ── 검색엔진·AI가 읽는 구조화 정보(JSON-LD, schema.org) — 2026-11-23 ──
//  🔴 화면과 **같은 데이터**에서 만든다: 요금은 PRICE_TIERS, 질문·답은 위 faqs, 사업자는 BIZ.
//     따로 적으면 화면과 어긋나 "검색에 보인 값과 화면 값이 다른" 표시광고 문제가 된다.
//  · 요금은 부가세 별도 월 요금이다(valueAddedTaxIncluded: false).
//  · 넣을 때 "<"를 <로 바꾼다(Next 공식 안내 — 스크립트 태그 탈출 방지). 지금은 모두 이 파일의 리터럴이다.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: BIZ.name,
      url: SITE_URL,
      email: BIZ.email,
      telephone: BIZ.tel,
      address: { "@type": "PostalAddress", streetAddress: BIZ.address, addressCountry: "KR" },
    },
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "ko",
      publisher: { "@id": `${SITE_URL}/#org` },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "KRW",
        lowPrice: PRICE_TIERS[0].monthly,
        highPrice: PRICE_TIERS[PRICE_TIERS.length - 1].monthly,
        offerCount: PRICE_TIERS.length,
        description: `직원 수 구간별 월 요금(부가세 별도), ${QUOTE_OVER}명 초과는 별도 협의. ${TRIAL_DAYS}일 무료 체험.`,
        priceSpecification: { "@type": "UnitPriceSpecification", priceCurrency: "KRW", minPrice: PRICE_TIERS[0].monthly, unitText: "월", valueAddedTaxIncluded: false },
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

export default async function Home() {
  // 홈화면 미리보기에 쓸 **실제 통계**. 값이 0이어도 그대로 보여준다("처음부터 보여줘", 2026-08-09).
  // 미리보기를 감추는 경우는 **DB 조회 실패(live.ok === false)** 하나뿐이다.
  // ⚠️ 변수명이 `live`인 이유: 이 파일에는 아래쪽 숫자 밴드용 모듈 상수 `stats`가 이미 있다.
  //    `stats`로 두면 그것을 덮어버려 밴드가 깨진다(실제로 한 번 깨뜨렸다).
  //
  // 🔵 **SHOW_LIVE_PREVIEW = false 로 미리보기를 덮어 두었다 (2026-08-17 사장님 지시).**
  //    이유: 가입자가 아직 적어서 0에 가까운 숫자가 그대로 보이는 것이 오히려 손해다.
  //          그래서 히어로 바로 아래에 WHY(차별점) 섹션이 오게 했다.
  //    ▶ **다시 열려면 아래 값을 true 로만 바꾸면 된다.** 화면 코드·집계 코드는 지우지 않고 그대로 뒀다.
  //    ⚠️ false인 동안에는 DB 집계(getLandingStats)도 아예 돌리지 않는다 — 보이지도 않는 화면 때문에
  //       방문자마다 14일치 근태 기록을 스캔할 이유가 없다. 그래서 live 가 null 일 수 있다.
  const SHOW_LIVE_PREVIEW = false;

  // 🔵 **실제 화면 3장을 끄는 스위치 (2026-08-23).**
  //    false 로 바꾸면 기능 설명 아래의 "실제 화면" 구역이 통째로 사라지고, 그 전 모습으로 돌아간다.
  //    화면 코드·그림 파일(public/shot-*.webp)·CSS(.landing-shot-row)는 지우지 않고 그대로 둔다 —
  //    다시 켤 때 한 글자만 고치면 되게 하려는 것이다(위 SHOW_LIVE_PREVIEW 와 같은 방식).
  const SHOW_APP_SHOTS = true;
  const live = SHOW_LIVE_PREVIEW ? await getLandingStats() : null;
  const peek = !live ? [] : [
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
      {/* 검색엔진·AI용 구조화 정보 — 화면에는 보이지 않는다(위 jsonLd 주석) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
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
          {/* 로고 — 2026-08-17 사장님 지시로 파란 "근" 네모 + "근태관리" 글자를 걷어내고 가온 로고 그림으로 바꿨다.
              (그 둘을 만들던 `logoBox()` 헬퍼도 쓰는 곳이 없어져 함께 지웠다. 푸터도 같이 바뀌었다.)
              ⚠️ 이 로고는 **투명 배경 PNG에서 뽑은 webp**다. 히어로 그림들처럼 흰 바탕으로 구워져 있지
                 않으므로 `mix-blend-mode: multiply`를 붙이지 말 것 — 붙이면 파란 심볼이 배경색에 물든다.
              ⚠️ width/height 속성은 **원본 크기(144×120)**를 그대로 적는다. 브라우저가 그 비율로 자리를
                 미리 잡아 주어 그림이 늦게 와도 메뉴가 밀리지 않는다. 화면에 그리는 크기는 style의 height다.
              ⚠️ 헤더 높이가 60px이라 로고 40px + 위아래 10px 여백이다. 로고를 더 키우려면 헤더 높이부터
                 늘려야 한다(안 그러면 로고가 메뉴바를 꽉 채워 답답해진다).
              ⚠️ 다시 뽑으려면 `node scripts/make-logo.mjs` (원본 경로까지 그 파일에 적혀 있다). */}
          {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 로고. 최적화 대상 아님 */}
          <img src="/logo.webp" alt="가온" width={144} height={120} style={{ height: 40, width: "auto", display: "block", flexShrink: 0 }} />
          <nav className="landing-nav">
            {nav.map((n) => (
              <a key={n.href} href={n.href}>{n.label}</a>
            ))}
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/login" style={{ height: 40, padding: "0 16px", display: "flex", alignItems: "center", color: "#374151", fontSize: 15, fontWeight: 700, textDecoration: "none", borderRadius: 7 }}>로그인</Link>
            {/* ⚠️ 글자가 "무료로 시작하기"가 아니라 **"회원가입"**이다(2026-08-17 사장님 지시).
                   여기는 [로그인] 바로 옆이라 두 버튼이 짝으로 읽히는 자리 — 무엇을 하는 버튼인지가 먼저다.
                   히어로·요금제·맨 아래 배너의 "무료로 시작하기"는 **광고 문구**라 그대로 두었다(같이 바꾸지 말 것). */}
            <Link href="/signup" style={{ height: 40, padding: "0 18px", display: "flex", alignItems: "center", borderRadius: 7, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", boxShadow: "0 6px 16px rgba(37,99,235,0.28)" }}>회원가입</Link>
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
      {/* 🎨 2026-08-17 배경 되살리기: #FAFBFD(거의 흰색) → 옅은 파랑 그라데이션.
             2026-08-09에 파랑을 52.6% → 12.2%까지 걷어냈더니 화면이 허전해졌다는 사장님 지적을 받아
             **일부만** 되돌린다(전부가 아니다). 지금은 섹션 기준 약 30%다.
          ⚠️ 히어로 배경이 파래지면 함께 다시 봐야 하는 것들 (2026-08-17 전부 재계산했다):
             · 아래 배지 알약 #D3E1FA — 상단색 #E8F0FE 위에서 대비 **1.15**. 2026-08-06에 파란 히어로에서
               확보했던 1.16과 같은 수준이라 그대로 둔다. 실제로 글자를 읽히게 하는 건 알약색이 아니라
               진한 글자색(#1D4ED8)이고, 그 대비는 배경과 **무관하게 동일**하다.
             · 물결·인물 그림의 mix-blend-mode: multiply — **이제 진짜로 일한다.** 이걸 지우면 흰 네모 두 개가
               즉시 드러난다(거의 흰색이던 시절엔 하는 일이 없어서 "그래도 지우지 말라"고만 적혀 있었다).
             · 고정 헤더 그림자 — 헤더는 아래 흰 섹션 위로도 지나가므로 **그대로 둔다**(빼면 흰 구간에서
               헤더와 본문 경계가 1px 선 하나만 남는다).
             · "기능 둘러보기" 버튼(흰 배경) — 파란 바탕 위라 오히려 또렷해진다. 손대지 않는다. */}
      <div className="landing-hero-wrap" style={{ background: "linear-gradient(180deg,#E8F0FE 0%,#F4F8FF 45%,#FFFFFF 100%)" }}>
        {/* ⚠️ textAlign을 인라인에서 뺐다(2026-08-17). 넓은 화면은 2단(글 왼쪽·그림 오른쪽)이라 왼쪽 정렬,
               좁아지면 1단으로 접으며 가운데 정렬로 돌아가야 하는데 **인라인 style은 CSS가 못 이긴다.**
               그래서 정렬은 전부 globals.css의 `.landing-hero-copy`가 갖는다. */}
        {/* ⚠️ 아래 여백을 clamp(48,8vw,80) → clamp(36,5vw,56)으로 줄였다(2026-08-17).
               미리보기 카드 아래에서 다음 섹션 제목까지 **168px**이 비어 있어 히어로와 본문이
               끊겨 보였다(실측: 여기 80 + #features 위 88). 아래 #features의 위 여백도 함께 줄여
               112px로 맞춘다 — **두 값이 짝이다. 한쪽만 고치면 다시 어긋난다.**
               ⚠️ 위 여백(104px)은 그대로 둔다. 고정 헤더(61px) 바로 아래라 여기를 줄이면 답답해진다. */}
        <section className="landing-hero-inner" style={{ position: "relative", maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,10vw,104px) 24px clamp(36px,5vw,56px)" }}>
          {/* 배경 그림(물결 + 사람·방패)은 globals.css의 `.landing-hero-wrap::before`가 깐다.
              여기에 <img>로 두지 않는 이유: 글자 뒤에 깔리는 장식이라 문서 내용이 아니고,
              좁은 화면에서 통째로 빼야 하는데 그건 CSS만 할 수 있기 때문이다. */}
          {/* ── 2단 히어로 (2026-08-17) ──
                 예전에는 글이 **가운데 정렬**이고 그림은 `.landing-hero-inner::before`로 오른쪽 뒤에
                 깔리는 배경 장식이었다. 그때는 겹침을 `maxWidth: 700`(글상자)과 CSS의 `354px`(그림 잉크
                 시작점)이 **짝**으로 막았다 — 한쪽만 고치면 글자가 그림 위로 올라탔다.
                 지금은 **격자로 칸을 나눠** 겹칠 자리 자체를 없앴다. 그래서 그 두 숫자가 사라졌다.
                 ⚠️ 되돌릴 일이 생기면 그 짝을 함께 되살릴 것(한쪽만 되살리면 겹친다).
                 ⚠️ 좁은 화면(≤960px)에서 1단으로 접는 규칙은 globals.css에 있다 — 서버는 화면 크기를 모른다. */}
          <div className="landing-hero-cols">
          <div className="landing-hero-copy">
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
            {/* ⚠️ display·flexWrap·justifyContent를 인라인에서 뺐다 — 2단일 땐 왼쪽, 1단으로 접히면
                   가운데여야 하고 칩 줄은 넓은 화면에서 격자로 바뀌는데, **인라인 style은 CSS가 못 이긴다.**
                   `.landing-hero-row`가 갖는다(칩 줄도 같다). */}
            <div className="landing-hero-row" style={{ gap: 12 }}>
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
            <div className="landing-hero-row landing-hero-chips" style={{ gap: 22, marginTop: 34 }}>
              {chips.map((c) => (
                <div key={c.text} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, fontSize: 13, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--primary)", width: 15, height: 15, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg(c.icon, 15) }} />
                  {c.text}
                </div>
              ))}
            </div>
          </div>

          {/* 오른쪽 3D 일러스트 (2026-08-17 사장님 제작, ChatGPT 이미지).
              원본 1536×1024 PNG 1.2MB → public/hero-person.webp 1279×854 30.7KB.
              다시 만들려면 `node scripts/make-hero-art.mjs "<원본.png>"` (자르는 규칙까지 그 파일에 있다).
              ⚠️ 이 그림은 **투명 배경이 아니라 흰 바탕으로 구워져** 있다. globals.css의
                 `.landing-hero-figure img`가 mix-blend-mode: multiply로 흰 부분을 지운다 —
                 **그 blend를 지우면 흰 네모가 즉시 드러난다**(물결 그림과 같은 장치).
              ⚠️ alt=""인 이유: 옆 글자가 같은 내용을 이미 말하고 있어 화면낭독기가 두 번 읽을 필요가 없다.
                 다만 예전 배경(::before)과 달리 **문서에 있는 <img>**라, 좁은 화면에서 숨기는 일은
                 globals.css가 한다(서버는 화면 크기를 모른다).
              ⚠️ loading="eager" + fetchPriority="high" — 첫 화면에 보이는 그림이다. lazy로 두면
                 스크롤 없이 보이는 자리가 잠깐 비어 있다(FAQ 방패와 반대 이유).
              ── 2026-08-17 움직임 추가 ─────────────────────────────
              ① 페이지가 열릴 때 아래에서 한 번 떠오르고 ② 그 뒤로는 마우스 방향으로 최대 6° 기운다
              (사장님이 미리보기에서 고르신 조합·세기다).
              ⚠️ 마우스 위치를 읽어야 해서 **이 그림만** 클라이언트 컴포넌트로 떼어 냈다. 이 페이지 자체는
                 그대로 서버 컴포넌트다. <img>의 속성(alt·크기·eager 등)은 그 파일로 그대로 옮겨 갔다.
              🔴 그 파일과 globals.css에 **"움직임을 감싼 상자에 걸면 그림 뒤에 흰 네모가 드러난다"**는
                 경고가 있다. 되돌리거나 손볼 때 반드시 먼저 읽을 것. */}
          <LandingHeroFigure />
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
          {/* 🔵 2026-08-17: 위 SHOW_LIVE_PREVIEW 가 false라 지금은 이 블록이 통째로 렌더되지 않는다.
                 (live 가 null이 되므로 아래 조건에서 걸린다) 되살리는 방법은 그 상수 옆 주석 참고. */}
          {live && live.ok && (
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
        {/* ⚠️ 위 여백만 clamp(40,5vw,56)으로 줄였다(2026-08-17) — **히어로 아래 여백과 짝**이다.
               둘을 합쳐 168px이던 빈 공간을 112px로 줄인 것이니 한쪽만 되돌리지 말 것.
               아래 여백은 clamp(56,8vw,88) 그대로다 — 다음 섹션(#how)과의 간격은 문제가 없었다.
               ⚠️ 위·아래를 따로 주는 섹션은 여기뿐이다(#roles·#pricing은 상하 같은 값). 히어로 바로
                  다음이라는 특수 사정 때문이고, 다른 섹션에 이 패턴을 복사하지 말 것. */}
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(40px,5vw,56px) 24px clamp(56px,8vw,88px)" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <div style={eyebrow}>왜 필요한가</div>
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

          {/* ── 실제 화면 3장 (2026-08-23 사장님 지시) ──
                 🔵 **끄고 싶으면 이 파일 위쪽의 `SHOW_APP_SHOTS` 를 false 로만 바꾸면 된다.**
                    화면 코드도 그림 파일도 지우지 않는다 — 되돌리기가 한 글자면 끝나게 해 둔 것이다.
                 ⚠️ 기능 카드와 비교표 **사이**에 두었다. 순서에 이유가 있다:
                    "무엇을 해 주는가(카드)" → "실제로 이렇게 생겼다(화면)" → "기존 방식과 뭐가 다른가(표)".
                    표 뒤로 옮기면 이미 결론을 읽은 뒤에 증거가 나와 힘이 빠진다.
                 ⚠️ loading="lazy" — 스크롤해야 보이는 자리다. eager로 두면 첫 화면이 뜨는 속도를
                    이 그림 세 장(약 194KB)이 붙잡는다. 히어로 그림과 정반대 이유다. */}
          {SHOW_APP_SHOTS && (
            // ⚠️ 아래 여백을 여기서 준다. 다음에 오는 비교표가 갖고 있는 `marginTop: 40` 만으로는
            //    위(기능카드와 72px)보다 아래가 좁아 이 구역이 비교표에 붙어 보인다(실측 72 vs 40).
            //    **비교표의 40을 고치지 않는 이유**: 아래 스위치를 꺼서 이 구역이 사라지면
            //    비교표 위 간격이 원래대로 40이어야 한다. 여기서 주면 켤 때만 늘어난다.
            // ⚠️ marginBottom이 아니라 **paddingBottom**이다. margin으로 주면 바로 아래 비교표의
            //    marginTop(40)과 **상쇄되어 큰 쪽 하나만 남는다**(2026-08-23 실측: 32를 줬는데 간격이
            //    40 그대로였다). padding은 상쇄되지 않아 40 + 32 = 72px로 위와 짝이 맞는다.
            <div style={{ marginTop: "clamp(44px,6vw,72px)", paddingBottom: "clamp(4px,2.3vw,32px)" }}>
              <div style={{ textAlign: "center", marginBottom: "clamp(28px,4vw,40px)" }}>
                <div style={eyebrow}>실제 화면</div>
                <h3 style={{ fontSize: "clamp(19px,2.4vw,26px)", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 6px" }}>말로만 설명하지 않겠습니다</h3>
                <p style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6, margin: 0 }}>
                  아래는 실제로 동작하는 화면을 그대로 찍은 것입니다.
                </p>
              </div>
              {/* ⚠️ 뒤집는 줄을 CSS의 `:nth-child(even)`에 맡기지 않고 여기서 직접 지정한다 —
                     이 구역의 첫 자식이 위 제목 덩어리라 번호가 밀려 엉뚱한 줄이 뒤집힌다(실측 확인). */}
              {appShots.map((s, i) => (
                <div key={s.src} className={i % 2 === 1 ? "landing-shot-row reverse" : "landing-shot-row"}>
                  <div className="landing-shot-copy">
                    <h4 style={{ fontSize: "clamp(18px,2.1vw,22px)", fontWeight: 700, letterSpacing: "-0.01em", margin: "0 0 10px" }}>{s.title}</h4>
                    <p style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.65, margin: "0 0 16px" }}>{s.desc}</p>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                      {s.points.map((p) => (
                        <li key={p} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                          <span style={{ color: "var(--success)", flexShrink: 0, width: 17, height: 17, display: "inline-flex", marginTop: 1 }} dangerouslySetInnerHTML={{ __html: svg('<path d="M20 6 9 17l-5-5"/>', 17) }} />
                          <span style={{ fontSize: 14.5, lineHeight: 1.5 }}>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 화면 캡처. next/image의 최적화 대상이 아니다(이미 webp로 줄여 뒀다) */}
                  <img src={s.src} alt={`${s.title} — 실제 화면 예시`} width={1320} height={825} loading="lazy" decoding="async" />
                </div>
              ))}
            </div>
          )}

          {/* ── 기존 방식과의 비교표 ──
              ⚠️ 표는 좁은 화면에서 줄일 수 없다(칸이 4개라 글자가 세로로 무너진다).
                 그래서 **표만 가로로 밀어 보는 상자**에 담는다. 페이지 자체는 가로 스크롤이 생기지 않는다.
              ⚠️ 마우스 올림 효과(.landing-hover-card)는 주지 않는다 — 표는 읽는 것이고,
                 움직이면 가로로 밀어 보는 동작과 충돌한다. */}
          {/* 🎨 2026-08-17: 비교표를 **연파랑 카드**로 감쌌다.
                 이 섹션(#features)은 흰 배경인데 차별점 블록 + 카드 2개 + 비교표까지 세로로 길어서
                 스크롤하면 흰 화면이 계속 이어졌다(사장님 "횡하다"). 섹션 전체를 파랗게 하지 않고
                 비교표만 감싼 이유: 비교표는 **별도 <section>이 아니라 이 섹션 안**이라, 화면 끝까지 가는
                 배경을 주려면 구조를 갈라야 한다(위험). 카드로 감싸면 인라인 한 줄로 되고 되돌리기도 쉽다.
              🔴 **카드색을 --landing-bg(#F5F8FF)보다 진하게 만들지 말 것.** 처음엔 #E8F0FD로 했는데,
                 표 본문의 회색 글자(--text-sub #6B7280) 대비가 **4.22**로 떨어져 읽기 기준(4.5)을 밑돌았다
                 (흰 배경 시절엔 4.83이었다 — 내가 만든 회귀였다). #F5F8FF에서 4.55로 겨우 넘긴다.
                 → 이보다 조금이라도 진하게 하려면 **본문 글자색부터 진하게 바꿔야 한다.** 배경만 만지면 안 된다.
              ⚠️ 카드가 --landing-bg와 같은 색이 되면서 표 머리줄이 묻히므로, **머리줄을 흰색으로 뒤집었다**
                 (아래 <th> 참고). 이 카드와 그 흰 머리줄은 **짝**이다 — 카드를 빼면 흰 머리줄이 흰 섹션에
                 묻혀 사라지므로, 되돌릴 땐 둘을 함께 되돌릴 것.
              ⚠️ 안쪽 여백이 생기므로 좁은 화면에서 표가 밀어 볼 수 있는 폭이 그만큼 줄어든다.
                 가로 스크롤은 `.landing-compare-scroll` 안에서만 생기므로 페이지는 여전히 안 밀린다. */}
          <div style={{ marginTop: 40, background: "var(--landing-bg,#F5F8FF)", borderRadius: 16, padding: "clamp(22px,3vw,32px) clamp(16px,2.5vw,28px)" }}>
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
                        // ⚠️ 2026-08-17: 남의 칸 머리줄 바탕을 --landing-bg(#F5F8FF) → **흰색**으로 뒤집었다.
                        //    비교표를 감싼 카드가 --landing-bg와 같은 색이 되면서 머리줄이 카드에 묻혔기 때문이다
                        //    (카드를 더 진하게 하는 길은 막혀 있다 — 위 카드 주석의 대비 4.22 이야기 참고).
                        //    덤으로 글자 대비도 4.55 → 4.83으로 올라간다.
                        //    ⚠️ **이 흰색은 감싼 카드와 짝이다.** 카드를 없애면 흰 섹션 위 흰 머리줄이 되어 사라진다.
                        // ⚠️ 우리 칸 좌우에 2px 파란 기둥을 세운다 — 아래 <td>와 이어져 **열 하나가 카드처럼**
                        //    보이게 하는 장치다(2026-08-17). 머리줄이 그 카드의 지붕이라 위 모서리만 둥글다.
                        //    ⚠️ 이 2px은 <td> 쪽 2px과 **같은 값이어야** 기둥이 어긋나지 않는다. 함께 고칠 것.
                        //    ⚠️ 그림자로 띄우지 않은 이유: 셀이 6줄이라 셀마다 그림자가 겹쳐 지저분해지고,
                        //       가로로 밀어 보는 상자(.landing-compare-scroll) 안이라 좌우가 잘린다.
                        <th key={c} scope="col" style={{ ...cmpCell, fontWeight: 700, borderTop: 0, borderLeft: ours ? "2px solid #1D4ED8" : cmpCell.borderLeft, borderRight: ours ? "2px solid #1D4ED8" : undefined, color: ours ? "#fff" : "var(--text-sub)", background: ours ? "linear-gradient(135deg,#1D4ED8,#2563EB)" : "#FFFFFF", borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>{c}</th>
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
                          // ⚠️ 2026-08-17: 우리 칸을 **떠 있는 카드**처럼 만든다(머리줄 <th>와 한 짝).
                          //    · 바탕을 rgba(37,99,235,0.06) → **흰색**으로. 감싼 카드(#F5F8FF) 위에 흰 기둥이
                          //      서면서 한 단계 앞으로 나와 보인다. 글자 대비도 15.5 → 17.4로 올라간다.
                          //    · 좌우에 2px 파란 기둥. **머리줄의 2px과 같은 값이어야** 기둥이 어긋나지 않는다.
                          //      머리줄은 #1D4ED8(그라데이션 시작색), 본문은 #2563EB(주색) — 위에서 아래로
                          //      옅어지는 흐름이라 일부러 다르게 뒀다. 둘을 같게 만들면 지붕과 기둥이 딱 끊겨 보인다.
                          //    · 마지막 줄에만 아래 모서리를 둥글게 = 카드의 바닥. borderCollapse가 separate라
                          //      td에 border-radius가 먹는다(collapse로 바꾸면 둥근 모서리가 사라진다).
                          <td key={compareCols[i]} style={{ ...cmpCell, borderLeft: ours ? "2px solid #2563EB" : cmpCell.borderLeft, borderRight: ours ? "2px solid #2563EB" : undefined, borderBottom: last ? (ours ? "2px solid #2563EB" : edge) : undefined, borderBottomLeftRadius: last && ours ? 10 : undefined, borderBottomRightRadius: last && ours ? 10 : undefined, color: ours ? "var(--text)" : "var(--text-sub)", fontWeight: ours ? 700 : 400, background: ours ? "#FFFFFF" : "transparent" }}>
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
            <div style={eyebrow}>도입 절차</div>
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

      {/* 요금제 — 상품이 하나뿐이라 요금제도 하나다. 등급표(Basic/Pro)를 만들지 않는다.
             ⚠️ 배경을 흰색으로 두는 이유: 바로 위가 진한 파란 숫자 밴드다. 여기까지 색을 깔면
                파란 덩어리가 두 개 붙어 화면이 무거워진다(2026-08-09 색 정리의 취지).
             ⚠️ 카드의 배경·테두리·둥근모서리·그림자는 인라인에 두지 않는다 — `.landing-hover-card`가 갖는다.
                인라인으로 주면 마우스 올림 효과가 **조용히 안 먹는다**(인라인이 CSS를 이긴다). */}
      {/* 🎨 2026-08-17: 흰색 → 연파랑. 위 [도입 3단계]와 **똑같은 페이드 그라데이션**을 쓴다
             (48px 구간에서 흰색↔연파랑을 흐리게 이어 붙여 섹션 경계에 딱딱한 선이 안 생기게 하는 장치).
             ⚠️ 두 곳이 같은 식을 쓴다 — 한쪽만 고치면 두 섹션의 색이 어긋난다. 고칠 땐 둘 다 고칠 것.
             ⚠️ 이 섹션 안 요금 카드는 흰색이라 연파랑 바탕 위에서 저절로 떠 보인다(테두리 그대로 유지). */}
      <section id="pricing" style={{ background: "linear-gradient(180deg,#FFFFFF 0,var(--landing-bg,#F5F8FF) 48px,var(--landing-bg,#F5F8FF) calc(100% - 48px),#FFFFFF 100%)", scrollMarginTop: 68 }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(48px,7vw,72px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(28px,4vw,40px)" }}>
            <div style={eyebrow}>요금제</div>
            {/* ⚠️ "쓴 만큼만"이라고 쓰지 않는다 — 종량제(출근한 날만 과금)로 읽힌다.
                   실제는 **직원 수 구간별 정액**이다(2026-11-20 구간제 전환. 그 전엔 인원 수 × 정액이었다).
                ⚠️ 관리자는 **1명까지** 세지 않는다(2026-11-23 변경 — 2명째부터 셈). 단위는 여전히 "직원"이다 —
                   아래 각주("관리자 1명…은 빼고 셉니다")와 반드시 같은 말이어야 한다.
                ⚠️ 부가세 표기는 이 제목에만 있는 것이 아니다 — 요금표 caption에도 있다(2026-11-20에 표가
                   생겼다). "중복이니까" 어느 한쪽을 지우지 말 것: 접힌 표를 펼치면 제목이 화면 밖으로
                   밀려 나가 금액만 보이는 화면이 생긴다(검수 중간 4·경미 1). */}
            {/* ⚠️ "(부가세 별도)"만 작게 — 강조할 말이 아니라는 사장님 지시(2026-08-09).
                   다만 **지우거나 흐리게 만들지는 않는다.** 표시광고상 가격 옆에서 읽혀야 한다.
                   색은 본문색 그대로 두고 크기·굵기만 낮춘다(--text-sub로 바꾸면 대비가 더 떨어진다). */}
            <h2 style={h2}>
              직원 수 구간별 월 {formatWon(PRICE_TIERS[0].monthly)}부터
              <span style={{ fontSize: "clamp(13px,1.7vw,16px)", fontWeight: 600, marginLeft: 4, whiteSpace: "nowrap" }}>(부가세 별도)</span>
            </h2>
            {/* ⚠️ "최소 인원도 없습니다"는 뺐다 — 구간제로 바뀌어 1~5명도 첫 구간 요금이 바닥이다(거짓이 된다). */}
            <p style={{ marginTop: 12, marginBottom: 0, fontSize: 16, color: "var(--text-sub)", lineHeight: 1.65 }}>
              구간 안에서는 직원이 늘어도 요금이 그대로입니다. 단말기 구입비도 없습니다. {TRIAL_DAYS}일 동안 먼저 써 보세요.
            </p>
          </div>

          <div className="landing-hover-card" style={{ maxWidth: 720, margin: "0 auto", padding: "clamp(28px,4vw,40px)" }}>
            {/* 구간 요금표 (2026-11-20 구간제 전환으로 추가) — 2026-08-09에 뺐던 "가격 블록"이 돌아온 자리다.
                   그때는 상품이 하나·가격이 한 줄이라 제목과 반복이었지만, 이제는 구간이 여러 개라 표가
                   없으면 방문자가 자기 회사 요금을 알 수 없다.
                ⚠️ 숫자는 전부 lib/pricing.ts에서 온다. 여기 직접 적으면 청구 금액과 어긋난다.
                   **구간 개수도 적지 않는다** — 구간이 늘거나 줄면 주석만 틀어진다(검수 경미 1).
                ⚠️ caption의 "(부가세 별도)"를 빼지 말 것 — 금액이 나란히 보이는 자리라 표시광고상 함께
                   읽혀야 한다. 제목(h2)의 표기와 **둘 다** 유지한다.
                ⚠️ 뒤쪽 구간은 <details>로 접는다. 전부 펼치면 휴대폰에서 요금 섹션만 한 화면을 넘긴다.
                   이 페이지는 서버 컴포넌트라 JS를 쓸 수 없고, <details>는 JS 없이 접힌다(FAQ와 같은 방식). */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              {/* ⚠️ 머리말을 바깥 <div>가 아니라 <caption>으로 둔 이유: 표와 **붙어서** 움직인다.
                     <div>에 두면 접힌 표를 펼칠 때 머리말이 화면 위로 밀려 나가 **금액만 보이는 화면**이
                     생겨 "(부가세 별도)"가 함께 읽히지 않는다(검수 중간 4). 화면낭독기에도 표 이름으로
                     읽힌다(검수 경미 3). 접힌 표에도 같은 caption을 둔다 — 중복이 아니라 안전장치다. */}
              <caption style={{ captionSide: "top", textAlign: "left", fontSize: 15, fontWeight: 700, color: "var(--text)", paddingBottom: 10 }}>
                직원 수 구간별 월 요금
                <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4, color: "var(--text-sub)" }}>(부가세 별도)</span>
              </caption>
              <tbody>
                {/* ⚠️ 라벨이 없으면 그 행을 **아예 그리지 않는다.** "(빈칸) 32,000원"처럼 금액만 보이는 행은
                       이 페이지가 가장 피하는 모양새다. 지금은 인덱스가 구조적으로 범위 안이라 도달할 수
                       없지만, 구간표를 손댔을 때 조용히 깨지는 길을 아예 없애 둔다(검수 경미 3). */}
                {PRICE_TIERS.slice(0, TIERS_SHOWN).map((t, i) => {
                  const label = tierLabel(i);
                  if (!label) return null;
                  return (
                    <tr key={t.max}>
                      <th scope="row" style={{ textAlign: "left", padding: "9px 0", fontWeight: 600, color: "var(--text)", borderTop: i === 0 ? undefined : "1px solid var(--border)" }}>{label}</th>
                      <td style={{ textAlign: "right", padding: "9px 0", fontWeight: 700, whiteSpace: "nowrap", borderTop: i === 0 ? undefined : "1px solid var(--border)" }}>{formatWon(t.monthly)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {HAS_FOLDED_TIERS && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--primary)", padding: "8px 0" }}>
                  {PRICE_TIERS[TIERS_SHOWN - 1].max + 1}명 이상 요금 보기
                </summary>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
                  <caption style={{ captionSide: "top", textAlign: "left", fontSize: 14, fontWeight: 700, color: "var(--text)", paddingBottom: 8 }}>
                    {PRICE_TIERS[TIERS_SHOWN - 1].max + 1}명 이상 월 요금
                    <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4, color: "var(--text-sub)" }}>(부가세 별도)</span>
                  </caption>
                  <tbody>
                    {/* 위 표와 같은 이유로 라벨 없는 행은 그리지 않는다(검수 경미 3). */}
                    {PRICE_TIERS.slice(TIERS_SHOWN).map((t, i) => {
                      const label = tierLabel(TIERS_SHOWN + i);
                      if (!label) return null;
                      return (
                        <tr key={t.max}>
                          <th scope="row" style={{ textAlign: "left", padding: "9px 0", fontWeight: 600, color: "var(--text)", borderTop: "1px solid var(--border)" }}>{label}</th>
                          <td style={{ textAlign: "right", padding: "9px 0", fontWeight: 700, whiteSpace: "nowrap", borderTop: "1px solid var(--border)" }}>{formatWon(t.monthly)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            )}
            {/* 별도 협의 안내는 **접지 않는다** — 큰 회사일수록 문의가 중요한데 접어 두면 한 번 더 눌러야
                   발견한다(검수 경미 4).
                ⚠️ 여기에 금액을 짐작해 적지 말 것. 공개 가격이 없는 이유는 두 가지 실제 제약이다 —
                   KIS 1회 결제 한도(**부가세 포함 총액** 기준)와 얼굴서버 동시 처리량 미측정.
                   자세한 계산은 lib/pricing.ts 머리말에 있다. */}
            <p style={{ marginTop: 10, marginBottom: 0, fontSize: 14, color: "var(--text-sub)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--text)" }}>{QUOTE_OVER + 1}명 이상</strong>은 요금을 따로 안내드립니다.
            </p>

            {/* ⚠️ "전부 들어 있습니다"라고 단정하지 않는다 — 문자 발송(비즈모아샷)처럼 건당 비용이 붙는 외부
                   서비스가 있고, 얼굴서버 라이선스 단가도 계약 사항이라 코드로 확인되지 않는다(검수 중간 3).
                ⚠️ "이 가격에"가 아니라 **"모든 구간에"**다 — 구간제로 바꾼 뒤로 "이 가격"이 어느 금액인지
                   가리킬 수 없다. */}
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: "clamp(20px,2.5vw,28px)", marginBottom: 14 }}>모든 구간에 들어 있는 것</div>
            <ul className="landing-price-feats">
              {priceIncludes.map((t) => (
                <li key={t} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, color: "var(--text)", lineHeight: 1.6 }}>
                  {/* aria-hidden — 화면낭독기에 뜻 없는 그래픽을 6번 읽히지 않게(비교표 체크와 같은 처리).
                      색은 --success(초록) — 같은 뜻("포함/해당됨")의 체크가 비교표·차별점에서 초록이라 맞춘다. */}
                  <span aria-hidden style={{ flexShrink: 0, marginTop: 3, color: "var(--success)", display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg('<path d="M20 6 9 17l-5-5"/>', 18) }} />
                  <span>{t}</span>
                </li>
              ))}
            </ul>

            <div style={{ marginTop: "clamp(24px,3vw,32px)", textAlign: "center" }}>
              <Link href="/signup" style={{ height: 52, padding: "0 30px", display: "inline-flex", alignItems: "center", borderRadius: 10, background: "var(--primary)", color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none", boxShadow: "0 10px 24px rgba(37,99,235,0.28)" }}>
                {/* 숫자를 직접 적지 않는다 — lib/trial.ts가 "홈화면 문구와 같은 값이어야 한다"고 적어 둔
                       지점이다(검수 경미 2). 보이는 글자는 그대로 "30일 무료로 시작하기"다. */}
                {TRIAL_DAYS}일 무료로 시작하기
              </Link>
            </div>
            {/* 각주 — 결제가 붙는 순간 분쟁이 되는 지점만 미리 밝힌다.
                ⚠️ "1명"이 무엇인지 정의하지 않으면 100% 클레임이 난다(검수 치명 3). 계정 종류가 셋이다:
                   회사 대표계정(isOwner=true, 스키마 주석이 "사람이 아니다") / 관리자(role="admin") / 직원,
                   그리고 퇴사자는 deactivatedAt이 찍혀 로그인도 집계도 빠지지만 **계정 행은 남는다**.
                   셀 것과 안 셀 것을 둘 다 적는다.
                ⚠️ 관리자는 **1명까지** 세지 않는다(2026-11-23 변경, lib/pricing-server.ts FREE_ADMIN_COUNT). 위 제목과 같은 말이어야 한다.
                ⚠️ 2026-11-20: "체험 기간이 끝나도 자동으로 결제되지 않습니다"를 **"결제는 직접 신청하실 때만
                   시작됩니다"**로 바꿨다. 앞 문장은 자동결제(KIS 빌링)가 붙는 날 거짓이 되지만, 뒷 문장은
                   자동결제가 **고객이 고르는 선택 사항**이라 붙은 뒤에도 사실이다. 되돌리지 말 것.
                ⚠️ 구간 초과 시 "먼저 보여 주고 동의를 받는다"는 **약속이다.** 3단계에서 그 동의 화면을
                   만들기 전에는 요금을 올려 청구하지 않는다(plan-구독결제-요금제.md 3장). */}
            <p style={{ marginTop: 14, marginBottom: 0, textAlign: "center", fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7 }}>
              {/* 2026-11-23: 관리자는 1명까지만 뺀다(lib/pricing-server.ts FREE_ADMIN_COUNT) — 숫자를 바꾸면 이 문장도. */}
              재직 중인 직원 수로 계산합니다(관리자 1명·회사 대표계정·퇴사 처리된 계정은 빼고 셉니다)
              <br />
              직원이 늘어 구간을 넘으면 올라가는 금액을 먼저 보여 드리고 동의를 받은 뒤에만 적용합니다
              <br />
              결제는 직접 신청하실 때만 시작됩니다 · 지문·카드 인식기 같은 단말기 구입 비용이 없습니다
            </p>
          </div>
        </div>
      </section>

      {/* FAQ — 넓은 화면에선 방패 그림과 2단 */}
      <section id="faq" style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(40px,6vw,64px) 24px", scrollMarginTop: 68 }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(28px,4vw,40px)" }}>
          <div style={eyebrow}>궁금한 점</div>
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
              {/* 문의 수단 (2026-08-17 추가) — 이 섹션은 헤더의 [문의하기] 메뉴가 가리키는 곳인데
                  그동안 전화·이메일·문의폼이 하나도 없어 메뉴 이름이 거짓이었다. 둘은 짝이다.
                  ⚠️ 번호·주소를 손으로 적지 않고 위 BIZ 값을 쓴다 — 여기와 푸터 두 곳에 같은 값을
                     따로 적어 두면 한쪽만 고쳐 어긋난다(고객이 못 거는 번호가 남는다).
                  ⚠️ 전화번호·이메일은 실제로 눌러 쓰는 정보라 **흰색 그대로** 둔다(파란 밴드 위 대비 5.17).
                     앞의 "도입 문의"만 0.85로 낮춰 두 정보가 먼저 읽히게 한다. */}
              <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", alignItems: "baseline", fontSize: 14 }}>
                <span style={{ color: "rgba(255,255,255,0.85)" }}>도입 문의</span>
                <a href={TEL_HREF} style={{ color: "#fff", fontWeight: 700, textDecoration: "none" }}>{BIZ.tel}</a>
                <span aria-hidden style={{ color: "rgba(255,255,255,0.6)" }}>·</span>
                <a href={`mailto:${BIZ.email}`} style={{ color: "#fff", fontWeight: 700, textDecoration: "none" }}>{BIZ.email}</a>
              </div>
            </div>
        </div>
      </section>

      {/* 푸터 */}
      {/* 🔴 아래 사업자 정보는 **법적 표시 사항**이다(전자상거래법 제10조). 유료 구독을 파는 이상
             상호·대표자·사업자등록번호·주소·전화·이메일은 빼면 안 된다. 값은 위 BIZ 상수 한 곳에서만 온다.
          ⚠️ 글자색이 #9CA3AF가 아니라 --text-sub(#6B7280)인 이유: #9CA3AF는 흰 바탕에서 대비가 **2.54**로
             읽기 기준(4.5)에 한참 못 미친다. 읽을 수 없게 적어 두면 "표시했다"고 보기 어렵다.
             --text-sub는 4.83이라 통과한다. **여기서 색을 더 흐리게 만들지 말 것.**
          ⚠️ 대표자 **생년월일은 넣지 않는다** — 사업자등록증에는 있지만 개인정보이고 표시 의무도 아니다. */}
      <footer style={{ borderTop: "1px solid var(--landing-border,#DCE5F4)", background: "#FFFFFF" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "28px 24px 34px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
            {/* 로고 — 위 헤더와 같은 그림. 푸터는 자리가 넉넉하지만 헤더보다 **작게** 둔다
                   (푸터 로고가 헤더보다 크면 시선이 아래로 쏠린다). 주의사항은 헤더 쪽 주석 참고. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 로고. 최적화 대상 아님 */}
            <img src="/logo.webp" alt="가온" width={144} height={120} style={{ height: 34, width: "auto", display: "block", flexShrink: 0 }} />
            {/* 2026-11-22: 두 페이지를 만들어 링크를 연결했다(app/terms, app/privacy).
                   개인정보처리방침은 **개인정보보호법 제30조상 공개 의무**다(얼굴=민감정보를 다루므로 더더욱).
                   ⚠️ 내용의 원본은 `docs/13_legal/약관_개인정보처리방침_초안.md`다 — 문구를 고칠 때는 그 문서와 함께 고친다. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0 8px", fontSize: 13, color: "var(--text-sub)" }}>
              <Link href="/terms" style={{ color: "inherit" }}>
                이용약관
              </Link>
              <span aria-hidden>·</span>
              <Link href="/privacy" style={{ color: "inherit", fontWeight: 700 }}>
                개인정보처리방침
              </Link>
            </div>
            {/* ⚠️ 여기 있던 [맨 위로] 동그란 버튼은 2026-08-17에 **화면에 떠서 따라다니는 버튼**으로 옮겼다
                   (`<LandingScrollTop />`, 이 파일 맨 아래에 있다). 푸터에 박혀 있으면 맨 아래까지
                   내려가야 보였기 때문이다 — 사장님 지시.
                   ⚠️ 그래서 이 줄은 이제 항목이 **둘**이다(로고 | 이용약관). justifyContent가 space-between
                      이라 이용약관이 오른쪽 끝으로 간다. 가운데로 되돌리고 싶으면 빈 칸을 하나 두어야 한다. */}
          </div>

          {/* 사업자 정보 — 줄바꿈을 flex+wrap에 맡긴다. 좁은 화면에서 항목 단위로 접히고,
              가운뎃점(·)은 aria-hidden이라 화면낭독기가 "가운뎃점"을 읽지 않는다.
              ⚠️ 주소는 한 덩어리라 쪼개지 않는다(등록증 표기 그대로여야 한다). */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--landing-border,#DCE5F4)", fontSize: 13, color: "var(--text-sub)", lineHeight: 1.8 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0 10px" }}>
              <span>상호 <b style={{ fontWeight: 600 }}>{BIZ.name}</b></span>
              <span aria-hidden>·</span>
              <span>대표 {BIZ.ceo}</span>
              <span aria-hidden>·</span>
              {/* 개인정보 보호법 표시사항 — 대표자와 다른 사람이라 따로 적는다(2026-11-22). */}
              <span>정보담당자 {BIZ.manager}</span>
              <span aria-hidden>·</span>
              <span>사업자등록번호 {BIZ.regNo}</span>
            </div>
            <div>{BIZ.address}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0 10px" }}>
              <span>전화 <a href={TEL_HREF} style={{ color: "inherit" }}>{BIZ.tel}</a></span>
              <span aria-hidden>·</span>
              <span>이메일 <a href={`mailto:${BIZ.email}`} style={{ color: "inherit" }}>{BIZ.email}</a></span>
              <span aria-hidden>·</span>
              {/* ⚠️ 바깥 사이트로 나가는 링크라 target="_blank" + rel="noreferrer"를 짝으로 둔다.
                     rel이 없으면 열린 페이지가 이 창을 조작할 수 있다(보안). */}
              <span>홈페이지 <a href={`https://${BIZ.site}`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{BIZ.site}</a></span>
            </div>
            <div style={{ marginTop: 10, color: "#9CA3AF" }}>© 2026 {BIZ.name}. All rights reserved.</div>
          </div>
        </div>
      </footer>

      {/* [맨 위로] — 화면 오른쪽 아래에 떠서 스크롤을 따라오는 버튼(2026-08-17 사장님 지시).
          예전에는 푸터 안에 박혀 있어 맨 아래까지 내려가야 보였다.
          ⚠️ 스크롤 위치를 알아야 해서 클라이언트 컴포넌트다. 이 페이지 자체는 그대로 서버 컴포넌트다.
          ⚠️ 화면 맨 위(480px 이내)에서는 스스로 숨는다 — 이미 맨 위인데 떠 있으면 군더더기다. */}
      <LandingScrollTop />
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

// ※ 브라우저 창 흉내 줄(신호등 3점)을 걷어내면서 그 점을 만들던 dot() 함수도 함께 지웠다(2026-08-09).
// ※ 파란 "근" 네모를 만들던 logoBox() 함수도 2026-08-17에 지웠다 — 헤더·푸터 로고가 모두 가온 로고
//    그림(/logo.webp)으로 바뀌어 쓰는 곳이 없어졌다. 되살릴 일이 생기면 그 커밋에서 꺼내 올 것.
