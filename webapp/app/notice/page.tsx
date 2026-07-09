// 사내 공지사항 — 모두 열람. 관리자는 작성/삭제. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { NoticeForm } from "./NoticeForm";
import { MarkNoticesSeen } from "./MarkNoticesSeen";
import { deleteNotice } from "@/app/actions/notice";

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
      {notices.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "40px 20px", textAlign: "center", fontSize: 14, color: "var(--text-sub)" }}>
          아직 등록된 공지가 없습니다.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notices.map((n) => (
            <article key={n.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>
                  {isNew(n.createdAt) && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "var(--danger)", borderRadius: 5, padding: "2px 6px", marginRight: 8, verticalAlign: "middle" }}>NEW</span>
                  )}
                  {n.title}
                </div>
                {isAdmin && (
                  <form action={deleteNotice}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                      삭제
                    </button>
                  </form>
                )}
              </div>
              <div style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{n.body}</div>
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12 }}>
                {n.authorName} · {ymd(n.createdAt)}
              </div>
            </article>
          ))}
        </div>
      )}
      </div>
      </div>
    </AppShell>
  );
}
