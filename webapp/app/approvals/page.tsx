// 결재함 — 로그인한 사용자가 "지금 결재할 차례"인 휴가·근태정정 신청을 모아 승인/반려한다.
// 부서장(직원 신분)도 접근한다. 권한·회사격리는 서버 액션(advanceApproval)이 강제한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { listMyApprovals, type RequestType } from "@/lib/approval-server";
import { approveLeave, rejectLeave } from "@/app/actions/leave";
import { approveCorrection, rejectCorrection } from "@/app/actions/corrections";
import { approveOuting, rejectOuting } from "@/app/actions/outing";
import { approveRemote, rejectRemote } from "@/app/actions/remote";
import { approveOvertime, rejectOvertime } from "@/app/actions/overtime";
import { approveTrip, rejectTrip } from "@/app/actions/trip";
import { RejectButton } from "@/app/components/RejectButton";

// 신청유형별 결재함 표시·액션 매핑(유형 추가 시 여기에만 한 줄 추가).
const TYPE_META: Record<RequestType, { label: string; badgeBg: string; badgeColor: string; approve: (fd: FormData) => Promise<void>; reject: (fd: FormData) => Promise<void> }> = {
  leave: { label: "휴가", badgeBg: "#E4EDFF", badgeColor: "#2563EB", approve: approveLeave, reject: rejectLeave },
  correction: { label: "근태정정", badgeBg: "#FEF3C7", badgeColor: "#B45309", approve: approveCorrection, reject: rejectCorrection },
  outing: { label: "외출/외근", badgeBg: "#DCFCE7", badgeColor: "#15803D", approve: approveOuting, reject: rejectOuting },
  remote: { label: "재택근무", badgeBg: "#EDE9FE", badgeColor: "#7C3AED", approve: approveRemote, reject: rejectRemote },
  overtime: { label: "초과근무", badgeBg: "#FFE4E6", badgeColor: "#BE123C", approve: approveOvertime, reject: rejectOvertime },
  trip: { label: "출장", badgeBg: "#E0F2FE", badgeColor: "#0369A1", approve: approveTrip, reject: rejectTrip },
};

export default async function ApprovalsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const items = await listMyApprovals(me);

  return (
    <AppShell user={me} active="approvals" title="결재함" subtitle={`${me.company.name} · 내 차례 ${items.length}건`}>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>내가 결재할 차례</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          아래 신청들은 <b>지금 내 결재를 기다리는</b> 항목입니다. 승인하면 다음 결재자에게 넘어가고, 마지막 단계에서 최종 확정됩니다.
          <b style={{ color: "var(--primary)" }}>전결</b> 표시가 있으면 상위로 올라가지 않고 <b>내 승인에서 바로 최종 확정</b>됩니다. 반려하면 그 자리에서 신청이 종료됩니다.
        </p>

        {items.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-sub)", fontSize: 14 }}>
            결재할 항목이 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((it) => (
              <div
                key={`${it.type}-${it.requestId}`}
                style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}
              >
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span
                      style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: TYPE_META[it.type].badgeBg, color: TYPE_META[it.type].badgeColor }}
                    >
                      {TYPE_META[it.type].label}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{it.applicantName}</span>
                    {it.applicantNo && <span style={{ fontSize: 12, color: "var(--text-sub)" }}>{it.applicantNo}</span>}
                    <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 700 }}>· {it.stepOrder}/{it.totalSteps}단계</span>
                    {it.isFinal && (
                      <span
                        title="전결권자 단계 — 내가 승인하면 상위로 올라가지 않고 바로 최종 확정됩니다."
                        style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "#EAF2FF", color: "var(--primary)" }}
                      >
                        전결
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text)" }}>{it.summary}</div>
                  {it.detail && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 2 }}>사유: {it.detail}</div>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <form action={TYPE_META[it.type].approve}>
                    <input type="hidden" name="id" value={it.requestId} />
                    <button
                      type="submit"
                      style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      승인
                    </button>
                  </form>
                  <RejectButton action={TYPE_META[it.type].reject} requestId={it.requestId} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
