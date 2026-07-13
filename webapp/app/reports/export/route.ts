// 법정 근로기록 엑셀(.xlsx) 내보내기 — 관리자만. 기간 내 날짜별 상세(출근·퇴근·실근무).
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { workedMinutes } from "@/lib/worktime";
import { workModeLabel, locationStatusLabel } from "@/lib/location";
import { parseAnchor, toISODate } from "@/lib/period";
import { queryTerms, matchesTerms } from "@/lib/search";

// exceljs는 Node 런타임(스트림) 필요 — Edge 런타임으로 실행되지 않도록 고정.
export const runtime = "nodejs";

function hhmm(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export async function GET(request: Request): Promise<Response> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return new Response("권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  // 기간 파라미터 from/to("YYYY-MM-DD")를 화면(page.tsx)과 동일 규칙으로 검증·보정한다.
  const now = new Date();
  const todayISO = toISODate(now);
  const monthStartISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const normISO = (s: string | null, fallback: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      if (!Number.isNaN(d.getTime())) return s;
    }
    return fallback;
  };
  const fromISO = normISO(url.searchParams.get("from"), monthStartISO);
  let toISO = normISO(url.searchParams.get("to"), todayISO);
  if (toISO < fromISO) toISO = fromISO;

  const start = parseAnchor(fromISO);
  start.setHours(0, 0, 0, 0);
  const endDay = parseAnchor(toISO);
  endDay.setHours(0, 0, 0, 0);
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  // 화면과 동일하게 최대 92일로 제한
  const MAX_DAYS = 92;
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + MAX_DAYS);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  const all = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: [{ clockIn: "asc" }],
  });

  // 통합검색어(q)가 있으면 화면(ReportsClient)과 동일한 OR 규칙으로 직원(이름·역할)을 거른다.
  // → "화면에 보이는 직원만" 엑셀에 담긴다. q가 없으면 기간 전체.
  const terms = queryTerms(url.searchParams.get("q") ?? "");
  const rows = terms.length
    ? all.filter((r) => matchesTerms([r.user.name, r.user.role === "admin" ? "관리자" : "직원"].join(" ").toLowerCase(), terms))
    : all;

  // ── 엑셀 워크북 만들기 ────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "근태관리";
  const ws = wb.addWorksheet("근태기록", { views: [{ state: "frozen", ySplit: 1 }] }); // 헤더 행 고정

  ws.columns = [
    { header: "이름", key: "name", width: 12 },
    { header: "역할", key: "role", width: 8 },
    { header: "날짜", key: "date", width: 13 },
    { header: "근무형태", key: "workMode", width: 12 },
    { header: "위치확인", key: "location", width: 12 },
    { header: "출근", key: "in", width: 8 },
    { header: "퇴근", key: "out", width: 8 },
    { header: "실근무(분)", key: "worked", width: 12 },
    { header: "외출(회)", key: "breaks", width: 10 },
  ];

  // 헤더 행 서식: 굵게 + 회색 배경 + 가운데 정렬 + 자동 필터
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF374151" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    c.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  ws.autoFilter = { from: "A1", to: "I1" };

  for (const r of rows) {
    ws.addRow({
      name: r.user.name,
      role: r.user.role === "admin" ? "관리자" : "직원",
      date: toISODate(r.clockIn),
      workMode: workModeLabel(r.workMode),
      location: r.workMode === "office" ? locationStatusLabel(r.locationStatus) : "-",
      in: hhmm(r.clockIn),
      out: hhmm(r.clockOut),
      worked: workedMinutes(r), // 숫자 셀(엑셀에서 합계 가능)
      breaks: r.breaks.length, // 숫자 셀
    });
  }

  // 숫자 열 우측 정렬
  ws.getColumn("worked").alignment = { horizontal: "right" };
  ws.getColumn("breaks").alignment = { horizontal: "right" };

  const buf = await wb.xlsx.writeBuffer();
  const filename = `attendance_${fromISO}_${toISO}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
