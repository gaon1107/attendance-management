"use client";
// 개인 결재선 편집(custom 모드) — 신청 종류별로 결재자를 순서대로 골라 저장.
//  · 저장하면 그 종류의 신청은 이 순서대로 자동 결재된다. 최대 5명.
import { useActionState, useState } from "react";
import { saveApprovalLine } from "@/app/actions/approval-line";

export type LineCandidate = { id: string; name: string; employeeNo: string | null; deptName: string | null };

const MAX = 5;

const btn: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", height: 26, width: 26, display: "inline-flex", alignItems: "center", justifyContent: "center" };

export function ApprovalLineEditor({
  requestType,
  typeLabel,
  candidates,
  current,
}: {
  requestType: string;
  typeLabel: string;
  candidates: LineCandidate[];
  current: string[]; // 저장된 결재자 id 순서
}) {
  const [state, formAction, pending] = useActionState(saveApprovalLine, {});
  const [ids, setIds] = useState<string[]>(current);
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name ?? "(퇴사/알수없음)";
  const deptOf = (id: string) => candidates.find((c) => c.id === id)?.deptName ?? null;

  const remaining = candidates.filter((c) => !ids.includes(c.id));

  function add(id: string) {
    if (!id || ids.includes(id) || ids.length >= MAX) return;
    setIds([...ids, id]);
  }
  function removeAt(i: number) { setIds(ids.filter((_, idx) => idx !== i)); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setIds(next);
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>내 {typeLabel} 결재선</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 14, lineHeight: 1.6 }}>
        결재자를 순서대로 정해 저장하면, 이후 {typeLabel} 신청은 <b>이 순서대로 자동 결재</b>됩니다. (최대 {MAX}명, 언제든 수정 가능)
      </p>

      {/* 현재 결재선 */}
      {ids.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", padding: "10px 12px", background: "var(--bg)", borderRadius: 8, marginBottom: 12 }}>
          아직 결재선이 없습니다. 아래에서 결재자를 추가하세요. (미설정 시 신청은 관리자 승인으로 처리됩니다)
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {ids.map((id, i) => (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--primary)", minWidth: 36 }}>{i + 1}차</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>
                {nameOf(id)}
                {deptOf(id) && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400, marginLeft: 6 }}>{deptOf(id)}</span>}
              </span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btn, opacity: i === 0 ? 0.4 : 1 }} aria-label="위로">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === ids.length - 1} style={{ ...btn, opacity: i === ids.length - 1 ? 0.4 : 1 }} aria-label="아래로">↓</button>
              <button type="button" onClick={() => removeAt(i)} style={{ ...btn, color: "var(--danger)", borderColor: "var(--danger)" }} aria-label="제거">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 결재자 추가 */}
      {ids.length < MAX && (
        <select
          value=""
          onChange={(e) => { add(e.target.value); e.target.value = ""; }}
          style={{ width: "100%", height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff", color: "var(--text)", marginBottom: 12 }}
        >
          <option value="">+ 결재자 추가…</option>
          {remaining.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.deptName ? ` · ${c.deptName}` : ""}{c.employeeNo ? ` (${c.employeeNo})` : ""}</option>
          ))}
        </select>
      )}

      {/* 저장 */}
      <form action={formAction} style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <input type="hidden" name="requestType" value={requestType} />
        <input type="hidden" name="approverIds" value={ids.join(",")} />
        <button type="submit" disabled={pending} style={{ height: 40, padding: "0 20px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}>
          {pending ? "저장 중..." : "결재선 저장"}
        </button>
        {state?.error && <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</span>}
        {state?.ok && <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</span>}
      </form>
    </div>
  );
}
