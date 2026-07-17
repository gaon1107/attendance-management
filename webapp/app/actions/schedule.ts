"use server";
// 회사 일정(캘린더) — 관리자만. 날짜에 일정 추가/삭제.
// ※ 일정은 표시 전용(근태 판정 무관)이라 감사로그(config)를 남기지 않는다 — 보안 로그를 잡음으로 채우지 않기 위함.
//    "쉬는 날" 지정/해제는 근태에 영향을 주므로 기존 actions/holidays.ts(감사로그 포함)를 그대로 쓴다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type Result = { error?: string; ok?: boolean };

// "YYYY-MM-DD"가 실제 존재하는 날짜인지(2026-02-30 방어).
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// 일정 추가.
export async function addEvent(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const date = String(formData.get("date") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  if (!isRealDate(date)) return { error: "날짜가 올바르지 않습니다." };
  if (!title) return { error: "일정 내용을 입력해주세요." };

  await prisma.companyEvent.create({ data: { companyId: me.companyId, date, title, createdBy: me.name } });
  revalidatePath("/schedule");
  return { ok: true };
}

// 일정 삭제(회사 소유 확인 포함).
export async function deleteEvent(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "삭제 대상이 없습니다." };

  const res = await prisma.companyEvent.deleteMany({ where: { id, companyId: me.companyId } });
  if (res.count === 0) return { error: "이미 삭제되었거나 찾을 수 없습니다." };
  revalidatePath("/schedule");
  return { ok: true };
}
