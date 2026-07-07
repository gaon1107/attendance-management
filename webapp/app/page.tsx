// 랜딩 페이지 (공개) — 새 디자인 시안 재현. 서버 컴포넌트(FAQ는 JS 없이 <details>로 동작).
import Link from "next/link";

// ── 제품 미리보기 KPI (예시 수치) ──
const peek = [
  { label: "오늘 출근", value: "18명", tone: "var(--success)", icon: '<path d="M20 6 9 17l-5-5"/>' },
  { label: "실근무 평균", value: "8.4h", tone: "var(--text-sub)", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { label: "초과근무", value: "44h", tone: "var(--warning)", icon: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' },
  { label: "법규 준수", value: "100%", tone: "var(--primary)", icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>' },
];

// ── WHY: 차별점 3개 ──
const features = [
  { icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', title: "정직한 실근무시간", desc: "출퇴근·외출·자리비움을 자동 반영해 실제로 일한 시간만 집계합니다. 부풀리거나 누락될 일이 없어요." },
  { icon: '<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>', title: "법규 자동 준수", desc: "주 12시간 초과근무 한도를 실시간으로 관리하고, 근로시간 기록을 3년간 안전하게 보존합니다." },
  { icon: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>', title: "강제 없는 얼굴인증", desc: "얼굴인증과 GPS 중 직원이 직접 선택합니다. 동의는 강제가 아니며 언제든 철회·삭제할 수 있어요." },
];

// ── HOW IT WORKS: 도입 3단계 ──
const steps = [
  { icon: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01"/>', title: "회사 계정 만들기", desc: "이메일로 5분이면 가입. 회사 근무시간과 사업장 위치만 설정하면 준비 끝." },
  { icon: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><path d="M19 8v6M22 11h-6"/>', title: "직원 초대", desc: "이메일로 직원을 초대하면 각자 얼굴인증 또는 GPS 중 편한 방식을 선택합니다." },
  { icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', title: "바로 출퇴근", desc: "버튼 한 번으로 출퇴근. 관리자는 대시보드에서 실시간으로 확인." },
];

// ── 역할별 체크리스트 ──
const roleEmployee = ["버튼 한 번으로 출퇴근·외출 기록", "얼굴인증 또는 GPS, 원하는 방식 선택", "내 실근무시간·상세 실시간 확인", "휴가·근태 정정을 앱에서 바로 신청"];
const roleAdmin = ["출근·지각·결근 오늘 상황 한 눈에", "주 52시간·초과근무 한도 자동 관리", "유가·정정 결재를 한 곳에서 처리", "법정 근로기록·리포트 자동 정리"];

// ── 숫자 밴드 ──
const stats = [
  { value: "5분", label: "평균 도입 소요 시간" },
  { value: "3년", label: "근로기록 안전 보존" },
  { value: "2가지", label: "출퇴근 인증 방식" },
  { value: "100%", label: "근로기준법 대응" },
];

// ── FAQ ──
const faqs = [
  { q: "얼굴인증을 꼭 써야 하나요?", a: "아니요. 얼굴인증과 GPS 중 직원이 직접 고를 수 있고, 둘 다 강제가 아닙니다. 생체정보 동의는 언제든 철회·삭제할 수 있어요." },
  { q: "5인 미만 사업장도 쓸 수 있나요?", a: "네. 인원 수 제한 없이 사용할 수 있습니다. 5인 이상 사업장에 필요한 근로시간 기록·보존 기능도 기본으로 제공합니다." },
  { q: "기존 급여 프로그램과 연동되나요?", a: "실근무시간·근태 데이터를 내보낼 수 있어 급여 정산에 활용할 수 있습니다. 주요 급여 서비스와의 직접 연동은 순차적으로 추가하고 있습니다." },
  { q: "근로시간 기록은 얼마나 보관되나요?", a: "근로기준법에 따라 3년간 안전하게 보관하며, 언제든 법정 근로기록으로 내보낼 수 있습니다." },
];

const WRAP = 1080;
const svg = (path: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", color: "var(--text)" }}>
      {/* 헤더 */}
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={logoBox(28, 7, 15)}>근</div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>근태관리</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/login" style={{ height: 40, padding: "0 16px", display: "flex", alignItems: "center", color: "#374151", fontSize: 15, fontWeight: 700, textDecoration: "none", borderRadius: 7 }}>로그인</Link>
            <Link href="/signup" style={{ height: 40, padding: "0 18px", display: "flex", alignItems: "center", borderRadius: 7, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>무료로 시작하기</Link>
          </div>
        </div>
      </header>

      {/* 히어로 */}
      <section style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,10vw,104px) 24px clamp(48px,8vw,80px)", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 16, marginBottom: 24, whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>중소기업을 위한 근태관리 SaaS</span>
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
          <Link href="/signup" style={{ height: 52, padding: "0 28px", display: "inline-flex", alignItems: "center", borderRadius: 9, background: "var(--primary)", color: "#fff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>무료로 시작하기</Link>
          <a href="#features" style={{ height: 52, padding: "0 24px", display: "inline-flex", alignItems: "center", border: "1px solid #D1D5DB", borderRadius: 9, background: "#fff", color: "#374151", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>기능 둘러보기</a>
        </div>
        <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 16 }}>신용카드 없이 5분이면 시작 · 5인 이상 사업장 법규 대응</div>

        {/* 제품 미리보기 */}
        <div style={{ marginTop: "clamp(40px,6vw,64px)", border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg)", overflow: "hidden", textAlign: "left", boxShadow: "0 20px 50px rgba(17,24,39,0.06)" }}>
          <div style={{ height: 38, display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderBottom: "1px solid var(--border)", background: "#fff" }}>
            <span style={dot()} />
            <span style={dot()} />
            <span style={dot()} />
            <span style={{ marginLeft: 12, fontSize: 13, color: "#9CA3AF" }}>app.근태관리.co.kr</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--success)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />실시간
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, padding: 20 }}>
            {peek.map((p) => (
              <div key={p.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{p.label}</span>
                  <span style={{ color: p.tone, width: 15, height: 15, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg(p.icon, 15) }} />
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: p.tone === "var(--text-sub)" ? "var(--text)" : p.tone, fontVariantNumeric: "tabular-nums" }}>{p.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY — 차별점 */}
      <section id="features" style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <div style={eyebrow}>WHY 근태관리</div>
            <h2 style={h2}>일하는 사람도, 관리하는 사람도 편하게</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
            {features.map((f) => (
              <div key={f.title} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 26px" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#EFF6FF", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }} dangerouslySetInnerHTML={{ __html: svg(f.icon, 22) }} />
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — 3단계 */}
      <section style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
          <div style={eyebrow}>HOW IT WORKS</div>
          <h2 style={h2}>도입은 3단계면 충분해요</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
          {steps.map((s, i) => (
            <div key={s.title} style={{ position: "relative", background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 26px", overflow: "hidden" }}>
              <span style={{ position: "absolute", top: 8, right: 18, fontSize: 64, fontWeight: 800, color: "#F1F5FB", lineHeight: 1, userSelect: "none" }}>{i + 1}</span>
              <div style={{ position: "relative", width: 44, height: 44, borderRadius: 10, background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }} dangerouslySetInnerHTML={{ __html: svg(s.icon, 22) }} />
              <div style={{ position: "relative", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
              <div style={{ position: "relative", fontSize: 15, color: "var(--text-sub)", lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 역할별 */}
      <section style={{ background: "var(--bg)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <h2 style={h2}>직원도, 관리자도 각자 필요한 만큼만</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
            <RoleCard title="직원" sub="복잡한 건 가려지고" items={roleEmployee} iconPath='<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>' />
            <RoleCard title="관리자" sub="PC 대시보드 한 곳에" items={roleAdmin} iconPath='<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' />
          </div>
        </div>
      </section>

      {/* 숫자 밴드 */}
      <section style={{ maxWidth: WRAP, margin: "0 auto", padding: "clamp(48px,7vw,72px) 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: "clamp(28px,4vw,40px) 24px" }}>
          {stats.map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "clamp(28px,4vw,38px)", fontWeight: 800, color: "var(--primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              <div style={{ fontSize: 14, color: "var(--text-sub)", marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(40px,6vw,64px) 24px" }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(28px,4vw,40px)" }}>
          <div style={eyebrow}>FAQ</div>
          <h2 style={h2}>자주 묻는 질문</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {faqs.map((f, i) => (
            <details key={f.q} className="faq" open={i === 0} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "4px 20px" }}>
              <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "16px 0", fontSize: 16, fontWeight: 700 }}>
                <span>{f.q}</span>
                <span className="faq-chevron" style={{ color: "#9CA3AF", flexShrink: 0, width: 18, height: 18, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: svg('<path d="m6 9 6 6 6-6"/>', 18) }} />
              </summary>
              <div style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.7, padding: "0 0 18px" }}>{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* 마지막 CTA (파란 밴드) */}
      <section style={{ maxWidth: WRAP, margin: "0 auto", padding: "0 24px clamp(56px,8vw,88px)" }}>
        <div style={{ background: "var(--primary)", borderRadius: 20, padding: "clamp(48px,7vw,72px) 24px", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 14px", color: "#fff" }}>오늘부터 근태를 정직하게</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.85)", margin: "0 0 28px" }}>5분이면 회사 계정을 만들고 직원을 초대할 수 있어요.</p>
          <Link href="/signup" style={{ height: 52, padding: "0 30px", display: "inline-flex", alignItems: "center", borderRadius: 9, background: "#fff", color: "var(--primary)", fontSize: 16, fontWeight: 700, textDecoration: "none" }}>무료로 시작하기</Link>
        </div>
      </section>

      {/* 푸터 */}
      <footer style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: WRAP, margin: "0 auto", padding: "28px 24px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={logoBox(24, 6, 13)}>근</div>
            <span style={{ fontSize: 14, fontWeight: 700 }}>근태관리</span>
          </div>
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>© 2026 근태관리 · 이용약관 · 개인정보처리방침</div>
        </div>
      </footer>
    </div>
  );
}

function RoleCard({ title, sub, items, iconPath }: { title: string; sub: string; items: string[]; iconPath: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#EFF6FF", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: svg(iconPath, 20) }} />
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
