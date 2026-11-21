"use client";
// 메시지 발송(관리자) — 왼쪽 받는 사람 고르기 / 오른쪽 내용 쓰기 → 확인 후 발송.
//  · 권한·회사격리·상한·최종 글자 검사는 서버 액션이 책임진다. 여기 계산은 **미리 알려주기**다.
//  · 🔴 요금이 나가는 화면이라 [보내기]는 **확인 창을 한 번 거친다**(몇 명에게 가는지 숫자로 보여 준다).
import { useActionState, useMemo, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import { sendDirectSms } from "@/app/actions/sms-send";
import {
  TEMPLATE_VARS,
  SMS_SHORT_MAX_BYTES,
  SMS_LONG_MAX_BYTES,
  countSmsBytes,
  findUnsupportedPreview,
  findUnknownVars,
  normalizeTemplateText,
  renderTemplate,
} from "@/lib/sms-templates";

export type Recipient = {
  id: string;
  name: string;
  employeeNo: string | null;
  department: string;
  canReceive: boolean;
};
export type PickTemplate = { id: string; name: string; body: string; isDefault: boolean };

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 24,
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  color: "var(--text)",
  outline: "none",
};

export function SendClient({
  recipients,
  templates,
  companyName,
  smsReady,
  maxRecipients,
}: {
  recipients: Recipient[];
  templates: PickTemplate[];
  companyName: string;
  smsReady: boolean;
  maxRecipients: number;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string>("전체");
  const [body, setBody] = useState("");
  const [content, setContent] = useState("");
  const [confirm, setConfirm] = useState(false);
  // 🔑 묶음 번호는 **서버가** "오늘 날짜 + 문구 + 내용"으로 만든다(app/actions/sms-send.ts 머리말 ①).
  //    화면이 들고 있으면 체크를 바꾸거나 새로고침할 때마다 새 번호가 되어 이미 받은 분에게 또 나갔다
  //    (2026-11-22 검수 치명 1 → 재검수 치명 C-1). 여기서는 **일부러 다시 보낼 때만** 일회용 번호를 만든다.
  const [resendAll, setResendAll] = useState(false);
  const [resendNonce, setResendNonce] = useState("");

  const [state, action, pending] = useActionState(sendDirectSms, {});

  const departments = useMemo(() => ["전체", ...[...new Set(recipients.map((r) => r.department))].sort()], [recipients]);

  const shown = useMemo(() => {
    const terms = queryTerms(q);
    return recipients.filter((r) => {
      if (dept !== "전체" && r.department !== dept) return false;
      if (!terms.length) return true;
      return matchesTerms(`${r.name} ${r.employeeNo ?? ""} ${r.department}`.toLowerCase(), terms);
    });
  }, [recipients, q, dept]);

  const pickedList = useMemo(() => recipients.filter((r) => picked.has(r.id)), [recipients, picked]);
  const sample = pickedList[0] ?? recipients.find((r) => r.canReceive) ?? recipients[0];

  // 미리보기 — 고른 사람 중 첫 번째를 기준으로 자리를 채운다(실제로는 사람마다 이름이 바뀐다).
  const preview = useMemo(
    () =>
      renderTemplate(body, {
        직원명: sample?.name ?? "홍길동",
        회사명: companyName,
        날짜: todayLabel(),
        내용: content,
      }),
    [body, content, companyName, sample],
  );
  // 🟡 [검수 중간 6] [직원명]이 들어가면 이름 길이만큼 사람마다 바이트가 다르다 → **고른 사람 전원**을 넣어 보고 판정한다.
  //  첫 사람 기준으로만 보면 "단문"이라 해 놓고 이름이 긴 사람은 장문(요금 약 3배)으로 나간다.
  const perPersonBytes = useMemo(() => {
    const list = pickedList.length > 0 ? pickedList : sample ? [sample] : [];
    const today = todayLabel();
    // 서버는 이름을 합친 형태(NFC)로 바꿔 보낸다 — 화면도 같은 기준으로 센다.
    return list.map((r) =>
      countSmsBytes(renderTemplate(body, { 직원명: normalizeTemplateText(r.name), 회사명: companyName, 날짜: today, 내용: content })),
    );
  }, [pickedList, sample, body, content, companyName]);
  const bytes = perPersonBytes.length ? Math.max(...perPersonBytes) : countSmsBytes(preview);
  const longCount = perPersonBytes.filter((b) => b > SMS_SHORT_MAX_BYTES).length;
  const mixed = longCount > 0 && longCount < perPersonBytes.length;
  const isShort = bytes <= SMS_SHORT_MAX_BYTES;
  const tooLong = bytes > SMS_LONG_MAX_BYTES;
  const bad = useMemo(() => findUnsupportedPreview(preview), [preview]);
  const unknownVars = useMemo(() => findUnknownVars(body), [body]);
  const needsContent = body.includes("[내용]");

  const overMax = picked.size > maxRecipients;
  const canSend =
    smsReady && picked.size > 0 && !overMax && body.trim() !== "" && !tooLong && bad.length === 0 && !(needsContent && content.trim() === "");

  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  /** 지금 목록에 보이는 사람 중 문자를 받을 수 있는 사람을 모두 고른다(상한을 넘지 않게 자른다). */
  function pickAllShown() {
    setPicked((p) => {
      const next = new Set(p);
      for (const r of shown) {
        if (!r.canReceive) continue;
        if (next.size >= maxRecipients && !next.has(r.id)) break;
        next.add(r.id);
      }
      return next;
    });
  }
  function clearPicked() {
    setPicked(new Set());
  }

  const justSent = state.ok === true;

  return (
    <div>
      {!smsReady && (
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 10,
            padding: "13px 15px",
            fontSize: 13,
            color: "#92400E",
            lineHeight: 1.6,
            marginBottom: 16,
            wordBreak: "keep-all",
          }}
        >
          아직 <b>우리 회사 문자 계정</b>이 연결되지 않아 문자를 보낼 수 없습니다. <b>[설정 → 문자·알림톡]</b>에서 비즈모아샷
          계정을 먼저 연결해 주세요. (문자 요금은 그 계정에서 나갑니다)
        </div>
      )}

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        고른 직원에게 문자를 보냅니다. 한 번에 <b>{maxRecipients}명</b>까지 보낼 수 있고, 요금은 우리 회사 비즈모아샷 계정에서
        나갑니다. 휴대폰 번호가 없는 직원은 고를 수 없습니다. <b>업무 안내용으로만</b> 써 주세요(광고·홍보 문자는 법으로
        정한 표시 의무가 따로 있습니다).
      </div>

      <div className="split-2">
        {/* ── 왼쪽: 받는 사람 ─────────────────────────────────────────── */}
        <section style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            받는 사람{" "}
            <span style={{ color: overMax ? "var(--danger)" : "var(--primary)" }}>
              {picked.size}명
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 14 }}>
            {overMax ? `한 번에 ${maxRecipients}명까지만 보낼 수 있습니다.` : `재직 중인 직원 ${recipients.length}명`}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <select value={dept} onChange={(e) => setDept(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 140 }}>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div style={{ flex: "1 1 180px", minWidth: 160 }}>
              <SearchBox value={q} onChange={setQ} placeholder="이름·사번 검색" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              onClick={pickAllShown}
              style={{ height: 32, padding: "0 11px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              보이는 사람 모두 고르기
            </button>
            <button
              type="button"
              onClick={clearPicked}
              style={{ height: 32, padding: "0 11px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              선택 해제
            </button>
          </div>

          <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            {shown.length === 0 ? (
              <div style={{ padding: "22px 14px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                조건에 맞는 직원이 없습니다.
              </div>
            ) : (
              shown.map((r) => (
                <label
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: "1px solid #F3F4F6",
                    cursor: r.canReceive ? "pointer" : "default",
                    opacity: r.canReceive ? 1 : 0.55,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    disabled={!r.canReceive}
                    onChange={() => toggle(r.id)}
                    style={{ width: 17, height: 17, cursor: r.canReceive ? "pointer" : "default" }}
                  />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.department}</span>
                  {!r.canReceive && (
                    <span style={{ fontSize: 12, color: "var(--danger)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                      휴대폰 번호 없음
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </section>

        {/* ── 오른쪽: 내용 ────────────────────────────────────────────── */}
        <section style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>보낼 내용</div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle} htmlFor="tpl-pick">템플릿에서 가져오기</label>
            <select
              id="tpl-pick"
              defaultValue=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) {
                  setBody(t.body);
                  // 다른 템플릿의 [내용] 값이 남아 함께 가지 않게 비운다(서버도 [내용] 자리가 없으면 버린다).
                  setContent("");
                }
              }}
              style={inputStyle}
            >
              <option value="">직접 입력</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? " (기본)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle} htmlFor="send-body">문구</label>
            <textarea
              id="send-body"
              rows={5}
              placeholder="예시) [회사명] 내일 전체 회의가 있습니다."
              style={{ ...inputStyle, height: "auto", padding: "12px 14px", lineHeight: 1.7, resize: "vertical" }}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {TEMPLATE_VARS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => {
                    setBody((b) => b + v.key);
                  }}
                  title={v.desc}
                  style={{ height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>

          {needsContent && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle} htmlFor="send-content">[내용]에 넣을 글</label>
              <input
                id="send-content"
                type="text"
                placeholder="예시) 내일 오전 10시 대회의실"
                style={inputStyle}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                }}
              />
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 24,
                padding: "0 9px",
                borderRadius: 6,
                background: isShort ? "#DCFCE7" : "#FEF3C7",
                fontSize: 12,
                fontWeight: 700,
                color: isShort ? "#15803D" : "#B45309",
              }}
            >
              {isShort ? "단문" : "장문"}
            </span>
            <span style={{ fontSize: 12, color: tooLong ? "var(--danger)" : "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
              {bytes} / {isShort ? SMS_SHORT_MAX_BYTES : SMS_LONG_MAX_BYTES}바이트
            </span>
            <span style={{ fontSize: 12, color: mixed ? "#B45309" : "var(--text-sub)", fontWeight: mixed ? 700 : 400, wordBreak: "keep-all" }}>
              {mixed
                ? `고른 ${perPersonBytes.length}명 중 ${longCount}명은 이름이 길어 장문으로 나갑니다(요금이 더 듭니다)`
                : "(장문은 요금이 더 듭니다 · 고른 사람 중 가장 긴 문자 기준)"}
            </span>
          </div>

          {bad.length > 0 && (
            <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 10, wordBreak: "keep-all" }}>
              문자로 보낼 수 없는 글자가 있습니다: {bad.join(" ")} — 이모지는 받는 분 휴대폰에서 깨집니다.
            </div>
          )}
          {unknownVars.length > 0 && (
            <div style={{ fontSize: 13, color: "#B45309", fontWeight: 700, marginBottom: 10, wordBreak: "keep-all" }}>
              이 자리는 바뀌지 않고 <b>적은 그대로 나갑니다</b>: {unknownVars.join(" ")}
            </div>
          )}

          {body.trim() !== "" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>
                이렇게 나갑니다{sample ? ` (${sample.name}님 기준)` : ""}
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 14,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  wordBreak: "keep-all",
                }}
              >
                {preview}
              </div>
            </div>
          )}

          {state.error && (
            <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 12, wordBreak: "keep-all" }}>{state.error}</div>
          )}
          {justSent && state.message && (
            <div
              style={{
                fontSize: 13,
                color: (state.failed ?? 0) > 0 || (state.notSent ?? 0) > 0 || (state.unknown ?? 0) > 0 ? "#B45309" : "#15803D",
                fontWeight: 700,
                marginBottom: 12,
                lineHeight: 1.6,
                wordBreak: "keep-all",
              }}
            >
              {state.message}
            </div>
          )}

          <button
            type="button"
            onClick={() => setConfirm(true)}
            disabled={!canSend || pending}
            style={{
              width: "100%",
              height: 48,
              border: "none",
              borderRadius: 10,
              background: "var(--primary)",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 700,
              cursor: !canSend || pending ? "default" : "pointer",
              opacity: !canSend || pending ? 0.6 : 1,
            }}
          >
            {pending ? "보내는 중..." : `${picked.size}명에게 문자 보내기`}
          </button>
        </section>
      </div>

      {/* 보내기 확인 — 돈이 나가는 동작이라 한 번 더 묻는다(디자인 규칙 §5.7 공용 Modal) */}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="문자 보내기" maxWidth={440}>
        <div style={{ fontSize: 14, lineHeight: 1.8, wordBreak: "keep-all" }}>
          <b>{picked.size}명</b>에게 문자를 보냅니다
          {mixed ? ` (그중 ${longCount}명은 장문)` : isShort ? " (단문)" : " (장문)"}. 요금은 우리 회사 비즈모아샷 계정에서
          나갑니다. <b>보낸 문자는 취소할 수 없습니다.</b>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13,
              color: "var(--text-sub)",
              lineHeight: 1.6,
              marginTop: 12,
            }}
          >
            오늘 이 문자를 이미 받은 분은 <b>자동으로 건너뜁니다</b>(같은 문자가 두 번 나가지 않습니다).
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                cursor: "pointer",
                fontWeight: 700,
                color: resendAll ? "#B45309" : "var(--text)",
              }}
            >
              <input
                type="checkbox"
                checked={resendAll}
                onChange={(e) => {
                  setResendAll(e.target.checked);
                  // 체크할 때마다 새 일회용 번호 — 같은 번호로 두 번 보내면 서버가 또 막는다.
                  if (e.target.checked) setResendNonce(newResendNonce());
                }}
                style={{ width: 16, height: 16 }}
              />
              이미 받은 분에게도 한 번 더 보냅니다(요금이 다시 나갑니다)
            </label>
          </div>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "11px 13px",
              fontSize: 13,
              lineHeight: 1.7,
              marginTop: 12,
              whiteSpace: "pre-wrap",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {preview}
          </div>
        </div>
        <form
          action={action}
          onSubmit={() => {
            setConfirm(false);
            // ⚠️ "다시 보내기" 체크와 번호를 **지우지 않는다**(최종 검수 M-2). 지우면 다시 보내다 멈춘 뒤 안내대로
            //    그대로 다시 누를 때 오늘 날짜 묶음으로 돌아가 남은 분이 영영 못 받거나, 다시 체크하면 새 번호가 되어
            //    이미 받은 분에게 또 간다. 같은 번호·같은 내용이면 서버가 "이어 보내기"로 처리한다.
            //    새 번호는 체크를 **껐다 다시 켤 때만** 만든다.
          }}
          style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}
        >
          {resendAll && resendNonce && <input type="hidden" name="resendNonce" value={resendNonce} />}
          <input type="hidden" name="body" value={body} />
          <input type="hidden" name="content" value={content} />
          {pickedList.map((r) => (
            <input key={r.id} type="hidden" name="userIds" value={r.id} />
          ))}
          <button
            type="button"
            onClick={() => setConfirm(false)}
            style={{ height: 42, padding: "0 16px", borderRadius: 10, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            취소
          </button>
          <button
            type="submit"
            disabled={pending}
            style={{ height: 42, padding: "0 16px", borderRadius: 10, border: "none", background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
          >
            {pending ? "보내는 중..." : "보내기"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

/** 오늘 날짜를 "11월 22일" 꼴로 — 서버의 같은 규칙과 맞춘다(미리보기용). */
function todayLabel(): string {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** "다시 보내기" 일회용 번호. 서버가 이 번호로 새 묶음을 만든다(같은 번호를 두 번 보내면 막힌다). */
function newResendNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `b${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
