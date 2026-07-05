// 법정 근로기록 CSV 내보내기 — 관리자만. 기간 내 날짜별 상세(출근·퇴근·실근무).
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { workedMinutes } from "@/lib/worktime";
import { workModeLabel, locationStatusLabel } from "@/lib/location";
import { normalizeUnit, parseAnchor, rangeFor, toISODate } from "@/lib/period";

function hhmm(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// CSV 한 칸 안전하게 감싸기(쉼표·따옴표·줄바꿈 대응)
function cell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request): Promise<Response> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return new Response("권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const unit = normalizeUnit(url.searchParams.get("unit") ?? undefined);
  const anchor = parseAnchor(url.searchParams.get("date") ?? undefined);
  const { start, end } = rangeFor(unit, anchor);

  const rows = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: [{ clockIn: "asc" }],
  });

  const header = ["이름", "역할", "날짜", "근무형태", "위치확인", "출근", "퇴근", "실근무(분)", "외출(회)"];
  const lines = [header.map(cell).join(",")];

  for (const r of rows) {
    lines.push(
      [
        r.user.name,
        r.user.role === "admin" ? "관리자" : "직원",
        toISODate(r.clockIn),
        workModeLabel(r.workMode),
        r.workMode === "office" ? locationStatusLabel(r.locationStatus) : "-",
        hhmm(r.clockIn),
        hhmm(r.clockOut),
        workedMinutes(r),
        r.breaks.length,
      ]
        .map(cell)
        .join(",")
    );
  }

  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 추가
  const csv = "﻿" + lines.join("\r\n");
  const filename = `attendance_${unit}_${toISODate(anchor)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
