"use client";
// 초대 링크 표시 + 복사 + 문자 발송(A-2). 전체 URL(도메인 포함)은 브라우저에서 만든다(어디에 배포되든 맞게).
//  · 링크 복사는 무료(관리자가 직접 전달). "문자로 보내기"는 유료 발송 — 번호 입력 후 버튼, 초대 1건당 1회.
import { useEffect, useRef, useState, useTransition } from "react";
import { sendInviteSms } from "@/app/actions/sms";

export function InviteLink({ path, inviteId, smsSent }: { path: string; inviteId: string; smsSent?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(!!smsSent);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [, startTransition] = useTransition();

  // 브라우저에서 전체 URL을 만들어 입력칸에 직접 반영(비제어 input — 하이드레이션 불일치 없음).
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = window.location.origin + path;
  }, [path]);

  function fullUrl() {
    return typeof window !== "undefined" ? window.location.origin + path : path;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function sendSms() {
    setSending(true);
    setErr("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("inviteId", inviteId);
      fd.set("url", fullUrl());
      fd.set("phone", phone);
      const res = await sendInviteSms({}, fd);
      setSending(false);
      if (res.error) setErr(res.error);
      else setSent(true);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          readOnly
          defaultValue={path}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", fontFamily: "inherit", fontSize: 13, color: "var(--text-sub)" }}
        />
        <button
          type="button"
          onClick={copy}
          style={{ height: 38, padding: "0 14px", border: "1px solid var(--primary)", borderRadius: 8, background: copied ? "var(--primary)" : "#fff", color: copied ? "#fff" : "var(--primary)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {copied ? "복사됨 ✓" : "복사"}
        </button>
      </div>

      {/* 문자 발송(선택) — 초대 1건당 1회 */}
      {sent ? (
        <div style={{ fontSize: 12, color: "#15803D", fontWeight: 700 }}>문자 발송됨 ✓ (초대당 1회)</div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="받는 사람 휴대폰 번호 (예: 010-1234-5678)"
            style={{ flex: 1, minWidth: 0, height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "inherit", fontSize: 13 }}
          />
          <button
            type="button"
            onClick={sendSms}
            disabled={sending || phone.replace(/[^0-9]/g, "").length < 9}
            style={{ height: 36, padding: "0 14px", border: "1px solid var(--primary)", borderRadius: 8, background: "#fff", color: "var(--primary)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: sending ? "default" : "pointer", opacity: sending || phone.replace(/[^0-9]/g, "").length < 9 ? 0.5 : 1, whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {sending ? "발송 중..." : "문자로 보내기"}
          </button>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700 }}>{err}</div>}
    </div>
  );
}
