// 사내 공지사항 — 모두 열람(+통합검색). 관리자는 작성/삭제. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { NoticeForm } from "./NoticeForm";
import { MarkNoticesSeen } from "./MarkNoticesSeen";
import { NoticeList, type NoticeRow } from "./NoticeList";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function NoticePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const isAdmin = me.role === "admin";

  const notices = await prisma.announcement.findMany({
    where: { companyId: me.companyId },
    orderBy: { createdAt: "desc" },
  });

  // 마지막으로 확인한 시각 이후 올라온 공지 = "새 알림(NEW)". (확인 시각이 없으면 전부 새 알림)
  const seenAt = me.noticesSeenAt;
  const isNew = (createdAt: Date) => !seenAt || createdAt > seenAt;

  const rows: NoticeRow[] = notices.map((n) => ({
    id: n.id, title: n.title, body: n.body, authorName: n.authorName, dateLabel: ymd(n.createdAt),
    isNew: isNew(n.createdAt), search: [n.title, n.body, n.authorName].join(" ").toLowerCase(),
  }));

  return (
    <AppShell user={me} active="notice" title="공지사항" subtitle={me.company.name}>
      {/* 이 화면을 열면 자동으로 모두 읽음 처리 */}
      <MarkNoticesSeen />
      {/* 관리자는 PC에서 2단(작성 | 목록), 직원은 목록 전체 폭. 좁은 화면은 세로 */}
      <div className={isAdmin ? "split-2" : undefined}>
        {isAdmin && (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>새 공지 작성</div>
            <NoticeForm />
          </div>
        )}

        <div>
          <NoticeList notices={rows} isAdmin={isAdmin} />
        </div>
      </div>
    </AppShell>
  );
}
