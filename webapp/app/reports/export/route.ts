// 법정 근로기록 엑셀(.xlsx) 내보내기 — 관리자만.
//  · 1번 시트 "근태기록": 날짜별 상세(출근·퇴근·실근무) + **결근·휴가 줄**
//  · 2번 시트 "직원별 요약": 리포트 화면 표와 같은 인원·같은 숫자(급여 정산용)
//  ※ 대상자·결근/휴가 판정은 lib/report-server.ts(→ lib/report-days.ts) 한 곳에서 만든다.
//    예전엔 이 파일이 출근 기록만 읽어 **한 달 내내 결근한 직원이 통째로 빠졌다**(검수 H-7).
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/session";
import { formatMinutes } from "@/lib/worktime";
import { parseAnchor, toISODate } from "@/lib/period";
import { buildReportBlocks } from "@/lib/report-server";

// exceljs는 Node 런타임(스트림) 필요 — Edge 런타임으로 실행되지 않도록 고정.
export const runtime = "nodejs";

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
  const rangeCapped = end > maxEnd;
  if (rangeCapped) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  // 대상자·결근/휴가 판정은 공용 조립기가 만든다(리포트 화면과 같은 규칙·같은 인원).
  //  통합검색어(q)도 같은 규칙(이름·사번·역할)으로 여기서 적용된다 — 사번을 포함해야 동명이인이 구분된다.
  const standardMin = Math.round((me.company.standardWorkHours ?? 8) * 60);
  const people = await buildReportBlocks({
    companyId: me.companyId, start, end, q: url.searchParams.get("q") ?? "", now, standardMin,
  });

  // ── 엑셀 워크북 만들기 ────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "근태관리";

  // 헤더 행 공통 서식: 굵게 + 회색 배경 + 가운데 정렬
  const styleHeader = (ws: ExcelJS.Worksheet) => {
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FF374151" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      c.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
    });
  };

  // 1번 시트: 날짜별 상세(출근 + 결근 + 휴가)
  const ws = wb.addWorksheet("근태기록", { views: [{ state: "frozen", ySplit: 1 }] }); // 헤더 행 고정
  ws.columns = [
    { header: "이름", key: "name", width: 12 },
    { header: "사번", key: "employeeNo", width: 10 },
    { header: "역할", key: "role", width: 8 },
    { header: "날짜", key: "date", width: 13 },
    { header: "구분", key: "kind", width: 14 }, // 출근 · 결근 · 휴가 · 연차
    { header: "근무형태", key: "workMode", width: 12 },
    { header: "위치확인", key: "location", width: 12 },
    { header: "출근", key: "in", width: 8 },
    { header: "퇴근", key: "out", width: 8 },
    { header: "실근무(분)", key: "worked", width: 12 },
    { header: "외출(회)", key: "breaks", width: 10 },
  ];
  styleHeader(ws);
  ws.autoFilter = { from: "A1", to: "K1" };

  for (const p of people) {
    const roleLabel = p.role === "admin" ? "관리자" : "직원";
    for (const r of p.rows) {
      ws.addRow({
        name: p.name,
        employeeNo: p.employeeNo ?? "",
        role: roleLabel,
        date: r.date,
        kind: r.kindLabel, // "출근" · "결근" · "휴가 · 연차"
        workMode: r.workMode,
        location: r.location,
        in: r.in,
        // 퇴근 시각이 비어 있으면 "미퇴근"임을 글자로 남긴다 — 빈칸이면 증빙에서 오해를 부른다(검수 C-6).
        out: r.kind === "work" ? (r.out || (r.unclosed ? "미퇴근" : "근무중")) : "",
        // 결근·휴가 줄은 숫자 0이 아니라 **빈칸**으로 둔다.
        //  0을 넣으면 합계(SUM)는 같지만 평균(AVERAGE)이 뚝 떨어지고 건수(COUNT)가 결근까지 세어
        //  급여 담당자가 조용히 틀린 숫자를 쓰게 된다(검수 M-2).
        worked: r.kind === "work" ? r.worked : null, // 숫자 셀(엑셀에서 합계 가능)
        breaks: r.kind === "work" ? r.breaks : null,
      });
    }
  }
  ws.getColumn("worked").alignment = { horizontal: "right" };
  ws.getColumn("breaks").alignment = { horizontal: "right" };

  // 2번 시트: 직원별 요약 — **재직 전원**이 한 줄씩(출근이 0건이어도 결근과 함께 나온다).
  //  급여 담당자가 실제로 쓰는 표라, 여기서 사람이 빠지면 급여가 잘못 나간다.
  const ws2 = wb.addWorksheet("직원별 요약", { views: [{ state: "frozen", ySplit: 1 }] });
  ws2.columns = [
    { header: "이름", key: "name", width: 12 },
    { header: "사번", key: "employeeNo", width: 10 },
    { header: "역할", key: "role", width: 8 },
    { header: "재직상태", key: "state", width: 10 },
    { header: "근무일수", key: "days", width: 10 },
    { header: "실근무(분)", key: "worked", width: 12 },
    { header: "실근무", key: "workedText", width: 12 },
    { header: "초과근무(분)", key: "overtime", width: 13 },
    { header: "휴가(일)", key: "leave", width: 10 },
    { header: "결근(일)", key: "absent", width: 10 },
    { header: "외출(회)", key: "breaks", width: 10 },
  ];
  styleHeader(ws2);
  ws2.autoFilter = { from: "A1", to: "K1" };
  for (const p of people) {
    ws2.addRow({
      name: p.name,
      employeeNo: p.employeeNo ?? "",
      role: p.role === "admin" ? "관리자" : "직원",
      state: p.resigned ? "퇴사" : "재직",
      days: p.workedDays,
      worked: p.totalWorked,
      workedText: formatMinutes(p.totalWorked),
      overtime: p.overtime,
      leave: p.leaveDays,
      absent: p.absentDays,
      breaks: p.totalBreaks,
    });
  }
  for (const key of ["days", "worked", "overtime", "leave", "absent", "breaks"]) {
    ws2.getColumn(key).alignment = { horizontal: "right" };
  }

  // 3번 시트: 안내 — 화면·PDF와 달리 엑셀엔 집계 규칙·기간 제한 안내가 어디에도 없었다(검수 경미).
  //  ※ 요약 시트 아래에 붙이면 자동필터로 정렬할 때 데이터에 섞이므로 시트를 따로 둔다(검수 2차 경미).
  const ws3 = wb.addWorksheet("안내");
  ws3.columns = [{ header: "이 파일을 읽는 방법", key: "text", width: 110 }];
  styleHeader(ws3);
  const notes = [
    `조회 기간: ${fromISO} ~ ${toISO}${rangeCapped ? " (기간이 길어 시작일부터 92일까지만 집계했습니다)" : ""}`,
    "[근태기록] 시트 = 하루 한 줄. 구분이 '출근'이면 그날의 출퇴근 기록, '결근'·'휴가'는 기록이 없는 날입니다.",
    "결근 = 근무예정일(근무요일 · 공휴일/휴무일 제외 · 교대제면 배정된 날)인데 출근 기록도 승인된 휴가도 없는 날.",
    "오늘과 미래, 입사 전·퇴사 후는 결근으로 세지 않습니다. 퇴사자는 퇴사 처리 시각까지를 재직으로 봅니다.",
    "결재가 끝나지 않은 휴가, 승인된 출장·재택이라도 출퇴근 기록이 없으면 결근입니다. 그 사유를 구분 칸에 함께 적었습니다.",
    "[직원별 요약]의 휴가(일) = 휴가로 쉰 정도의 합(반차 0.5일, 하루 최대 1일). 휴가일에 출근한 날은 근무일수로만 셉니다.",
    "결근·휴가 줄의 실근무·외출 칸은 빈칸입니다(0을 넣으면 평균·건수 계산이 틀어지기 때문).",
  ];
  for (const t of notes) ws3.addRow({ text: t });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `attendance_${fromISO}_${toISO}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
