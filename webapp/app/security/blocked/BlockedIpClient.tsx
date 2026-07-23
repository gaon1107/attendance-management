"use client";
// 차단 IP 관리(관리자) — 추가 폼 + 현재 명단 + 차단 후보.
//  · 권한·회사격리·검증은 서버(page.tsx / actions/ip-block.ts)가 책임. 여기선 입력·표시만.
//  · 폼이 넓어 어색하지 않도록 .split-2 2단 배치(디자인룰 §2).
import { useActionState, useState } from "react";
import { addBlockedIp, removeBlockedIp } from "@/app/actions/ip-block";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";

export type BlockedRow = {
  id: string;
  pattern: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  ineffective: boolean; // 사내망과 겹쳐 실제로는 효력이 없는 규칙
};

export type CandidateRow = {
  ip: string;
  count: number;
  last: string;
  isMine: boolean;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle" };
const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", marginBottom: 6 };
const input: React.CSSProperties = { width: "100%", height: 40, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, background: "#fff" };

export function BlockedIpClient({
  rows,
  candidates,
  myIp,
  hasOfficeIps,
  candidateDays,
}: {
  rows: BlockedRow[];
  candidates: CandidateRow[];
  myIp: string;
  hasOfficeIps: boolean;
  candidateDays: number;
}) {
  const [state, formAction, pending] = useActionState(addBlockedIp, {});
  // 후보 [차단] 클릭 시 폼에 채워 넣기 위한 제어 상태
  const [pattern, setPattern] = useState("");
  const [reason, setReason] = useState("");
  // 후보·차단명단 표 각각 페이징(검색 없음 — 길면 페이지로만 나눔).
  const pgC = usePagination(candidates, { initialSize: 100 });
  const pgB = usePagination(rows, { initialSize: 100 });

  // 저장에 성공하면 입력칸을 비운다 — 안 비우면 성공 후 [차단 추가]를 다시 눌렀을 때
  // 같은 값이 남아 있어 "이미 차단 목록에 있는 IP" 에러가 뜬다.
  //  · effect 대신 "이전 결과와 비교"해 렌더 중 리셋(연쇄 렌더 회피 — usePagination과 같은 패턴).
  //  · 실패(state.error)면 비우지 않는다 — 사용자가 값을 고쳐서 다시 낼 수 있게.
  //  ⚠️ 이 비교는 addBlockedIp가 호출마다 "새 객체"를 반환한다는 전제 위에 있다(상수 객체 재사용 금지).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.ok) {
      setPattern("");
      setReason("");
    }
  }

  return (
    <div>
      {/* 안내 — 이 기능의 위험과 안전장치를 먼저 알린다 */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.7 }}>
        명단에 올린 IP는 <b>로그인이 거부</b>됩니다. 차단은 <b>[해제]를 누를 때까지 유지</b>되며 저절로 풀리지 않습니다.
        <br />
        🛡️ 안전장치: <b>사내 네트워크(허용 IP)는 무엇을 넣든 절대 차단되지 않습니다.</b> 또 <b>지금 접속 중인 관리자 IP({myIp})</b>를 포함하는 규칙은 저장이 거부됩니다.
        {!hasOfficeIps && (
          <>
            <br />
            <b style={{ color: "var(--warning)" }}>⚠️ 회사 허용 IP가 등록돼 있지 않습니다</b> — [설정 → 사내 네트워크]에 사무실 IP를 먼저 등록하면 더 안전합니다.
          </>
        )}
      </div>

      <div className="split-2">
        {/* 왼쪽: 추가 폼 */}
        <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>차단 IP 추가</h2>
          <form action={formAction}>
            <div style={{ marginBottom: 14 }}>
              <label style={label} htmlFor="pattern">IP 또는 대역</label>
              <input
                id="pattern"
                name="pattern"
                style={input}
                placeholder="예: 1.2.3.4 (한 대) 또는 1.2.3 (1.2.3.* 전체)"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.6 }}>
                뒷자리를 빼면 그 대역 전체가 막힙니다. <b>넓게 막을수록 애먼 사람이 막힐 수 있으니</b> 되도록 정확한 IP를 쓰세요.
                {pattern.includes(":") && (
                  <>
                    <br />
                    <b style={{ color: "var(--warning)" }}>⚠️ IPv6는 이 주소와 정확히 같을 때만 막힙니다</b>(대역 차단 불가). IPv6는 주소가 자주 바뀌어 차단 효과가 낮습니다.
                  </>
                )}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={label} htmlFor="reason">사유 (선택)</label>
              <input
                id="reason"
                name="reason"
                style={input}
                placeholder="예: 심야에 비밀번호 반복 시도"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {state.error && (
              <div style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 8, marginBottom: 12, lineHeight: 1.5 }}>
                {state.error}
              </div>
            )}
            {state.ok && (
              <div style={{ background: "#DCFCE7", color: "#15803D", fontSize: 13, fontWeight: 700, padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>
                차단 목록에 추가했습니다.
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              style={{ height: 40, padding: "0 18px", borderRadius: 8, border: "none", background: "var(--danger)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
            >
              {pending ? "추가 중…" : "차단 추가"}
            </button>
          </form>
        </section>

        {/* 오른쪽: 차단 후보 */}
        <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>차단 후보 <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-sub)" }}>· 최근 {candidateDays}일</span></h2>
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.6 }}>
              로그인 실패가 잦은 IP입니다. <b>자동으로 막지 않습니다</b> — 확인 후 직접 결정하세요.
              사내망·이미 차단된 IP는 목록에서 빠집니다.
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 380 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>IP</th>
                  <th style={th}>실패</th>
                  <th style={th}>마지막</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {pgC.view.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "24px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                      수상한 IP가 없습니다.
                    </td>
                  </tr>
                ) : (
                  pgC.view.map((c) => (
                    <tr key={c.ip} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                        {c.ip}
                        {c.isMine && <span style={{ fontSize: 12, color: "var(--text-sub)", marginLeft: 6 }}>(내 IP)</span>}
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: "var(--danger)", fontVariantNumeric: "tabular-nums" }}>{c.count}회</td>
                      <td style={{ ...td, fontSize: 13, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{c.last}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {/* 내 IP는 채우기 자체를 막는다(자기잠금 방어 — 서버도 한 번 더 막음) */}
                        {c.isMine ? (
                          <span style={{ fontSize: 12, color: "var(--text-sub)" }}>차단 불가</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setPattern(c.ip);
                              setReason(`최근 ${candidateDays}일 로그인 실패 ${c.count}회`);
                            }}
                            style={{ height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                          >
                            폼에 채우기
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination pg={pgC} />
        </section>
      </div>

      {/* 아래: 현재 차단 명단 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginTop: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>차단 중인 IP <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-sub)" }}>· {rows.length}건</span></h2>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>IP / 대역</th>
                <th style={th}>사유</th>
                <th style={th}>등록자</th>
                <th style={th}>등록일</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {pgB.view.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    차단 중인 IP가 없습니다.
                  </td>
                </tr>
              ) : (
                pgB.view.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {r.pattern}
                      {r.ineffective && (
                        <div style={{ fontSize: 12, fontWeight: 400, color: "var(--warning)" }}>
                          사내망과 겹쳐 실제로는 차단되지 않습니다(사내망이 항상 우선)
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{r.reason || "—"}</td>
                    <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{r.createdBy}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontSize: 13, whiteSpace: "nowrap" }}>{r.createdAt}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <form action={removeBlockedIp} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          해제
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination pg={pgB} />
      </section>
    </div>
  );
}
