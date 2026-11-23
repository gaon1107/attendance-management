// 운영자 화면 공통 상단 바(로고 · 메뉴 · 이름 · 로그아웃).
//  · 고객사 화면의 AppShell·사이드바는 "로그인한 직원의 회사" 기준이라 운영자에게 맞지 않는다(layout.tsx 주석).
//  · ⚠️ 이 컴포넌트는 로그인 검사를 하지 않는다 — 각 page.tsx 맨 위에서 getCurrentOperator()로 확인한 뒤 이름만 넘긴다.
import Link from "next/link";
import { operatorLogout } from "@/app/actions/operator";

export type OperatorMenu = "companies" | "payments" | "access" | "account";

const MENU: { key: OperatorMenu; href: string; label: string }[] = [
  { key: "companies", href: "/operator", label: "회원사" },
  // 결제(2026-11-23 결제 6단계) — 전체 회사 결제 목록·확인 필요·취소(환불). 조회는 lib/billing-operator.ts
  { key: "payments", href: "/operator/payments", label: "결제" },
  { key: "access", href: "/operator/access", label: "운영자 접속 기록" },
  // [내 계정]은 **본인 비밀번호·이름 변경만** 하는 화면이다. 계정을 새로 만들거나 남의 계정을
  // 건드리는 기능은 화면에 두지 않는다(app/actions/operator.ts 머리말 참고).
  { key: "account", href: "/operator/account", label: "내 계정" },
];

export function OperatorHeader({ name, active }: { name: string; active: OperatorMenu }) {
  return (
    <header
      style={{
        minHeight: 60, background: "var(--rail)", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "8px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 크기 고정 로고. 최적화 대상 아님 */}
          <img src="/logo.webp" alt="가온" width={144} height={120} style={{ height: 26, width: "auto", display: "block" }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>운영자</span>
        </div>
        <nav style={{ display: "flex", gap: 4 }}>
          {MENU.map((m) => {
            const on = m.key === active;
            return (
              <Link
                key={m.key}
                href={m.href}
                aria-current={on ? "page" : undefined}
                style={{
                  height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 6,
                  fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none",
                  color: on ? "#fff" : "var(--rail-text)", background: on ? "var(--rail-active)" : "transparent",
                }}
              >
                {m.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 13, color: "var(--rail-text)", whiteSpace: "nowrap" }}>{name}</span>
        <form action={operatorLogout}>
          <button
            type="submit"
            style={{
              height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid var(--rail-line)",
              background: "transparent", color: "var(--rail-text)", fontFamily: "inherit", fontSize: 13,
              fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            로그아웃
          </button>
        </form>
      </div>
    </header>
  );
}
