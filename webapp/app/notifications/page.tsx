// 관리자 알림 센터(C-2) — 처리가 필요한 항목(승인대기 휴가·근태정정·비번재설정·이상접속)을 한 화면에 모은다.
// 실시간 카운트(읽음 저장 없음): 처리하면 다음 방문에서 자동으로 줄어든다. 데이터는 lib/notifications 공용 함수가 계산.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { listAdminNotifications } from "@/lib/notifications";

const SEV_COLOR: Record<string, string> = {
  danger: "var(--danger)",
  warning: "var(--warning)",
  primary: "var(--primary)",
};

export default async function NotificationsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const { items, total } = await listAdminNotifications(me.companyId);

  return (
    <AppShell user={me} active="notifications" title="알림 센터" subtitle={me.company.name}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>처리 필요</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: total > 0 ? "var(--danger)" : "var(--text-sub)" }}>{total}건</span>
        </div>

        {items.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "44px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>처리할 알림이 없습니다 🎉</div>
            <div style={{ fontSize: 13, color: "var(--text-sub)" }}>승인 대기·요청·보안 이상이 모두 처리된 상태입니다.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                style={{ display: "flex", alignItems: "center", gap: 14, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", textDecoration: "none", color: "var(--text)" }}
              >
                {/* 좌측 세로 색막대(심각도) */}
                <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: SEV_COLOR[it.severity] ?? "var(--primary)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{it.title}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: SEV_COLOR[it.severity] ?? "var(--primary)" }}>{it.countLabel}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 3 }}>{it.detail}</div>
                </div>
                <span style={{ flexShrink: 0, height: 34, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {it.cta}
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* 오늘 근태(미출근·지각·조퇴·주 52시간)는 대시보드에서 봅니다 — 중복 계산·발산 방지. */}
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 18, lineHeight: 1.6 }}>
          오늘 미출근·지각·조퇴, 주 52시간 초과근무 등 근태 현황은{" "}
          <Link href="/dashboard" style={{ color: "var(--primary)", fontWeight: 700 }}>대시보드</Link>에서 확인할 수 있어요.
        </div>
      </div>
    </AppShell>
  );
}
