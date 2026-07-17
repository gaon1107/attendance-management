"use server";
// 공휴일·회사휴무일 설정 — 관리자만. 자동반영 토글 / 수동휴무일 추가·삭제 / 정부 API 지금 갱신.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";
import { syncHolidays } from "@/lib/holiday-server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Result = { error?: string; ok?: boolean; msg?: string };

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

  await prisma.companyHoliday.upsert({
    where: { companyId_date: { companyId: me.companyId, date } },
    update: { name, createdBy: me.name },
    create: { companyId: me.companyId, date, name, createdBy: me.name },
  });

  await logAdminAction(me, "config", "company_holiday_add");
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

  // 다른 회사 것 삭제 방지 — id + companyId 동시 일치할 때만 지운다.
  const res = await prisma.companyHoliday.deleteMany({ where: { id, companyId: me.companyId } });
  if (res.count === 0) return { error: "이미 삭제되었거나 대상을 찾을 수 없습니다." };

  await logAdminAction(me, "config", "company_holiday_del");
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
