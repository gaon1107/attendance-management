"use client";
// [PC관리] 직원 대신 연결코드 발급(2026-11-20 사장님 요청) — 관리자가 직원 PC를 직접 설치할 때 쓴다.
//  · 직원 본인 발급([계정 → 내 PC 연결])과 같은 코드 규칙(6자리·5분·1회용, 사람당 살아있는 코드 1개).
//  · 서버(adminIssuePairCode)가 관리자·회사 격리·재직 중·사람 계정을 다시 확인하고 감사기록을 남긴다.
import { useState } from "react";
import { adminIssuePairCode } from "@/app/actions/pcoff";

type Emp = { id: string; name: string; email: string };

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function AdminPairCodeCard({ employees }: { employees: Emp[] }) {
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string | null; name: string } | null>(null);

  async function onIssue() {
    if (!userId || pending) return;
    setPending(true);
    setError(null);
    setIssued(null);
    try {
      const r = await adminIssuePairCode(userId);
      if (r.error || !r.code) setError(r.error ?? "발급하지 못했습니다. 다시 시도해 주세요.");
      else setIssued({ code: r.code, expiresAt: r.expiresAt ?? null, name: r.userName ?? "" });
    } catch {
      setError("발급하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>직원 대신 연결코드 발급</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 12px", lineHeight: 1.6, wordBreak: "keep-all" }}>
        관리자가 직원 PC에 직접 설치할 때 씁니다. 직원을 고르고 발급하면 나오는 6자리를 그 직원 PC의 PC-OFF 연결 창에 넣으세요.
        직원이 근태 앱 [계정 → 내 PC 연결]에서 직접 받아도 됩니다. 발급한 기록은 접속기록에 남습니다.
      </p>
      {employees.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 10 }}>
          연결할 직원이 없습니다. [직원관리]에서 먼저 직원을 등록해 주세요.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={userId}
          onChange={(e) => { setUserId(e.target.value); setIssued(null); setError(null); }}
          // 발급 중에는 바꾸지 못하게 — 바꾸면 늦게 온 앞 사람 코드가 새로 고른 사람 옆에 표시돼 헷갈린다(검수 경미 1)
          disabled={pending || employees.length === 0}
          aria-label="연결할 직원"
          style={{ flex: "1 1 220px", minWidth: 0, height: 40, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", fontFamily: "inherit", fontSize: 14 }}
        >
          <option value="">직원 선택</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name} ({e.email})</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onIssue}
          disabled={!userId || pending}
          style={{ height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: !userId || pending ? "default" : "pointer", opacity: !userId || pending ? 0.6 : 1, whiteSpace: "nowrap" }}
        >
          {pending ? "발급 중..." : "연결코드 발급"}
        </button>
      </div>

      {error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 10, wordBreak: "keep-all" }}>{error}</div>}

      {issued && (
        <div style={{ background: "#F9FAFB", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 6 }}>{issued.name} 님 PC 연결코드</div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{issued.code}</div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, lineHeight: 1.5, wordBreak: "keep-all" }}>
            {issued.expiresAt ? `${hhmm(issued.expiresAt)}까지 유효` : "5분간 유효"}합니다. 한 번만 쓸 수 있고, 새로 발급하면(직원이 직접 받은 것 포함) 이전 코드는 쓸 수 없습니다.
          </div>
        </div>
      )}
    </div>
  );
}
