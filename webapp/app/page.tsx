// 랜딩 페이지 (공개) — 디자인 시안 "랜딩 페이지"의 담백한 톤을 뼈대용으로 단순화한 버전.
// 로그인 / 회사 회원가입 버튼은 다음 개발 단계에서 실제 화면으로 연결합니다.
import Link from "next/link";

const 차별점 = [
  {
    제목: "정직한 실근무시간",
    설명: "자리비움·외출을 반영해 실제 일한 시간을 신뢰도 높게 산출합니다.",
  },
  {
    제목: "법규 자동 준수",
    설명: "5인 이상 근로시간 기록·3년 보존을 기본으로 챙깁니다.",
  },
  {
    제목: "강제하지 않는 얼굴인증",
    설명: "얼굴인증은 선택, GPS 대체수단을 항상 함께 제공합니다.",
  },
];

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* 헤더 */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 1080,
          margin: "0 auto",
          padding: "20px 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            근
          </div>
          <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/login"
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text)",
              textDecoration: "none",
            }}
          >
            로그인
          </Link>
          <Link
            href="/signup"
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              background: "var(--primary)",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            무료로 시작하기
          </Link>
        </div>
      </header>

      {/* 히어로 */}
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "64px 24px 80px" }}>
        <h1
          style={{
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          정직한 실근무시간,
          <br />
          강제하지 않는 얼굴인증
        </h1>
        <p
          style={{
            fontSize: 17,
            color: "var(--text-sub)",
            marginTop: 20,
            lineHeight: 1.6,
          }}
        >
          중소기업 사무직을 위한 근태관리 SaaS. 복잡하지 않게, 법규는 자동으로.
        </p>
        <Link
          href="/signup"
          style={{
            display: "inline-block",
            marginTop: 28,
            padding: "14px 24px",
            fontSize: 16,
            fontWeight: 700,
            color: "#fff",
            background: "var(--primary)",
            borderRadius: 10,
            textDecoration: "none",
          }}
        >
          무료로 시작하기
        </Link>

        {/* 차별점 카드 3개 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            marginTop: 56,
          }}
        >
          {차별점.map((항목) => (
            <div
              key={항목.제목}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
                {항목.제목}
              </div>
              <div style={{ fontSize: 14, color: "var(--text-sub)", lineHeight: 1.6 }}>
                {항목.설명}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
