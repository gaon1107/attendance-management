// 랜딩 페이지 (공개) — 디자인 시안 "랜딩 페이지"를 그대로 옮긴 완성형.
import Link from "next/link";

const peek = [
  { label: "오늘 출근", value: "18명", color: "#111827" },
  { label: "실근무 평균", value: "8.4h", color: "#111827" },
  { label: "초과근무", value: "44:35", color: "#111827" },
  { label: "법규 준수", value: "100%", color: "#2563EB" },
];

const features = [
  {
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    title: "정직한 실근무시간",
    desc: "출퇴근·외출·자리비움을 자동 반영해 실제로 일한 시간만 집계합니다. 부풀리거나 누락될 일이 없어요.",
  },
  {
    icon: (
      <>
        <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    title: "법규 자동 준수",
    desc: "주 12시간 초과근무 한도를 실시간으로 관리하고, 근로시간 기록을 3년간 안전하게 보존합니다.",
  },
  {
    icon: (
      <>
        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
        <path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" />
      </>
    ),
    title: "강제 없는 얼굴인증",
    desc: "얼굴인증과 GPS 중 직원이 직접 선택합니다. 동의는 강제가 아니며 언제든 철회·삭제할 수 있어요.",
  },
];

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", color: "#111827" }}>
      {/* 헤더 */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={logoBox(28, 7, 15)}>근</div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>근태관리</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/login" style={{ height: 40, padding: "0 16px", display: "flex", alignItems: "center", color: "#374151", fontSize: 15, fontWeight: 700, textDecoration: "none", borderRadius: 7 }}>
              로그인
            </Link>
            <Link href="/signup" style={{ height: 40, padding: "0 18px", display: "flex", alignItems: "center", borderRadius: 7, background: "#2563EB", color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>
              무료로 시작하기
            </Link>
          </div>
        </div>
      </header>

      {/* 히어로 */}
      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "clamp(56px,10vw,104px) 24px clamp(48px,8vw,80px)", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 13px", border: "1px solid #E5E7EB", borderRadius: 16, marginBottom: 24, whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16A34A" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>중소기업을 위한 근태관리 SaaS</span>
        </div>
        <h1 style={{ fontSize: "clamp(30px,5.5vw,52px)", fontWeight: 700, lineHeight: 1.22, letterSpacing: "-0.02em", margin: "0 auto 20px", maxWidth: 720 }}>
          정직한 실근무시간,
          <br />
          강제하지 않는 얼굴인증
        </h1>
        <p style={{ fontSize: "clamp(16px,2.4vw,19px)", color: "#6B7280", lineHeight: 1.6, margin: "0 auto 32px", maxWidth: 560 }}>
          출퇴근부터 휴가·급여 연동까지. 직원을 감시하지 않으면서 근로기준법은 자동으로 지키는 근태관리.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <Link href="/signup" style={{ height: 52, padding: "0 28px", display: "inline-flex", alignItems: "center", borderRadius: 9, background: "#2563EB", color: "#fff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>
            무료로 시작하기
          </Link>
          <a href="#features" style={{ height: 52, padding: "0 24px", display: "inline-flex", alignItems: "center", border: "1px solid #D1D5DB", borderRadius: 9, background: "#fff", color: "#374151", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none" }}>
            기능 둘러보기
          </a>
        </div>
        <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 16 }}>신용카드 없이 5분이면 시작 · 5인 이상 사업장 법규 대응</div>

        {/* 제품 미리보기 */}
        <div style={{ marginTop: "clamp(40px,6vw,64px)", border: "1px solid #E5E7EB", borderRadius: 14, background: "#F9FAFB", overflow: "hidden", textAlign: "left", boxShadow: "0 20px 50px rgba(17,24,39,0.06)" }}>
          <div style={{ height: 38, display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderBottom: "1px solid #E5E7EB", background: "#fff" }}>
            <span style={dot()} />
            <span style={dot()} />
            <span style={dot()} />
            <span style={{ marginLeft: 12, fontSize: 13, color: "#9CA3AF" }}>app.근태관리.co.kr</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, padding: 20 }}>
            {peek.map((p) => (
              <div key={p.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 8 }}>{p.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: p.color }}>{p.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 차별점 */}
      <section id="features" style={{ background: "#F9FAFB", borderTop: "1px solid #E5E7EB" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(32px,5vw,48px)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#2563EB", marginBottom: 10 }}>WHY 근태관리</div>
            <h2 style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>일하는 사람도, 관리하는 사람도 편하게</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
            {features.map((f) => (
              <div key={f.title} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "28px 26px" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#EFF6FF", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {f.icon}
                  </svg>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 15, color: "#6B7280", lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "clamp(56px,8vw,88px) 24px", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 14px" }}>오늘부터 근태를 정직하게</h2>
        <p style={{ fontSize: 16, color: "#6B7280", margin: "0 0 28px" }}>5분이면 회사 계정을 만들고 직원을 초대할 수 있어요.</p>
        <Link href="/signup" style={{ height: 52, padding: "0 30px", display: "inline-flex", alignItems: "center", borderRadius: 9, background: "#2563EB", color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none" }}>
          무료로 시작하기
        </Link>
      </section>

      {/* 푸터 */}
      <footer style={{ borderTop: "1px solid #E5E7EB" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
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

function logoBox(size: number, radius: number, fontSize: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: radius,
    background: "#2563EB",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontSize,
    fontWeight: 700,
    flexShrink: 0,
  };
}

function dot(): React.CSSProperties {
  return { width: 10, height: 10, borderRadius: "50%", background: "#E5E7EB" };
}
