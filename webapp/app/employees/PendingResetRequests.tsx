"use client";
// 비밀번호 재설정 요청 대기열(관리자) — 직원이 접수한 요청을 보고 "임시 비밀번호 발급"을 누른다.
// 발급하면 임시 비밀번호가 화면에 표시되고, 관리자가 그 값을 직원에게 전달한다.
// (자동 메일 발송·문자 인증은 2차. 지금은 관리자가 직접 전달.)
import { useState, useTransition } from "react";
import { issueTempPassword } from "@/app/actions/password-reset";
import { sendTempPasswordSms } from "@/app/actions/sms";

type Req = { id: string; name: string; email: string; createdAtLabel: string };

export function PendingResetRequests({ requests }: { requests: Req[] }) {
  // 화면에 표시할 목록(로컬 상태). 발급 후에도 임시비번을 계속 보여주려고 로컬에서 관리한다.
  const [list, setList] = useState(requests);
  // 발급 완료된 요청의 임시 비밀번호 { [reqId]: tempPassword }
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 문자 발송 상태 { [reqId]: "sending"|"sent" } + 오류
  const [smsState, setSmsState] = useState<Record<string, "sending" | "sent">>({});
  const [smsErr, setSmsErr] = useState<Record<string, string>>({});

  function handleSendSms(id: string, temp: string) {
    setSmsState((s) => ({ ...s, [id]: "sending" }));
    setSmsErr((e) => ({ ...e, [id]: "" }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("requestId", id);
      fd.set("temp", temp);
      const res = await sendTempPasswordSms({}, fd);
      if (res.error) {
        setSmsState((s) => { const n = { ...s }; delete n[id]; return n; });
        setSmsErr((e) => ({ ...e, [id]: res.error! }));
      } else {
        setSmsState((s) => ({ ...s, [id]: "sent" }));
      }
    });
  }

  function handleIssue(id: string) {
    setPendingId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    startTransition(async () => {
      const res = await issueTempPassword(id);
      setPendingId(null);
      if (res.error) {
        setErrors((e) => ({ ...e, [id]: res.error! }));
        return;
      }
      if (res.tempPassword) setIssued((m) => ({ ...m, [id]: res.tempPassword! }));
    });
  }

  function handleCopy(id: string, pw: string) {
    navigator.clipboard?.writeText(pw);
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
  }

  function dismiss(id: string) {
    setList((l) => l.filter((r) => r.id !== id));
  }

  if (list.length === 0) return null;

  return (
    <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: 24, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
        🔑 비밀번호 재설정 요청 <span style={{ color: "var(--danger)" }}>{list.length}건</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        직원이 비밀번호 찾기를 요청했습니다. <b>임시 비밀번호 발급</b>을 누르면 임시 비밀번호가 만들어집니다.
        그 값을 직원에게 전달하세요. 직원은 임시 비밀번호로 로그인하면 곧바로 새 비밀번호를 정하게 됩니다.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((r) => {
          const tempPw = issued[r.id];
          return (
            <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", marginLeft: 8 }}>{r.email}</span>
                  <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2 }}>요청 {r.createdAtLabel}</div>
                </div>

                {!tempPw && (
                  <button
                    type="button"
                    onClick={() => handleIssue(r.id)}
                    disabled={pendingId === r.id}
                    style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pendingId === r.id ? "default" : "pointer", opacity: pendingId === r.id ? 0.6 : 1, whiteSpace: "nowrap" }}
                  >
                    {pendingId === r.id ? "발급 중..." : "임시 비밀번호 발급"}
                  </button>
                )}
              </div>

              {errors[r.id] && (
                <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>{errors[r.id]}</div>
              )}

              {tempPw && (
                <div style={{ marginTop: 12, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, color: "#166534", fontWeight: 700, marginBottom: 8 }}>
                    임시 비밀번호가 발급되었습니다. 아래 값을 <b>{r.name}</b> 님에게 전달하세요.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, background: "#fff", border: "1px solid #BBF7D0", borderRadius: 8, padding: "8px 14px", color: "#15803D", userSelect: "all" }}>
                      {tempPw}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(r.id, tempPw)}
                      style={{ height: 36, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      {copiedId === r.id ? "복사됨 ✓" : "복사"}
                    </button>
                    {smsState[r.id] === "sent" ? (
                      <span style={{ height: 36, display: "inline-flex", alignItems: "center", padding: "0 14px", border: "1px solid #BBF7D0", borderRadius: 8, background: "#F0FDF4", color: "#15803D", fontSize: 13, fontWeight: 700 }}>
                        문자 발송됨 ✓
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendSms(r.id, tempPw)}
                        disabled={smsState[r.id] === "sending"}
                        style={{ height: 36, padding: "0 14px", border: "1px solid var(--primary)", borderRadius: 8, background: "#fff", color: "var(--primary)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: smsState[r.id] === "sending" ? "default" : "pointer", opacity: smsState[r.id] === "sending" ? 0.6 : 1 }}
                      >
                        {smsState[r.id] === "sending" ? "발송 중..." : "문자로 보내기"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => dismiss(r.id)}
                      style={{ height: 36, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      확인(닫기)
                    </button>
                  </div>
                  {smsErr[r.id] && (
                    <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>{smsErr[r.id]}</div>
                  )}
                  <div style={{ fontSize: 12, color: "#166534", marginTop: 8, lineHeight: 1.6 }}>
                    직원의 기존 로그인은 해제되었습니다. 임시 비밀번호로 로그인하면 새 비밀번호를 정하는 화면으로 이동합니다. <b>문자로 보내기</b>는 직원 전화번호가 등록돼 있어야 하며 1회만 보낼 수 있습니다.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
