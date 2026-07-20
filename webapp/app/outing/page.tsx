// 외출/외근(직원 본인) — 신청 폼 + 내 신청 내역. (휴가 화면과 같은 형식)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PaginatedTable } from "@/app/components/PaginatedTable";
import { OutingRequestForm } from "./OutingRequestForm";
import { cancelOuting } from "@/app/actions/outing";
import { outingKindLabel, outingStatusLabel } from "@/lib/outing";
import { getApprovalProgressMap, type ApprovalProgress, listApprovalCandidates, resolveCustomApprovers } from "@/lib/approval-server";
import { getAttachmentsMap } from "@/lib/request-attachment-server";
import { AttachmentLinks } from "@/app/components/AttachmentLinks";
import { ApprovalLineEditor } from "@/app/components/ApprovalLineEditor";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  pending: { bg: "#FEF3C7", dot: "#B45309", color: "#B45309" },
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export default async function OutingPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const requests = await prisma.outingRequest.findMany({
    where: { userId: me.id, companyId: me.companyId },
    orderBy: { createdAt: "desc" },
  });

  // 부서장 결재선을 켠 회사면, 대기 중인 신청의 결재 진행상황을 함께 표시.
  const progressMap: Map<string, ApprovalProgress> =
    (me.company.approvalMode === "deptline" || me.company.approvalMode === "custom")
      ? await getApprovalProgressMap(me.companyId, "outing", requests.filter((r) => r.status === "pending").map((r) => r.id))
      : new Map();

  // 첨부파일(전체 신청분) — 다운로드 링크 표시용.
  const attMap = await getAttachmentsMap(me.companyId, "outing", requests.map((r) => r.id));

  // custom(상신자 지정) 모드면 "내 결재선 설정" 노출.
  const isCustom = me.company.approvalMode === "custom";
  const candidates = isCustom ? await listApprovalCandidates(me.companyId, me.id) : [];
  const currentLine = isCustom ? await resolveCustomApprovers(me.companyId, me.id, "outing") : [];

  // 처리(승인/반려)된 신청의 처리자 이름 — 결정사유와 함께 "누가" 표시. (한 번에 조회)
  const deciderIds = [...new Set(requests.map((r) => r.decidedById).filter((v): v is string => !!v))];
  const deciderName = new Map<string, string>(
    deciderIds.length
      ? (await prisma.user.findMany({ where: { companyId: me.companyId, id: { in: deciderIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : []
  );

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle" };

  return (
    <AppShell user={me} active="outing" title="외출/외근" subtitle={`${me.name} 님`}>
      {isCustom && <ApprovalLineEditor requestType="outing" typeLabel="외출/외근" candidates={candidates} current={currentLine} />}
      {/* PC=2단(신청 폼 | 내역), 좁은 화면=세로 */}
      <div className="split-2">
      {/* 신청 폼 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>외출/외근 신청</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 18, lineHeight: 1.6 }}>
          업무 외근·개인 외출을 미리 신청해 승인받는 기능입니다. 승인은 <b>사전 허가 기록</b>으로 남으며, 출퇴근·실근무 계산은 기존 방식(실시간 외출·출근 선택) 그대로입니다.
        </p>
        <OutingRequestForm />
      </div>

      {/* 내 신청 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700 }}>내 신청 내역</div>
        <PaginatedTable
          minWidth={560}
          colSpan={6}
          emptyText="아직 신청한 외출/외근이 없습니다."
          head={
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>종류</th>
                <th style={th}>날짜</th>
                <th style={th}>시간</th>
                <th style={th}>행선지</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: "right" }}></th>
              </tr>
            </thead>
          }
          rows={requests.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontWeight: 700 }}>{outingKindLabel(r.kind)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{ymd(r.targetDate)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.startTime}~{r.endTime}</td>
                      <td style={{ ...td, color: "var(--text-sub)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.place || "—"}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{outingStatusLabel(r.status)}</span>
                        </span>
                        {(() => {
                          const p = progressMap.get(r.id);
                          if (!p) return null;
                          if (p.rejected) return <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4, fontWeight: 700 }}>부서장 반려 처리 중</div>;
                          return (
                            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4 }}>
                              결재 {p.approvedCount}/{p.total} 승인
                              {p.nextApproverName && <span> · 다음: <b>{p.nextApproverName}</b>{p.nextIsFinal && <span style={{ color: "var(--primary)", fontWeight: 700 }}> (전결)</span>}</span>}
                            </div>
                          );
                        })()}
                        {r.status !== "pending" && r.decisionComment && (
                          <div style={{ fontSize: 12, color: r.status === "rejected" ? "var(--danger)" : "var(--text-sub)", marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {r.status === "rejected" ? "반려 사유" : "승인 메모"}: {r.decisionComment}
                            {r.decidedById && deciderName.get(r.decidedById) && <span style={{ color: "var(--text-sub)" }}> · {deciderName.get(r.decidedById)}</span>}
                            {r.decidedAt && <span style={{ color: "var(--text-sub)" }}> · {ymd(r.decidedAt)}</span>}
                          </div>
                        )}
                        <AttachmentLinks items={attMap.get(r.id) ?? []} canDelete={r.status === "pending"} />
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {r.status === "pending" && (
                          <form action={cancelOuting}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" style={{ height: 30, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                              취소
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
        />
      </section>
      </div>
    </AppShell>
  );
}
