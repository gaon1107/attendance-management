"use server";
// 사내 공지 작성/삭제 — 관리자만. 모든 직원이 열람만 한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { toISODate } from "@/lib/period";

export async function createNotice(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "제목과 내용을 모두 입력해주세요." };
  if (title.length > 100) return { error: "제목은 100자 이내로 입력해주세요." };
  if (body.length > 5000) return { error: "내용은 5000자 이내로 입력해주세요." };

  // 표시 날짜(선택). 형식뿐 아니라 실제 존재하는 날짜인지까지 확인한다.
  //  · 폼 우회로 "2026-13-40" 같은 무효 날짜가 저장되면 어느 달에도 안 뜨고 배지가 안 사라지는 문제를 막는다.
  //  · 빈값/무효는 null → 작성일(createdAt)에 표시.
  const dateRaw = String(formData.get("date") ?? "").trim();
  let noticeDate: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    const d = new Date(`${dateRaw}T00:00:00`);
    // 롤오버(예: 13월→다음해)나 Invalid Date는 다시 ISO로 만들면 원본과 달라진다 → 그때만 유효로 인정.
    if (!Number.isNaN(d.getTime()) && toISODate(d) === dateRaw) noticeDate = dateRaw;
  }

  await prisma.announcement.create({
    data: { companyId: me.companyId, title, body, authorName: me.name, noticeDate },
  });

  // 공지는 캘린더(작성일 칸)·대시보드 최신공지·출퇴근 배너에도 나타나므로 함께 갱신한다.
  revalidatePath("/notice");
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  revalidatePath("/attendance");
  return { ok: true };
}

// 공지(알림) 모두 읽음 처리 — 현재 사용자의 "확인 시각"을 지금으로 갱신한다.
// 공지 화면을 열면 자동으로 호출되어 "새 알림" 배지를 지운다.
export async function markNoticesSeen(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  await prisma.user.update({ where: { id: me.id }, data: { noticesSeenAt: new Date() } });
  revalidatePath("/attendance");
}

// 공지 삭제 — 관리자만. 반드시 내 회사 공지만(회사 격리).
export async function deleteNotice(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const notice = await prisma.announcement.findFirst({ where: { id, companyId: me.companyId } });
  if (!notice) return;
  await prisma.announcement.delete({ where: { id: notice.id } });
  revalidatePath("/notice");
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  revalidatePath("/attendance");
}
