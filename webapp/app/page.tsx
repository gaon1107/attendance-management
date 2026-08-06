// 랜딩 페이지 (공개) — 목업 디자인 적용. 서버 컴포넌트(FAQ는 JS 없이 <details>로 동작).
// ⚠️ 섹션 순서·구성은 기존 그대로 두고 "겉모습"만 목업에 맞췄다(2026-08-05 사장님 확정).
//    좁은 화면에서 숨기고 접는 규칙은 globals.css의 `landing-*` 클래스에 있다(서버는 화면 크기를 모른다).
import Link from "next/link";

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

// ── 제품 미리보기 KPI (예시 수치) ──
const peek = [
  { label: "오늘 출근", value: "18명", tone: "var(--success)", icon: '<path d="M20 6 9 17l-5-5"/>' },
  { label: "실근무 평균", value: "8.4h", tone: "var(--text-sub)", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { label: "초과근무", value: "44h", tone: "var(--warning)", icon: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' },
  { label: "법규 준수", value: "100%", tone: "var(--primary)", icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>' },
];

// ── 꺾은선 차트: 주간 평균 실근무시간 (예시) ──
const trend = [
  { label: "1주", hours: 41.2 },
  { label: "2주", hours: 39.8 },
  { label: "3주", hours: 42.1 },
  { label: "4주", hours: 40.3 },
  { label: "5주", hours: 38.9 },
  { label: "6주", hours: 40.6 },
];

// ── 도넛 차트: 출퇴근 인증 방식 비율 (예시) — "강제하지 않는다"를 그대로 보여준다 ──
const authMix = [
  { label: "얼굴인증", pct: 62, color: "var(--primary)" },
  { label: "GPS", pct: 38, color: "#93C5FD" },
];

// ── WHY: 차별점 3개 ──
const features = [
  { icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', grad: "linear-gradient(135deg,#3B82F6,#60A5FA)", title: "정직한 실근무시간", desc: "출퇴근·외출·자리비움을 자동 반영해 실제로 일한 시간만 집계합니다. 부풀리거나 누락될 일이 없어요." },
  { icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>', grad: "linear-gradient(135deg,#6366F1,#8B5CF6)", title: "법규 자동 준수", desc: "주 12시간 초과근무 한도를 실시간으로 관리하고, 근로시간 기록을 3년간 안전하게 보존합니다." },
  { icon: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>', grad: "linear-gradient(135deg,#0EA5E9,#38BDF8)", title: "강제 없는 얼굴인증", desc: "얼굴인증과 GPS 중 직원이 직접 선택합니다. 동의는 강제가 아니며 언제든 철회·삭제할 수 있어요." },
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

export default function Home() {
  return (
    <div id="top" style={{ minHeight: "100vh", background: "#FFFFFF", color: "var(--text)" }}>
      {/* 헤더 */}
      {/* ⚠️ 헤더 아래 선과 푸터 위 선은 **남긴다** — 스크롤할 때 고정된 헤더와 본문이 겹쳐 보이므로
             경계가 필요하다. 색만 회색 → 파랑으로 맞추되 **진한 쪽(-strong)**을 쓴다.
             헤더 배경이 반투명(0.9)이라 아래로 지나가는 푸른 섹션이 비쳐 올라오는데, 옅은 쪽을
             쓰면 그 구간에서 선 대비가 1.10까지 떨어져 헤더와 본문이 붙어 보인다(검수 지적). */}
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--landing-border-strong,#CBD9F0)" }}>
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
      {/* ⚠️ 예전엔 이 배경이 흰색이었다. 배경 그림 두 조각이 **흰 바탕으로 구워진** 이미지라
             (투명 PNG면 233KB, 흰 배경이면 23KB) 파란 그라데이션 위에 얹으면 흰 네모가 드러났기 때문이다.
             2026-08-06: globals.css에서 그 두 그림에 `mix-blend-mode: multiply`(곱하기 합성)를 걸어
             **흰색이 투명처럼 동작하게** 만들었다. 그래서 이제 파란 배경을 깔 수 있다.
             ⚠️ 이 배경을 다시 손댈 땐 globals.css의 `.landing-hero-wrap::before` / `.landing-hero-inner::before`
                blend 설정과 **짝**이라는 것을 기억할 것. blend를 빼면 흰 네모가 즉시 다시 보인다.
             ⚠️ 시안처럼 왼쪽 위가 가장 파랗고 오른쪽 아래로 갈수록 흰색이 되게 165도로 기울였다.
                아래쪽이 흰색인 이유: 바로 뒤에 오는 기능 섹션의 그라데이션도 흰색에서 시작하기 때문이다. */}
      <div className="landing-hero-wrap" style={{ background: "linear-gradient(165deg,#E8F1FD 0%,#F2F7FF 45%,#FFFFFF 100%)" }}>
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
            {/* ⚠️ 배경색이 #D3E1FA인 이유: 히어로 배경이 파랗게 바뀌면서(2026-08-06) 예전 값 #E8F1FE는
                   히어로 상단색 #E8F1FD와 **거의 같은 색**(대비 1.00)이 되어 배지가 통째로 묻혔다.
                   #DCE8FA로 내려도 1.09라 여전히 약해 #D3E1FA(1.16)까지 내렸다. 알약 배경은 장식이라
                   이 정도면 충분하다 — 실제로 읽히게 하는 건 진한 글자색(#1D4ED8)이다.
                   시안에 맞춰 테두리와 초록 점은 뺐다.
                   ⚠️ 히어로 배경색을 다시 바꾸면 이 값의 대비를 다시 계산할 것. */}
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

          {/* 제품 미리보기 */}
          {/* ⚠️ 그림자만 --landing-shadow(8%)를 안 쓰고 13%로 따로 준다 — 이 카드는 화면에서 가장 큰
                 덩어리라 같은 8%로는 흰 히어로 바탕 위에서 떠 보이지 않는다(다른 카드보다 진하게). */}
          <div style={{ position: "relative", zIndex: 1, marginTop: "clamp(40px,6vw,64px)", borderRadius: 16, background: "var(--landing-bg,#F5F8FF)", overflow: "hidden", textAlign: "left", boxShadow: "0 24px 60px rgba(37,99,235,0.13)" }}>
            <div style={{ height: 38, display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderBottom: "1px solid var(--landing-border,#DCE5F4)", background: "#fff" }}>
              <span style={dot()} />
              <span style={dot()} />
              <span style={dot()} />
              {/* 좁은 화면에서 이 주소가 줄바꿈되면 옆의 "예시 화면" 표기가 38px 줄 밖으로 밀린다 → 말줄임 처리 */}
              <span style={{ marginLeft: 12, fontSize: 13, color: "#9CA3AF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>app.근태관리.co.kr</span>
              {/* ⚠️ 아래 수치는 전부 예시다. 실제 고객 성과처럼 보이면 표시광고법 문제가 되므로 반드시 표기한다. */}
              <span style={{ marginLeft: 10, padding: "2px 8px", borderRadius: 10, background: "#F3F4F6", fontSize: 11, fontWeight: 700, color: "#6B7280", whiteSpace: "nowrap" }}>예시 화면</span>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--success)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />실시간
              </span>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* ⚠️ 미리보기 **안쪽** 카드들(아래 KPI 4칸·차트 2개)은 테두리를 지우지 않는다.
                     여기는 바깥 카드 바탕이 푸른빛(--landing-bg)이라 흰 칸이 배경과는 구분되지만,
                     칸끼리는 12px 간격으로만 떨어져 있어 선이 없으면 4칸이 한 덩어리로 읽힌다.
                     경계가 사라지는 건 아니므로 약한 쪽(--landing-border)으로 충분하다. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
                {peek.map((p) => (
                  <div key={p.label} style={{ background: "#fff", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 10, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{p.label}</span>
                      <span style={{ color: p.tone, width: 15, height: 15, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg(p.icon, 15) }} />
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: p.tone === "var(--text-sub)" ? "var(--text)" : p.tone, fontVariantNumeric: "tabular-nums" }}>{p.value}</div>
                  </div>
                ))}
              </div>
              <div className="landing-chart-grid">
                <TrendChart />
                <AuthDonut />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* WHY — 차별점 */}
      {/* ⚠️ scrollMarginTop: 메뉴를 눌러 이동할 때 고정 헤더가 섹션 머리를 덮지 않게 한다.
             헤더가 실제로 먹는 높이는 **61px**(안쪽 60 + 아래 테두리 1)이라 68은 여유가 7px뿐이다.
             **헤더 높이를 바꾸면 이 값도 함께 올릴 것.**
             globals.css의 html{scroll-padding-top}으로 하면 로그인 후 전 화면에 영향이 가므로 여기서만 준다. */}
      {/* ⚠️ 배경 그라데이션의 위·아래 끝이 **흰색**인 이유: 이 섹션의 앞(히어로)과 뒤(도입 3단계)가
             둘 다 흰 바탕이다. 예전엔 회색 단색 + 위쪽 구분선이라 색이 뚝 끊겼는데,
             양 끝을 흰색으로 두면 선 없이도 색이 서서히 번져 시안처럼 한 장으로 이어진다.
             **앞뒤 섹션의 배경을 바꾸면 이 0%/100% 색도 같이 바꿀 것.**
          ⚠️ 색이 바뀌는 지점을 %가 아니라 **48px 고정**으로 둔 이유(2026-08-06 검수 반영):
             ① %로 두면 섹션이 길어질수록 흰색 구간도 같이 길어진다. 폰(375px)에서 카드가 세로로
                쌓이면 이 섹션 높이가 965px까지 늘어(실측) 82% 지점이 **마지막 카드 한가운데**에
                걸리고, 테두리 없는 카드가 같은 흰색 배경에 묻혀 사라져 보인다.
             ② px 중에서도 **48**인 이유: 이 섹션의 위아래 여백은 clamp(56px,8vw,88px)이라
                **최소 56px**이다. 페이드를 그보다 좁게 잡아야 색이 변하는 구간이 여백 안에서만
                끝나고 카드 영역을 침범하지 않는다(120px로 잡았더니 카드 아래 64px가 걸렸다 — 실측).
                ⚠️ 섹션 패딩의 최소값을 줄이면 이 48px도 함께 줄일 것. */}
      <section id="features" style={{ background: "linear-gradient(180deg,#FFFFFF 0,var(--landing-bg,#F5F8FF) 48px,var(--landing-bg,#F5F8FF) calc(100% - 48px),#FFFFFF 100%)", scrollMarginTop: 68 }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <div style={eyebrow}>WHY 근태관리</div>
            <h2 style={h2}>일하는 사람도, 관리하는 사람도 편하게</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
            {features.map((f) => (
              <div key={f.title} style={{ background: "var(--landing-card,#fff)", borderRadius: 16, padding: "28px 26px", boxShadow: "0 8px 30px var(--landing-shadow)" }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: f.grad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, boxShadow: "0 8px 18px rgba(37,99,235,0.22)" }} dangerouslySetInnerHTML={{ __html: svg(f.icon, 23) }} />
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — 3단계 */}
      <section id="how" style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px", scrollMarginTop: 68 }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
          <div style={eyebrow}>HOW IT WORKS</div>
          <h2 style={h2}>도입은 3단계면 충분해요</h2>
        </div>
        {/* ⚠️ 카드 사이 화살표를 "카드 안"에 두면 안 된다 — 카드에 overflow:hidden이 있어 잘려서
               아예 보이지 않는다(실측으로 확인). 그래서 격자(grid) 자체에 얹고 칸 사이 여백 좌표를
               계산해 놓는다(globals.css의 .landing-step-arrow). 카드가 3열이 아닐 땐 숨긴다. */}
        {/* ⚠️ 아래 카드에는 테두리를 **남긴다**(특징·역할 카드와 다른 점). 그 두 섹션은 배경이
               푸른빛(--landing-bg)이라 흰 카드가 저절로 구분되지만, 이 섹션은 배경이 없어
               **순수 흰 바탕**이다. 카드 위쪽도 흰색이라 테두리를 지우면 그림자만 남는데,
               그림자 8%로는 밝은 사무실 모니터에서 카드 경계가 보이지 않는다(검수 지적). */}
        <div className="landing-steps" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
          {steps.map((s, i) => (
            <div key={s.title} style={{ position: "relative", background: "var(--landing-card,#fff)", border: "1px solid var(--landing-border-strong,#CBD9F0)", borderRadius: 16, padding: "28px 26px", overflow: "hidden", boxShadow: "0 8px 30px var(--landing-shadow)" }}>
              <span style={{ position: "absolute", top: 8, right: 18, fontSize: 64, fontWeight: 800, color: "#F1F5FB", lineHeight: 1, userSelect: "none" }}>{i + 1}</span>
              <div style={{ position: "relative", width: 48, height: 48, borderRadius: 13, background: "linear-gradient(135deg,#2563EB,#60A5FA)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, boxShadow: "0 8px 18px rgba(37,99,235,0.22)" }} dangerouslySetInnerHTML={{ __html: svg(s.icon, 23) }} />
              <div style={{ position: "relative", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
              <div style={{ position: "relative", fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
          <span className="landing-step-arrow landing-step-arrow-1" dangerouslySetInnerHTML={{ __html: svg('<path d="M9 6l6 6-6 6"/>', 20) }} />
          <span className="landing-step-arrow landing-step-arrow-2" dangerouslySetInnerHTML={{ __html: svg('<path d="M9 6l6 6-6 6"/>', 20) }} />
        </div>
      </section>

      {/* 역할별 */}
      {/* 위 features 섹션과 **똑같은 값**이다(48px 고정인 이유도 거기 주석 참고).
          앞(도입 3단계)·뒤(숫자 밴드)가 흰 바탕이라 양 끝을 흰색으로 둔다. 한쪽만 고치지 말 것. */}
      <section id="roles" style={{ background: "linear-gradient(180deg,#FFFFFF 0,var(--landing-bg,#F5F8FF) 48px,var(--landing-bg,#F5F8FF) calc(100% - 48px),#FFFFFF 100%)", scrollMarginTop: 68 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, background: "linear-gradient(120deg,#2563EB 0%,#3B82F6 55%,#6366F1 100%)", borderRadius: 20, padding: "clamp(32px,4vw,44px) 24px", boxShadow: "0 18px 40px rgba(37,99,235,0.25)" }}>
          {stats.map((s) => (
            <div key={s.label} style={{ textAlign: "center", color: "#fff" }}>
              <div style={{ width: 40, height: 40, margin: "0 auto 10px", borderRadius: 12, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: svg(s.icon, 20) }} />
              <div style={{ fontSize: "clamp(28px,4vw,38px)", fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginTop: 6 }}>{s.label}</div>
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
            {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 장식용 SVG. 최적화 대상 아님 */}
            <img src="/shield-check.svg" alt="" width={240} height={240} />
          </div>
          {/* ⚠️ 아래 질문 카드에도 3단계 카드와 같은 이유로 테두리를 **남긴다** — FAQ 섹션도 배경이
                 없어 순수 흰 바탕이다. 게다가 이건 눌러서 접었다 펴는 **버튼**이라, 경계가 사라지면
                 누를 수 있다는 것 자체를 알 수 없게 된다(검수 지적: 질문 4개가 한 덩어리로 보임). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqs.map((f, i) => (
              <details key={f.q} className="faq" open={i === 0} style={{ background: "#fff", border: "1px solid var(--landing-border-strong,#CBD9F0)", borderRadius: 12, padding: "4px 20px", boxShadow: "0 4px 20px var(--landing-shadow)" }}>
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
        <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(120deg,#1D4ED8 0%,#2563EB 50%,#4F46E5 100%)", borderRadius: 22, padding: "clamp(48px,7vw,72px) 24px", textAlign: "center", boxShadow: "0 20px 44px rgba(37,99,235,0.28)" }}>
            {/* 배경 도트 패턴 */}
            <span style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.16) 1.5px, transparent 1.6px)", backgroundSize: "18px 18px", pointerEvents: "none" }} />
            {/* 네 모서리 스캔 프레임 */}
            <span style={{ position: "absolute", top: 22, left: 24, color: "rgba(255,255,255,0.45)", width: 30, height: 30, display: "inline-flex", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg('<path d="M4 10V6a2 2 0 0 1 2-2h4"/>', 30) }} />
            <span style={{ position: "absolute", top: 22, right: 24, color: "rgba(255,255,255,0.45)", width: 30, height: 30, display: "inline-flex", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg('<path d="M14 4h4a2 2 0 0 1 2 2v4"/>', 30) }} />
            <span style={{ position: "absolute", bottom: 22, left: 24, color: "rgba(255,255,255,0.45)", width: 30, height: 30, display: "inline-flex", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg('<path d="M4 14v4a2 2 0 0 0 2 2h4"/>', 30) }} />
            <span style={{ position: "absolute", bottom: 22, right: 24, color: "rgba(255,255,255,0.45)", width: 30, height: 30, display: "inline-flex", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg('<path d="M20 14v4a2 2 0 0 1-2 2h-4"/>', 30) }} />

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

// ── 꺾은선 차트 (주간 평균 실근무시간) ──
// 라이브러리 없이 SVG로 직접 그린다.
// ⚠️ viewBox를 실제 표시 비율(가로가 세로의 약 5배)에 맞춰 놓고 preserveAspectRatio는 기본값을 쓴다.
//    예전처럼 320×120 + preserveAspectRatio="none"으로 하면 가로로 1.9배 늘어나 **점이 타원**이 되고
//    선 두께가 방향마다 달라진다(검수 지적).
// ⚠️ y축 범위는 데이터에서 뽑는다. 예전엔 36~44로 고정이라 값이 그 밖으로 나가면 점이 칸을 벗어났다.
// ⚠️ gradientId: SVG의 id는 문서 전체에서 하나뿐이어야 한다. 이 차트를 한 페이지에 두 번 놓을 일이
//    생기면 두 번째에는 반드시 다른 id를 넘겨야 색이 섞이지 않는다(서버 컴포넌트라 useId를 못 쓴다).
function TrendChart({ gradientId = "trendFill" }: { gradientId?: string }) {
  if (trend.length < 2) return null; // 점이 1개 이하면 선을 그릴 수 없다(0개면 아래 계산에서 오류)
  const W = 580, H = 112, PAD_L = 12, PAD_R = 12, TOP = 10, BOTTOM = 98;
  const vals = trend.map((t) => t.hours);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.25 || 1; // 값이 모두 같아도 0으로 나누지 않게
  const MIN = lo - pad, MAX = hi + pad;
  const stepX = (W - PAD_L - PAD_R) / (trend.length - 1);
  const pts = trend.map((t, i) => {
    const x = PAD_L + i * stepX;
    const y = BOTTOM - ((t.hours - MIN) / (MAX - MIN)) * (BOTTOM - TOP);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...t };
  });
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `M${pts[0].x},${pts[0].y} ${pts.slice(1).map((p) => `L${p.x},${p.y}`).join(" ")} L${pts[pts.length - 1].x},${BOTTOM} L${pts[0].x},${BOTTOM} Z`;

  return (
    <div style={{ background: "#fff", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 10, padding: "14px 16px 10px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>주간 평균 실근무시간</div>
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 8 }}>최근 6주 · 시간</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="최근 6주 주간 평균 실근무시간 추이(예시)">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2563EB" stopOpacity="0.22" />
            <stop offset="1" stopColor="#2563EB" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* vectorEffect="non-scaling-stroke": 선 두께를 화면 크기와 무관하게 유지한다.
            없으면 폰(차트 폭 252px)에서 선이 1.1px까지 얇아져 거의 안 보인다(검수 지적). */}
        {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((y) => (
          <line key={y} x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#EEF2F7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {pts.map((p) => (
          <circle key={p.label} cx={p.x} cy={p.y} r="4.5" fill="#fff" stroke="var(--primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
        {trend.map((t) => (
          <span key={t.label}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 도넛 차트 (출퇴근 인증 방식 비율) ──
function AuthDonut() {
  const R = 40, C = 2 * Math.PI * R;
  // 각 조각의 시작 위치(앞 조각들의 합)를 그리기 전에 미리 계산해 둔다.
  // ⚠️ map 안에서 변수를 누적하면 리액트 규칙 위반이다(렌더 중 값 변경 금지) — 린트가 잡는다.
  // ⚠️ 합이 100이 아니어도 조각이 겹치거나 비지 않도록 "전체 합" 기준으로 나눈다.
  const total = authMix.reduce((sum, p) => sum + p.pct, 0) || 1;
  const segs = authMix.map((a, i) => ({
    ...a,
    dash: (a.pct / total) * C,
    offset: -(authMix.slice(0, i).reduce((sum, p) => sum + p.pct, 0) / total) * C,
  }));
  return (
    <div style={{ background: "#fff", border: "1px solid var(--landing-border,#DCE5F4)", borderRadius: 10, padding: "14px 16px 10px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>인증 방식 비율</div>
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 6 }}>직원이 고른 출퇴근 방식</div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg viewBox="0 0 110 110" width="106" height="106" role="img" aria-label="출퇴근 인증 방식 비율: 얼굴인증 62퍼센트, GPS 38퍼센트(예시)">
          <g transform="rotate(-90 55 55)">
            <circle cx="55" cy="55" r={R} fill="none" stroke="#F1F5F9" strokeWidth="14" />
            {segs.map((a) => (
              <circle key={a.label} cx="55" cy="55" r={R} fill="none" stroke={a.color} strokeWidth="14" strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={a.offset} />
            ))}
          </g>
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
        {authMix.map((a) => (
          <span key={a.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-sub)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
            {a.label} {a.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function RoleCard({ title, sub, items, iconPath, device }: { title: string; sub: string; items: string[]; iconPath: string; device: "phone" | "laptop" }) {
  return (
    // 최소 높이(폰 목업 292px이 잘리지 않게)는 globals.css의 .landing-role-card에 있다.
    // ⚠️ 인라인으로 두면 안 된다 — 기기 그림이 사라지는 좁은 화면(≤640px)에서 해제할 방법이 없어
    //    그림도 없는 카드 아래에 56px짜리 빈 띠가 남는다(검수 지적).
    <div className="landing-role-card" style={{ position: "relative", overflow: "hidden", background: "var(--landing-card,#fff)", borderRadius: 16, padding: "28px 26px", boxShadow: "0 8px 30px var(--landing-shadow)" }}>
      {device === "phone" ? <PhoneMock /> : <LaptopMock />}
      <div className={device === "phone" ? "landing-role-body" : "landing-role-body-lg"}>
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
    </div>
  );
}

// ── 기기 목업 ─────────────────────────────────────────────────────
// 그림(SVG) 위 "화면" 자리에 우리 화면을 본뜬 간단한 UI를 얹는다.
// ⚠️ 화면 자리 좌표는 SVG 원본에서 온 값이다(폰 36,36~324,664 / 노트북 124,34~596,324).
//    그림 파일을 다른 것으로 바꾸면 아래 left/top/width/height도 함께 다시 계산해야 한다.
//    나중에 실제 화면 스크린샷이 준비되면 이 안쪽 내용만 <img>로 갈아끼우면 된다.
function PhoneMock() {
  const S = 150 / 360; // 원본 360px → 화면 표시 150px
  return (
    <div className="landing-device" style={{ position: "absolute", right: 14, bottom: -34, width: 150, height: Math.round(700 * S), pointerEvents: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 장식용 SVG. 최적화 대상 아님 */}
      <img src="/mockup-phone.svg" alt="" width={150} height={Math.round(700 * S)} />
      <div style={{ position: "absolute", left: Math.round(36 * S), top: Math.round(36 * S), width: Math.round(288 * S), height: Math.round(628 * S), borderRadius: Math.round(34 * S), overflow: "hidden", background: "#fff" }}>
        <div style={{ height: 34, background: "linear-gradient(135deg,#2563EB,#3B82F6)" }} />
        <div style={{ padding: "12px 11px" }}>
          <div style={{ width: 62, height: 62, borderRadius: "50%", background: "#EFF6FF", border: "2px solid var(--primary)", margin: "4px auto 14px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)", fontSize: 12, fontWeight: 700 }}>출근</div>
          <div style={{ height: 8, borderRadius: 4, background: "#E5E7EB", marginBottom: 6 }} />
          <div style={{ height: 8, borderRadius: 4, background: "#F3F4F6", width: "72%", marginBottom: 14 }} />
          <div style={{ height: 26, borderRadius: 6, background: "#F9FAFB", border: "1px solid var(--border)" }} />
        </div>
      </div>
    </div>
  );
}

function LaptopMock() {
  const S = 240 / 720; // 원본 720px → 화면 표시 240px
  return (
    <div className="landing-device" style={{ position: "absolute", right: -4, bottom: 22, width: 240, height: Math.round(460 * S), pointerEvents: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 장식용 SVG. 최적화 대상 아님 */}
      <img src="/mockup-laptop.svg" alt="" width={240} height={Math.round(460 * S)} />
      <div style={{ position: "absolute", left: Math.round(124 * S), top: Math.round(34 * S), width: Math.round(472 * S), height: Math.round(290 * S), borderRadius: 3, overflow: "hidden", display: "flex", background: "var(--bg)" }}>
        {/* 왼쪽 다크 네이비 = 실제 관리자 메뉴바 색(--rail) */}
        <div style={{ width: 24, background: "var(--rail)", flexShrink: 0 }} />
        <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 3 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ height: 18, borderRadius: 2, background: "#fff", border: "1px solid var(--border)" }} />
            ))}
          </div>
          <div style={{ flex: 1, borderRadius: 2, background: "#fff", border: "1px solid var(--border)" }} />
        </div>
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--primary)", marginBottom: 10, letterSpacing: "0.02em" };
const h2: React.CSSProperties = { fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 };

function logoBox(size: number, radius: number, fontSize: number): React.CSSProperties {
  return { width: size, height: size, borderRadius: radius, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize, fontWeight: 700, flexShrink: 0 };
}
function dot(): React.CSSProperties {
  return { width: 10, height: 10, borderRadius: "50%", background: "var(--border)" };
}
