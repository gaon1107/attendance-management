// 로그인 이력 엑셀(.xlsx) 내보내기 — 관리자만. 화면(logins/page.tsx)과 동일한 회사격리·기간·검색 필터.
//  · 조회 상한은 화면(2000)보다 크다(감사 목적). 상한 초과 시 "침묵 누락"을 막기 위해 경고 행을 남긴다.
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { toISODate } from "@/lib/period";
import { accessKindLabel, accessResultLabel, accessMetaLabel } from "@/lib/access-labels";
import { queryTerms, matchesTerms } from "@/lib/search";

// exceljs는 Node 런타임 필요 — Edge로 실행되지 않도록 고정.
export const runtime = "nodejs";

const AUTH_KINDS = ["login", "login_fail", "logout"];

function fmtDateTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export async function GET(request: Request): Promise<Response> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return new Response("권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const now = new Date();
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const normISO = (s: string | null, fb: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime())) return s;
    return fb;
  };
  const fromISO = normISO(url.searchParams.get("from"), defFrom);
  let toISO = normISO(url.searchParams.get("to"), defTo);
  if (toISO < fromISO) toISO = fromISO;
  const start = new Date(fromISO + "T00:00:00");
  const endDay = new Date(toISO + "T00:00:00");
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 92);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd); // 파일명·조회창을 화면과 동일하게 캡 반영
  }

  const EXPORT_CAP = 10000;
  const events = await prisma.accessEvent.findMany({
    where: { companyId: me.companyId, kind: { in: AUTH_KINDS }, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
    take: EXPORT_CAP,
  });
  const capped = events.length >= EXPORT_CAP; // 상한에 걸렸으면 침묵 누락 방지 경고를 남긴다.

  const rows = events.map((e) => {
    const name = e.actorName ?? e.emailTried ?? "알 수 없음";
    const kindLabel = accessKindLabel(e.kind);
    const resultLabel = accessResultLabel(e.result);
    const metaLabel = accessMetaLabel(e.meta);
    return {
      time: fmtDateTime(e.createdAt),
      name,
      email: e.emailTried ?? "",
      action: kindLabel,
      device: e.device ?? "",
      ip: e.ip ?? "",
      result: resultLabel,
      note: metaLabel,
      search: [name, e.emailTried ?? "", kindLabel, e.device ?? "", e.ip ?? "", resultLabel, metaLabel].join(" ").toLowerCase(),
    };
  });

  // 통합검색어(q)가 있으면 화면과 동일하게 거른다 → "보이는 것만" 엑셀에.
  const terms = queryTerms(url.searchParams.get("q") ?? "");
  const filtered = terms.length ? rows.filter((r) => matchesTerms(r.search, terms)) : rows;

  // ── 엑셀 워크북 ─────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "근태관리";
  const ws = wb.addWorksheet("로그인이력", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "시각", key: "time", width: 14 },
    { header: "이름", key: "name", width: 14 },
    { header: "이메일", key: "email", width: 24 },
    { header: "동작", key: "action", width: 12 },
    { header: "기기", key: "device", width: 14 },
    { header: "IP", key: "ip", width: 16 },
    { header: "결과", key: "result", width: 8 },
    { header: "비고", key: "note", width: 16 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF374151" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    c.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });
  ws.autoFilter = { from: "A1", to: "H1" };

  for (const r of filtered) {
    ws.addRow({ time: r.time, name: r.name, email: r.email, action: r.action, device: r.device, ip: r.ip, result: r.result, note: r.note });
  }

  // 상한 초과 시: 침묵 누락 방지 — 마지막에 경고 행을 남긴다(감사 자료가 잘렸음을 명시).
  if (capped) {
    const warn = ws.addRow({ time: `※ 결과가 상한(${EXPORT_CAP.toLocaleString()}건)을 초과해 최신 ${EXPORT_CAP.toLocaleString()}건만 포함됩니다. 기간을 좁혀 다시 내보내세요.` });
    warn.font = { bold: true, color: { argb: "FFB91C1C" } };
    ws.mergeCells(`A${warn.number}:H${warn.number}`);
  }

  const buf = await wb.xlsx.writeBuffer();
  const filename = `login_history_${fromISO}_${toISO}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
