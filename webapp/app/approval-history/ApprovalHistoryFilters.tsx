"use client";
// 결재 이력 필터 바 — 유형·상태·직원 드롭다운 + 공통 기간 달력(RangeCalendar).
//  · 브라우저 기본 type="date" 대신 프로젝트 공통 달력을 쓴다(디자인 규칙 §5.6).
//  · 각 컨트롤은 즉시 이동(router.push) — 서버가 새 searchParams로 다시 조회·렌더한다.
import { useRouter } from "next/navigation";
import { RangeCalendar } from "@/app/components/RangeCalendar";

export type EmpOption = { id: string; name: string; employeeNo: string | null; retired: boolean };

const TYPE_OPTS: { value: string; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "leave", label: "휴가" },
  { value: "correction", label: "근태정정" },
  { value: "outing", label: "외출/외근" },
  { value: "remote", label: "재택근무" },
  { value: "overtime", label: "초과근무" },
  { value: "trip", label: "출장" },
];

const selectStyle: React.CSSProperties = { height: 38, padding: "0 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff", color: "var(--text)" };
const capStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text-sub)" };

export function ApprovalHistoryFilters({
  type,
  status,
  userId,
  from,
  to,
  todayISO,
  allPeriod,
  emps,
}: {
  type: string;
  status: string;
  userId: string;
  from: string;
  to: string;
  todayISO: string;
  allPeriod: boolean;
  emps: EmpOption[];
}) {
  const router = useRouter();

  // 현재 값에 변경분(over)만 덮어 URL을 만든다. 기본값(전체/기간 이번달)은 파라미터 생략.
  //  · all=true(전체 기간)이면 기간 파라미터는 싣지 않는다(서버가 from/to=null로 전체 조회).
  //  · all=false이면 from/to를 싣는다. 다른 필터만 바꿀 땐 현재 기간 모드를 그대로 유지한다.
  const build = (over: Partial<{ type: string; status: string; userId: string; from: string; to: string; all: boolean }>) => {
    const v = { type, status, userId, from, to, all: allPeriod, ...over };
    const q = new URLSearchParams();
    if (v.type !== "all") q.set("type", v.type);
    if (v.status !== "all") q.set("status", v.status);
    if (v.userId !== "all") q.set("userId", v.userId);
    if (v.all) q.set("all", "1");
    else {
      if (v.from) q.set("from", v.from);
      if (v.to) q.set("to", v.to);
    }
    const qs = q.toString();
    return `/approval-history${qs ? `?${qs}` : ""}`;
  };

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
        유형
        <select value={type} onChange={(e) => router.push(build({ type: e.target.value }))} style={selectStyle}>
          {TYPE_OPTS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
        상태
        <select value={status} onChange={(e) => router.push(build({ status: e.target.value }))} style={selectStyle}>
          <option value="all">전체</option>
          <option value="pending">대기</option>
          <option value="approved">승인</option>
          <option value="rejected">반려</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
        직원
        <select value={userId} onChange={(e) => router.push(build({ userId: e.target.value }))} style={{ ...selectStyle, maxWidth: 220 }}>
          <option value="all">전체</option>
          {emps.map((e) => (<option key={e.id} value={e.id}>{e.name}{e.employeeNo ? ` (${e.employeeNo})` : ""}{e.retired ? " · 퇴사" : ""}</option>))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
        신청 기간
        {/* 특정 범위 선택 시 all 해제(from/to로 조회). 전체 기간이면 달력을 흐리게(범위필터 미적용 표시)하고 '전체 기간' 버튼을 강조.
            흐려도 클릭은 가능 — 달력에서 범위를 고르면 range 모드로 전환된다. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{ opacity: allPeriod ? 0.45 : 1 }}
            title={allPeriod ? "전체 기간 조회 중 — 날짜를 고르면 기간 조회로 전환됩니다" : undefined}
          >
            <RangeCalendar from={from} to={to} todayISO={todayISO} onApply={(f, t) => router.push(build({ from: f, to: t, all: false }))} />
          </span>
          <button
            type="button"
            onClick={() => router.push(build({ all: true }))}
            aria-pressed={allPeriod}
            style={{
              height: 38, padding: "0 12px", borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              border: allPeriod ? "1px solid var(--primary)" : "1px solid var(--border)",
              background: allPeriod ? "var(--primary)" : "#fff",
              color: allPeriod ? "#fff" : "var(--text-sub)",
            }}
          >
            전체 기간
          </button>
        </div>
      </label>

      <a href="/approval-history" style={{ height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>초기화</a>
    </div>
  );
}
