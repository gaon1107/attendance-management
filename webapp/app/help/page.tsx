// 도움말 — 고객사 사용 안내서를 바로 열거나 파일로 내려받는 화면. (사장님 지시 2026-11-21)
//
// 왜 대시보드가 아니라 여기인가(사장님 지적):
//  · 대시보드는 "오늘 우리 회사가 어떤지" **매일 보는 화면**이고, 안내서는 **처음 며칠만** 필요하다.
//    매일 보는 화면에 매일 안 쓰는 칸을 두지 않는다. 왼쪽 메뉴는 어느 화면에서나 보이므로 찾기도 쉽다.
//  · 직원에게도 같은 [도움말] 메뉴를 준다 — 단, **직원용 안내서만** 보인다(lib/guide.ts canRead).
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { Icon } from "@/app/components/Icon";
import { listAvailableGuides, formatGuideSize } from "@/lib/guide";

export default async function HelpPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.mustChangePassword) redirect("/change-password");

  // 내 역할이 볼 수 있는 것만, 그중에서도 **파일이 실제로 있는 것만** 돌아온다.
  const guides = await listAvailableGuides(me.role);
  const isAdmin = me.role === "admin";

  return (
    <AppShell user={me} active="help" title="도움말" subtitle={me.company.name}>
      <div
        style={{
          marginBottom: 16, padding: "12px 16px", borderRadius: 10,
          background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF",
          fontSize: 14, lineHeight: 1.6, wordBreak: "keep-all", overflowWrap: "break-word",
        }}
      >
        {isAdmin
          ? "화면을 그대로 따라 할 수 있는 사용 안내서입니다. [열기]를 누르면 새 탭에서 바로 보이고, [내려받기]로 받은 파일은 메일·메신저로 직원에게 그대로 보내실 수 있습니다."
          : "휴대폰으로 출퇴근을 찍고 휴가·정정을 신청하는 방법을 화면 그대로 담았습니다. [열기]를 누르면 바로 보입니다."}
      </div>

      {guides.length === 0 ? (
        <div
          style={{
            background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
            padding: "28px 20px", textAlign: "center", color: "var(--text-sub)",
            fontSize: 14, lineHeight: 1.7, wordBreak: "keep-all",
          }}
        >
          준비된 안내서가 없습니다. 잠시 후 다시 열어 보시고, 계속 보이지 않으면 관리자에게 알려 주세요.
        </div>
      ) : (
        <div className={guides.length > 1 ? "split-2" : ""}>
          {guides.map((g) => (
            <section
              key={g.slug}
              style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px" }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", wordBreak: "keep-all" }}>{g.title}</div>
              <div style={{ fontSize: 14, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.6, wordBreak: "keep-all" }}>
                {g.desc}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <a
                  href={`/api/guide/${g.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${g.title} 새 탭에서 열기`}
                  style={{
                    display: "inline-flex", alignItems: "center", height: 42, padding: "0 20px",
                    borderRadius: 8, background: "var(--primary)", color: "#fff",
                    fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                  }}
                >
                  열기
                </a>
                <a
                  href={`/api/guide/${g.slug}?download=1`}
                  download={g.file}
                  aria-label={`${g.title} 파일로 내려받기`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, height: 42, padding: "0 18px",
                    borderRadius: 8, background: "#fff", border: "1px solid var(--border)", color: "var(--text)",
                    fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
                  }}
                >
                  <Icon name="download" size={15} />내려받기
                </a>
              </div>
              {/* 기준일 = 안내서를 만든 날. 화면이 바뀌었는데 안내서가 옛것이면 여기서 드러난다. */}
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 14, fontVariantNumeric: "tabular-nums" }}>
                {`기준일 ${g.updatedAt.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })} · ${formatGuideSize(g.bytes)}`}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
