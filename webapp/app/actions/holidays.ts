"use server";
// 공휴일·회사휴무일 설정 — 관리자만. 자동반영 토글 / 수동휴무일 추가·삭제 / 정부 API 지금 갱신.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";
import { syncHolidays } from "@/lib/holiday-server";
import { countHolidayImpact, holidayWarning, holidayAuditText, IMPACT_FAILED_WARNING, type HolidayImpact } from "@/lib/retroactive";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// needConfirm=true면 **아직 저장하지 않았다**. 화면이 warning을 보여주고, 관리자가 한 번 더 누르면
// confirm="1"과 함께 다시 호출된다(검수 M-9 — 소급 변경을 모르고 누르는 것을 막는다).
//  · echo*: 다시 보낼 값을 화면에 되돌려준다. React는 서버액션이 끝나면 폼의 입력값을 비우므로,
//    "그대로 저장" 버튼이 같은 값을 다시 보내려면 서버가 값을 알려줘야 한다.
type Result = {
  error?: string;
  ok?: boolean;
  msg?: string;
  warning?: string;
  needConfirm?: boolean;
  echoDate?: string;
  echoName?: string;
  echoId?: string;
};

// "YYYY-MM-DD"가 실제 존재하는 날짜인지(2026-02-30 같은 값 방어).
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// 자동 공휴일 반영 ON/OFF 저장.
export async function saveHolidayAuto(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const on = formData.get("holidayAutoOn") === "on"; // 체크박스: 켜졌을 때만 값이 온다
  await prisma.company.update({ where: { id: me.companyId }, data: { holidayAutoOn: on } });

  await logAdminAction(me, "config", "holiday_auto");
  revalidatePath("/settings");
  return { ok: true };
}

// 회사 수동 휴무일 추가(같은 날 재등록이면 이름만 갱신).
export async function addCompanyHoliday(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const date = String(formData.get("date") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 50);
  if (!isRealDate(date)) return { error: "날짜를 올바르게 골라주세요. (예: 2026-08-15)" };
  if (!name) return { error: "휴무일 이름을 입력해주세요. (예: 창립기념일)" };

  // 🔴 [검수 M-9] 지난 날짜를 휴무일로 지정하면 그날의 지각·결근 판정이 사라지고,
  //    이미 승인된 휴가의 연차 차감은 **자동으로 돌아오지 않는다**(차감은 신청 시점에 고정).
  //    데이터를 자동으로 되돌리지 않는 대신, 영향 건수를 세어 보여주고 한 번 더 확인받는다.
  //    ⚠️ 계산이 실패해도 화면이 죽지 않게 감싸되, **경고 없이 저장되지는 않게** 보수적 경고로 대체한다.
  let impact: HolidayImpact | null = null;
  let warning: string | null = null;
  try {
    impact = await countHolidayImpact(me.companyId, date, "add");
    warning = holidayWarning(date, "add", impact);
  } catch (e) {
    console.error("[addCompanyHoliday] 영향 계산 실패:", e);
    warning = IMPACT_FAILED_WARNING;
  }
  if (warning && formData.get("confirm") !== "1") {
    return { needConfirm: true, warning, echoDate: date, echoName: name };
  }

  await prisma.companyHoliday.upsert({
    where: { companyId_date: { companyId: me.companyId, date } },
    update: { name, createdBy: me.name },
    create: { companyId: me.companyId, date, name, createdBy: me.name },
  });

  // 감사로그에 **어느 날짜를 소급으로 건드렸고 영향이 몇 건이었는지** 남긴다.
  //  ※ lib/audit.ts는 원칙적으로 "값"을 남기지 않지만, 날짜·건수는 개인정보가 아니고
  //    이것을 모르면 "누가 언제 과거 기록을 다시 쓰게 했는지"를 되짚을 수 없다.
  await logAdminAction(me, "config", impact ? holidayAuditText("add", date, impact) : `company_holiday_add(${date})`);
  // [설정] 폼과 [일정] 캘린더 두 곳에서 호출된다 — 두 화면 모두 새로고침해야 반영이 즉시 보인다.
  revalidatePath("/settings");
  revalidatePath("/schedule");
  return { ok: true };
}

// 회사 수동 휴무일 삭제(회사 소유 확인 포함).
export async function deleteCompanyHoliday(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "삭제 대상이 없습니다." };

  // 다른 회사 것 삭제 방지 — id + companyId 동시 일치할 때만 조회·삭제한다.
  const target = await prisma.companyHoliday.findFirst({ where: { id, companyId: me.companyId }, select: { date: true } });
  if (!target) return { error: "이미 삭제되었거나 대상을 찾을 수 없습니다." };

  // 🔴 [검수 M-9] 휴무일을 풀면 그날이 다시 근무일이 되어 **없던 결근·지각이 소급 발생**한다.
  let impact: HolidayImpact | null = null;
  let warning: string | null = null;
  try {
    impact = await countHolidayImpact(me.companyId, target.date, "delete");
    warning = holidayWarning(target.date, "delete", impact);
  } catch (e) {
    console.error("[deleteCompanyHoliday] 영향 계산 실패:", e);
    warning = IMPACT_FAILED_WARNING;
  }
  if (warning && formData.get("confirm") !== "1") {
    return { needConfirm: true, warning, echoId: id, echoDate: target.date };
  }

  const res = await prisma.companyHoliday.deleteMany({ where: { id, companyId: me.companyId } });
  if (res.count === 0) return { error: "이미 삭제되었거나 대상을 찾을 수 없습니다." };

  await logAdminAction(me, "config", impact ? holidayAuditText("delete", target.date, impact) : `company_holiday_del(${target.date})`);
  // [설정]·[일정] 두 화면 모두 새로고침(위 add와 동일 이유).
  revalidatePath("/settings");
  revalidatePath("/schedule");
  return { ok: true };
}

// 정부 API에서 올해·내년 공휴일을 지금 받아와 저장. 실패해도 기존 저장분은 유지.
export async function syncHolidaysNow(_prev: Result, _formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const thisYear = new Date().getFullYear();
  const r = await syncHolidays([thisYear, thisYear + 1]);
  if (!r.ok) return { error: `공휴일 갱신 실패: ${r.error ?? "알 수 없는 오류"}` };

  await logAdminAction(me, "config", "holiday_sync");
  revalidatePath("/settings");
  return { ok: true, msg: `${thisYear}·${thisYear + 1}년 공휴일 ${r.count}건을 받아왔습니다.` };
}
