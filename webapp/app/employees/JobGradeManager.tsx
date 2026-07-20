"use client";
// 직급(직위) 관리(관리자) — 회사 직급 사다리를 만들고 순서를 정한다. 위(↑)일수록 상급.
//  · 결재선에서 "나보다 높은 직급 = 상급자" 판별에 쓴다(2단계). 여기선 직급 데이터만 관리.
import { useActionState } from "react";
import { createJobGrade, renameJobGrade, moveJobGrade, deleteJobGrade } from "@/app/actions/job-grades";

export type GradeRow = { id: string; name: string; memberCount: number };

const smallBtn: React.CSSProperties = { height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const iconBtn: React.CSSProperties = { width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" };

export function JobGradeManager({ grades }: { grades: GradeRow[] }) {
  // grades는 서열 오름차순(하급→상급)으로 들어온다. 화면엔 상급이 위로 오도록 뒤집어 표시.
  const [state, formAction, pending] = useActionState(createJobGrade, {} as { error?: string; ok?: boolean });
  const top = [...grades].reverse(); // 상급이 위

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>직급 관리</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        회사 직급(직위)을 만들고 <b>순서(서열)</b>를 정합니다. <b>위(↑)일수록 상급</b>입니다. 결재선에서 &ldquo;나보다 높은 직급 = 상급자&rdquo;를 판별할 때 씁니다.
        (직급을 삭제하면 그 직급 직원은 &ldquo;미지정&rdquo;으로 돌아갑니다.)
      </p>

      {/* 직급 추가 */}
      <form action={formAction} style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          name="name"
          type="text"
          placeholder="직급 이름 (예: 대리)"
          maxLength={30}
          style={{ flex: 1, minWidth: 160, height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff", color: "var(--text)" }}
        />
        <button type="submit" disabled={pending} style={{ height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}>
          {pending ? "추가 중..." : "+ 직급 추가"}
        </button>
      </form>
      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: -8, marginBottom: 12 }}>{state.error}</div>}

      {/* 직급 목록(상급이 위) */}
      {top.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", padding: "12px 14px", background: "var(--bg)", borderRadius: 8 }}>
          아직 등록된 직급이 없습니다. 위에서 <b>가장 낮은 직급부터</b> 추가하면 그 위로 쌓입니다. (예: 사원 → 대리 → 과장 → 부장)
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {top.map((g, i) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", flexWrap: "wrap" }}>
              {/* 서열 표시 */}
              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-sub)", minWidth: 44 }}>{top.length - i}순위</span>
              {/* 이름 수정 */}
              <form action={renameJobGrade} style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, minWidth: 180 }}>
                <input type="hidden" name="id" value={g.id} />
                <input
                  name="name"
                  defaultValue={g.name}
                  maxLength={30}
                  style={{ flex: 1, minWidth: 120, height: 32, padding: "0 10px", border: "1px solid #D1D5DB", borderRadius: 6, fontFamily: "inherit", fontSize: 14, fontWeight: 700, background: "#fff", color: "var(--text)" }}
                />
                <button type="submit" style={smallBtn}>저장</button>
              </form>
              <span style={{ fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{g.memberCount}명</span>
              {/* 위/아래 이동 */}
              <form action={moveJobGrade} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="dir" value="up" />
                <button type="submit" disabled={i === 0} style={{ ...iconBtn, opacity: i === 0 ? 0.35 : 1 }} aria-label="상급으로">↑</button>
              </form>
              <form action={moveJobGrade} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="dir" value="down" />
                <button type="submit" disabled={i === top.length - 1} style={{ ...iconBtn, opacity: i === top.length - 1 ? 0.35 : 1 }} aria-label="하급으로">↓</button>
              </form>
              {/* 삭제 */}
              <form action={deleteJobGrade} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={g.id} />
                <button type="submit" style={{ ...smallBtn, color: "var(--danger)", borderColor: "var(--danger)" }}>삭제</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
