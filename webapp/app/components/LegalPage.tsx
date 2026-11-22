// 약관·개인정보처리방침 같은 **법적 문서 화면의 공통 틀** (2026-11-22).
//  · 로그인 없이 누구나 볼 수 있어야 하는 화면이다(가입 전에 읽고 동의하므로). AppShell(로그인 후 틀)을 쓰지 않는다.
//  · 글이 길어 읽기 쉬움이 가장 중요하다 — 한 줄 길이를 제한하고(maxWidth), 줄간격을 넓게 둔다.
//  · 🔴 내용의 원본은 `docs/13_legal/약관_개인정보처리방침_초안.md`다. 문구를 고칠 때는 **그 문서와 함께** 고친다.
//    (화면만 고치면 근거 문서와 어긋나고, 나중에 "왜 이렇게 썼지?"를 추적할 수 없다.)
import Link from "next/link";

/** 본문 한 덩어리. 문자열이면 한 문단, 배열이면 들여쓴 목록(1. 2. 3.). */
export type LegalPara = string | string[];

/** 조항 하나. `no`가 없으면 번호 없는 안내 덩어리로 그린다. */
export type LegalArticle = {
  no?: string;
  title: string;
  paras: LegalPara[];
  /** 표가 필요한 조항(위탁 업체·보관기간 등). 머리글 + 줄들. */
  table?: { head: string[]; rows: string[][] };
};

/**
 * 글 안의 `**굵게**` 표기를 <b>로 바꾼다.
 *  · 마크다운 전체를 해석하지 않는다 — 굵게 하나만 쓴다(법률 문서에 필요한 강조는 이것뿐이다).
 *  · 이 화면의 글은 전부 우리가 쓴 상수라 바깥 입력이 섞이지 않는다(React가 이스케이프하므로 그래도 안전하다).
 */
function bold(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <b key={`${keyPrefix}-${i}`} style={{ fontWeight: 700, color: "var(--text)" }}>
        {part}
      </b>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  );
}

const pStyle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 15,
  lineHeight: 1.85,
  color: "var(--text-sub)",
  wordBreak: "keep-all",
};

export function LegalPage({
  title,
  effectiveDate,
  intro,
  articles,
  otherDoc,
}: {
  title: string;
  /** 시행일(화면에 그대로 보인다). */
  effectiveDate: string;
  intro?: string;
  articles: LegalArticle[];
  /** 짝이 되는 다른 문서로 가는 링크(약관 ↔ 처리방침). */
  otherDoc: { href: string; label: string };
}) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg,#F7F9FC)" }}>
      {/* 머리 — 로고를 누르면 홈으로. 가입 전 방문자가 길을 잃지 않게 한다. */}
      <header
        style={{
          background: "#fff",
          borderBottom: "1px solid var(--border,#E5EAF3)",
          padding: "14px 20px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--primary,#2563EB)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              가
            </span>
            <span style={{ fontWeight: 800, fontSize: 16, color: "var(--text,#111827)" }}>가온 근태관리</span>
          </Link>
          <Link href={otherDoc.href} style={{ fontSize: 13, fontWeight: 700, color: "var(--primary,#2563EB)", textDecoration: "none" }}>
            {otherDoc.label}
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 64px" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800, color: "var(--text,#111827)", wordBreak: "keep-all" }}>{title}</h1>
        <div style={{ fontSize: 13, color: "var(--text-sub,#6B7280)", marginBottom: 24 }}>시행일: {effectiveDate}</div>

        {intro && (
          <p style={{ ...pStyle, background: "#fff", border: "1px solid var(--border,#E5EAF3)", borderRadius: 12, padding: "16px 18px", marginBottom: 22 }}>
            {bold(intro, "intro")}
          </p>
        )}

        <div style={{ background: "#fff", border: "1px solid var(--border,#E5EAF3)", borderRadius: 12, padding: "8px 20px 20px" }}>
          {articles.map((a, ai) => (
            <section key={ai} style={{ paddingTop: 20 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 800, color: "var(--text,#111827)", wordBreak: "keep-all" }}>
                {a.no ? `${a.no} (${a.title})` : a.title}
              </h2>

              {a.paras.map((para, pi) =>
                Array.isArray(para) ? (
                  // ⚠️ listStyleType을 **인라인으로 명시**한다 — Tailwind preflight가 ol의 기본 번호를 지워서
                  //    그냥 두면 "각 호"로 참조하는 법률 문서에 번호가 안 보인다(2026-11-22 화면 확인에서 발견).
                  <ol key={pi} style={{ margin: "0 0 10px", paddingLeft: 24, listStyleType: "decimal", listStylePosition: "outside" }}>
                    {para.map((li, li2) => (
                      <li key={li2} style={{ ...pStyle, margin: "0 0 4px" }}>
                        {bold(li, `${ai}-${pi}-${li2}`)}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p key={pi} style={pStyle}>
                    {bold(para, `${ai}-${pi}`)}
                  </p>
                )
              )}

              {a.table && (
                // 표는 좁은 화면에서 가로로 민다(글자를 줄이면 읽을 수 없다).
                <div style={{ overflowX: "auto", margin: "4px 0 12px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480, fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: "var(--bg,#F7F9FC)" }}>
                        {a.table.head.map((h, hi) => (
                          <th
                            key={hi}
                            style={{
                              textAlign: "left",
                              padding: "9px 12px",
                              fontWeight: 700,
                              color: "var(--text-sub,#6B7280)",
                              borderBottom: "1px solid var(--border,#E5EAF3)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {a.table.rows.map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{ padding: "10px 12px", color: "var(--text-sub,#6B7280)", lineHeight: 1.65, wordBreak: "keep-all" }}>
                              {bold(cell, `${ai}-t-${ri}-${ci}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>

        <div style={{ marginTop: 22, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 14 }}>
          <Link href="/" style={{ color: "var(--primary,#2563EB)", fontWeight: 700, textDecoration: "none" }}>
            ← 홈으로
          </Link>
          <span aria-hidden style={{ color: "var(--border,#E5EAF3)" }}>|</span>
          <Link href={otherDoc.href} style={{ color: "var(--primary,#2563EB)", fontWeight: 700, textDecoration: "none" }}>
            {otherDoc.label}
          </Link>
        </div>
      </main>
    </div>
  );
}
