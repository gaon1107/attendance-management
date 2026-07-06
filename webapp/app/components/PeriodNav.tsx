// 기간 이동 + 단위(일/주/월) 탭 — 근태현황·내근태 등 기간 조회 화면 공통.
// basePath 예: "/records" 또는 "/records/abc123" (뒤에 ?unit=..&date=.. 를 붙인다)
import Link from "next/link";
import { shiftAnchor, toISODate, type Unit } from "@/lib/period";

const UNITS: { key: Unit; label: string }[] = [
  { key: "day", label: "일" },
  { key: "week", label: "주" },
  { key: "month", label: "월" },
];

const navBtn: React.CSSProperties = {
  width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
  textDecoration: "none", fontWeight: 700,
};

export function PeriodNav({
  basePath,
  unit,
  anchor,
  label,
}: {
  basePath: string;
  unit: Unit;
  anchor: Date;
  label: string;
}) {
  const prev = toISODate(shiftAnchor(unit, anchor, -1));
  const next = toISODate(shiftAnchor(unit, anchor, 1));
  const anchorISO = toISODate(anchor);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Link href={`${basePath}?unit=${unit}&date=${prev}`} style={navBtn}>◀</Link>
        <div style={{ fontSize: 18, fontWeight: 700, minWidth: 170, textAlign: "center" }}>{label}</div>
        <Link href={`${basePath}?unit=${unit}&date=${next}`} style={navBtn}>▶</Link>
      </div>
      <div style={{ display: "inline-flex", background: "#EEF2F7", borderRadius: 8, padding: 3 }}>
        {UNITS.map((u) => {
          const on = u.key === unit;
          return (
            <Link
              key={u.key}
              href={`${basePath}?unit=${u.key}&date=${anchorISO}`}
              style={{ height: 34, padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: 6, fontSize: 15, fontWeight: 700, textDecoration: "none", background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--text-sub)", boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}
            >
              {u.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
