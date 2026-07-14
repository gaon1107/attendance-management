// 연차 정산 엑셀(.xlsx) 내보내기 — 관리자만. 연도별 발생·사용·잔여. (연차정산 화면과 동일 집계)
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { usedLeaveDaysInYear } from "@/lib/leave";
import { toISODate } from "@/lib/period";
import { queryTerms, matchesTerms } from "@/lib/search";

// exceljs는 Node 런타임 필요 — Edge로 실행되지 않도록 고정.
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return new Response("권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const thisYear = new Date().getFullYear();
  // 화면과 동일: 회사 도입연도~올해만 허용. 올해만 발생·잔여가 의미 있음(과거는 사용만).
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { createdAt: true } });
  const startYear = company ? company.createdAt.getFullYear() : thisYear;
  const yParam = Number(url.searchParams.get("year"));
  const year = Number.isInteger(yParam) && yParam <= thisYear && yParam >= startYear ? yParam : thisYear;
  const isCurrentYear = year === thisYear;

  // 화면(page.tsx)과 동일한 집계 — 회사 격리 + 재직 직원만.
  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, role: "employee", deactivatedAt: null },
    select: { id: true, name: true, hireDate: true, annualLeaveDays: true, department: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const yStart = new Date(year, 0, 1);
  const yEnd = new Date(year + 1, 0, 1);
  const leaves = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { gte: yStart, lt: yEnd } },
    select: { userId: true, type: true, days: true, status: true, startDate: true },
  });
  const byUser = new Map<string, typeof leaves>();
  for (const lv of leaves) {
    const arr = byUser.get(lv.userId);
    if (arr) arr.push(lv);
    else byUser.set(lv.userId, [lv]);
  }
  const rows = employees.map((e) => {
    const used = usedLeaveDaysInYear(byUser.get(e.id) ?? [], year);
    // 화면과 동일: 과거 연도는 발생·잔여를 비운다(빈 셀). 발생은 소수 1자리로(화면=엑셀 일치).
    const granted = isCurrentYear ? Math.round(e.annualLeaveDays * 10) / 10 : null;
    const remain = granted === null ? null : Math.round((granted - used) * 10) / 10;
    return {
      name: e.name,
      dept: e.department?.name ?? "미배정",
      hireDate: e.hireDate ? toISODate(e.hireDate) : "",
      granted,
      used,
      remain,
    };
  });

  // 통합검색어(q)가 있으면 화면과 동일한 OR 규칙(이름·부서)으로 거른다 → "보이는 직원만" 엑셀에.
  const terms = queryTerms(url.searchParams.get("q") ?? "");
  const filtered = terms.length
    ? rows.filter((r) => matchesTerms(`${r.name} ${r.dept}`.toLowerCase(), terms))
    : rows;

  // ── 엑셀 워크북 ─────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "근태관리";
  const ws = wb.addWorksheet(`연차정산_${year}`, { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "이름", key: "name", width: 12 },
    { header: "부서", key: "dept", width: 14 },
    { header: "입사일", key: "hireDate", width: 13 },
    { header: "발생(일)", key: "granted", width: 10 },
    { header: "사용(일)", key: "used", width: 10 },
    { header: "잔여(일)", key: "remain", width: 10 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF374151" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    c.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  ws.autoFilter = { from: "A1", to: "F1" };

  for (const r of filtered) {
    ws.addRow({ name: r.name, dept: r.dept, hireDate: r.hireDate, granted: r.granted, used: r.used, remain: r.remain });
  }

  // 숫자 열 우측 정렬
  for (const key of ["granted", "used", "remain"]) {
    ws.getColumn(key).alignment = { horizontal: "right" };
  }

  const buf = await wb.xlsx.writeBuffer();
  const filename = `annual_leave_${year}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
