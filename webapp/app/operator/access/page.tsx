// 운영자 — 운영자 접속 기록 (2026-11-18, 운영 준비 3단계 · 운영자 백오피스 검수 M-5)
//
// 왜 필요한가: 「개인정보의 안전성 확보조치 기준」 제8조 2항 — 개인정보처리시스템 접속기록을 **월 1회 이상 점검**해야 한다.
//   운영자(본사)의 로그인·실패·로그아웃·회원사 열람·설정 변경 기록은 지금까지 쌓이기만 하고 볼 화면이 없었다.
// 무엇을 보여주나: companyId=null 이면서 행위자가 "운영자…"인 기록만(목록·상세 열람, 변경, 로그인·실패·시도 제한 포함)(고객사 직원 기록은 섞지 않는다).
//   ※ 존재하지 않는 이메일로 운영자 로그인을 시도한 실패도 행위자 "운영자"로 남으므로 여기 포함된다(app/actions/operator.ts).
// 🔴 로그인 검사는 맨 위에서(app/operator/layout.tsx 주석).
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentOperator } from "@/lib/operator-session";
import { accessKindLabel, accessResultLabel, accessMetaLabel } from "@/lib/access-labels";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { OperatorHeader } from "../OperatorHeader";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const MAX_RANGE_DAYS = 366; // 한 번에 1년까지
const KINDS: { key: string; label: string }[] = [
  { key: "", label: "전체" },
  { key: "login", label: "로그인" },
  { key: "login_fail", label: "로그인 실패" },
  { key: "logout", label: "로그아웃" },
  { key: "data_view", label: "회원사 열람" },
  { key: "config", label: "설정 변경" },
];

type SP = Promise<{ from?: string; to?: string; k?: string; p?: string }>;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
function stamp(d: Date): string {
  return `${iso(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default async function OperatorAccessPage({ searchParams }: { searchParams: SP }) {
  const me = await getCurrentOperator();
  if (!me) redirect("/operator/login");

  const sp = await searchParams;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 기본 기간 = 최근 30일(월 1회 점검 단위). 잘못된 값이면 기본값으로.
  let to = parseIso(sp.to) ?? today;
  let from = parseIso(sp.from) ?? new Date(today.getTime() - 29 * 86400000);
  if (from > to) [from, to] = [to, from];
  if ((to.getTime() - from.getTime()) / 86400000 > MAX_RANGE_DAYS) from = new Date(to.getTime() - MAX_RANGE_DAYS * 86400000);
  const toEnd = new Date(to.getTime() + 86400000); // to 날짜 하루 전체 포함
  const kind = KINDS.some((k) => k.key === sp.k) ? String(sp.k ?? "") : "";

  const where: Prisma.AccessEventWhereInput = {
    companyId: null,
    actorName: { startsWith: "운영자" },
    createdAt: { gte: from, lt: toEnd },
    ...(kind ? { kind } : {}),
  };
  const total = await prisma.accessEvent.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(Number(sp.p)) || 1), pages);
  const rows = await prisma.accessEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { id: true, createdAt: true, actorName: true, emailTried: true, kind: true, result: true, meta: true, ip: true, device: true },
  });
  const failCount = await prisma.accessEvent.count({ where: { ...where, kind: "login_fail" } });

  const q = (extra: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams({ from: iso(from), to: iso(to) });
    if (kind) s.set("k", kind);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === "") s.delete(k);
      else s.set(k, String(v));
    }
    return `/operator/access?${s.toString()}`;
  };

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 16px", fontSize: 14, verticalAlign: "middle" };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <OperatorHeader name={me.name} active="access" />
      <main style={{ padding: "28px 28px 40px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>운영자 접속 기록</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", margin: "0 0 18px", lineHeight: 1.6, wordBreak: "keep-all" }}>
          본사 운영자의 로그인·회원사 열람·설정 변경 기록입니다. 개인정보 보호 기준상 <b style={{ color: "var(--text)" }}>한 달에 한 번 이상</b> 훑어보고,
          모르는 로그인이나 실패가 몰린 흔적이 없는지 확인해 주세요. 기록은 2년 보관 후 자동 삭제됩니다.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <RangeCalendarNav from={iso(from)} to={iso(to)} todayISO={iso(today)} basePath="/operator/access" extraQuery={kind ? { k: kind } : undefined} />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {KINDS.map((k) => {
              const on = k.key === kind;
              return (
                <Link
                  key={k.key || "all"}
                  href={q({ k: k.key, p: undefined })}
                  aria-current={on ? "page" : undefined}
                  style={{
                    height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 16,
                    fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                    border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                    background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--text-sub)",
                  }}
                >
                  {k.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 13, color: failCount > 0 ? "var(--danger)" : "var(--text-sub)", marginBottom: 10, fontWeight: failCount > 0 ? 700 : 400 }}>
          이 기간 {total}건{kind ? "" : ` · 로그인 실패 ${failCount}건`}
        </div>

        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>시각</th>
                  <th style={th}>운영자</th>
                  <th style={th}>동작</th>
                  <th style={th}>결과</th>
                  <th style={th}>내용</th>
                  <th style={th}>IP</th>
                  <th style={th}>기기</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-sub)", padding: "32px 16px" }}>이 기간에 기록이 없습니다.</td>
                  </tr>
                )}
                {rows.map((r) => {
                  const bad = r.result !== "success";
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{stamp(r.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {r.actorName}
                        {r.emailTried && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.emailTried}</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{accessKindLabel(r.kind)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: bad ? "var(--danger)" : "var(--text)", fontWeight: bad ? 700 : 400 }}>{accessResultLabel(r.result)}</td>
                      <td style={{ ...td, wordBreak: "keep-all" }}>{accessMetaLabel(r.meta) || "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: r.ip ? "var(--text)" : "var(--text-sub)" }}>{r.ip ?? "확인 불가"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: "var(--text-sub)" }}>{r.device ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {pages > 1 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--text-sub)" }}>
            {page > 1 ? <Link href={q({ p: page - 1 })} style={{ color: "var(--primary)", fontWeight: 700 }}>← 이전</Link> : <span>← 이전</span>}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{page} / {pages}</span>
            {page < pages ? <Link href={q({ p: page + 1 })} style={{ color: "var(--primary)", fontWeight: 700 }}>다음 →</Link> : <span>다음 →</span>}
          </div>
        )}
      </main>
    </div>
  );
}
