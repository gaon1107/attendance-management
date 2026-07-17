"use server";
// 일정(캘린더) — 날짜에 일정 추가/삭제.
// ※ 회사 일정(관리자, userId=null)과 개인 일정(직원 본인, userId=본인)을 구분한다.
//    · 관리자 추가 → 회사 일정(전 직원 공용)  · 직원 추가 → 개인 일정(본인만)
//    · 삭제는 소유권 검사: 본인 개인 일정이거나, (관리자 && 회사 일정)일 때만.
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

// 일정 추가 — 로그인한 누구나(관리자=회사 일정 / 직원=개인 일정).
export async function addEvent(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const date = String(formData.get("date") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  if (!isRealDate(date)) return { error: "날짜가 올바르지 않습니다." };
  if (!title) return { error: "일정 내용을 입력해주세요." };

  // 관리자 → 회사 일정(userId=null, 전 직원 공용) / 직원 → 개인 일정(userId=본인)
  const userId = me.role === "admin" ? null : me.id;
  await prisma.companyEvent.create({ data: { companyId: me.companyId, userId, date, title, createdBy: me.name } });
  revalidatePath("/schedule");
  return { ok: true };
}

// 일정 삭제 — 소유권 검사: 본인 개인 일정이거나, (관리자 && 회사 일정)일 때만.
export async function deleteEvent(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "삭제 대상이 없습니다." };

  // 회사 격리 + 소유권을 한 번에: 내 개인 일정(userId=me.id) 또는 (관리자면) 회사 일정(userId=null).
  const ownership =
    me.role === "admin"
      ? { OR: [{ userId: me.id }, { userId: null }] } // 관리자: 회사 일정 + 본인 개인
      : { userId: me.id }; // 직원: 본인 개인 일정만
  const res = await prisma.companyEvent.deleteMany({ where: { id, companyId: me.companyId, ...ownership } });
  if (res.count === 0) return { error: "삭제 권한이 없거나 이미 삭제되었습니다." };
  revalidatePath("/schedule");
  return { ok: true };
}
