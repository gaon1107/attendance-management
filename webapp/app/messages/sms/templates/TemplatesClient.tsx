"use client";
// 문자 템플릿 관리(관리자) — 왼쪽 만들기·수정 폼 / 오른쪽 목록.
//  · 권한·회사격리·최종 검사는 서버 액션(app/actions/sms-templates.ts)이 책임진다. 여기 검사는 **미리 알려주기**다.
//  · 길이(바이트)·금지 글자 규칙은 lib/sms-templates.ts 한 곳에서 가져다 쓴다(서버와 같은 규칙).
//  · 2단 배치는 공통 클래스 `.split-2`를 쓴다 — 폰에서 자동으로 세로로 접힌다(디자인 규칙 §3).
import { useActionState, useMemo, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { saveSmsTemplate, deleteSmsTemplate } from "@/app/actions/sms-templates";
import {
  TEMPLATE_VARS,
  TEMPLATE_NAME_MAX,
  TEMPLATE_MAX_PER_COMPANY,
  SMS_SHORT_MAX_BYTES,
  SMS_LONG_MAX_BYTES,
  countSmsBytes,
  findUnsupportedPreview,
  findUnknownVars,
  renderTemplate,
} from "@/lib/sms-templates";

export type TemplateRow = { id: string; name: string; body: string };

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
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 24,
};

export function TemplatesClient({
  rows,
  defaults,
  companyName,
}: {
  rows: TemplateRow[];
  defaults: { id: string; name: string; body: string }[];
  companyName: string;
}) {
  // 수정 중인 템플릿(없으면 새로 만들기). 폼을 갈아끼울 때 key로 remount해 입력값을 초기화한다.
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [confirmDel, setConfirmDel] = useState<TemplateRow | null>(null);

  const [saveState, saveAction, savePending] = useActionState(saveSmsTemplate, {});
  const [delState, delAction, delPending] = useActionState(deleteSmsTemplate, {});

  const bad = useMemo(() => findUnsupportedPreview(body), [body]);
  // 바뀌지 않는 대괄호 — 막지 않고 알려만 준다(검수 중간 6).
  const unknownVars = useMemo(() => findUnknownVars(body), [body]);
  // 저장 가능 여부는 **원문** 기준이다(저장되는 것이 원문이다).
  const tooLong = countSmsBytes(body) > SMS_LONG_MAX_BYTES;

  // 미리보기 — 실제로 보낼 때처럼 자리를 채워 보여 준다(값이 없는 자리는 지워진다).
  const preview = useMemo(
    () => renderTemplate(body, { 직원명: "홍길동", 회사명: companyName, 날짜: "11월 22일", 내용: "(보낼 때 적는 내용)" }),
    [body, companyName],
  );

  // 🔴 [2026-11-22 검수 중간 2] 요금(단문/장문) 안내는 **자리를 채운 문장** 기준으로 센다.
  //    원문으로 세면 "[내용]"이 6바이트로 잡혀 단문이라고 안내하지만, 실제로는 수십~수백 바이트가 들어가
  //    장문(요금 약 3배)으로 나간다 — 요금 오안내가 된다. 실제 값은 보낼 때 정해지므로 **예시 기준**임을 밝힌다.
  const bytes = countSmsBytes(preview);
  const isShort = bytes <= SMS_SHORT_MAX_BYTES;
  const hasVars = useMemo(() => TEMPLATE_VARS.some((v) => body.includes(v.key)), [body]);

  function startNew() {
    setEditing(null);
    setName("");
    setBody("");
    setFormKey((k) => k + 1);
  }
  function startEdit(t: TemplateRow) {
    setEditing(t);
    setName(t.name);
    setBody(t.body);
    setFormKey((k) => k + 1);
  }
  /** 기본 템플릿을 **가져와서** 우리 회사 것으로 만든다(원본은 그대로 남는다). */
  function startFromDefault(d: { name: string; body: string }) {
    setEditing(null);
    setName(d.name);
    setBody(d.body);
    setFormKey((k) => k + 1);
  }
  /** 커서 위치를 따지지 않고 **맨 뒤에** 붙인다 — 단순하고 예측 가능하다. */
  function addVar(v: string) {
    setBody((b) => b + v);
  }

  // 저장이 끝나면 폼을 비운다(목록은 서버가 다시 그린다).
  const justSaved = saveState.ok === true;

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        자주 쓰는 문자 문구를 저장해 두는 곳입니다. 저장한 문구는 <b>[메시지 발송]</b>에서 골라 쓸 수 있습니다(발송 기능은
        준비 중입니다). <b>[직원명]</b>처럼 대괄호로 적은 자리는 보낼 때 실제 값으로 바뀝니다.
      </div>

      <div className="split-2">
        {/* ── 왼쪽: 만들기 / 수정 ───────────────────────────────────────── */}
        <section style={cardStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            {editing ? "템플릿 수정" : "새 템플릿 만들기"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 18, lineHeight: 1.6, wordBreak: "keep-all" }}>
            {editing ? (
              <>
                <b>{editing.name}</b> 템플릿을 고치고 있습니다.{" "}
                <button
                  type="button"
                  onClick={startNew}
                  style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "var(--primary)", textDecoration: "underline", cursor: "pointer" }}
                >
                  새로 만들기로 바꾸기
                </button>
              </>
            ) : (
              <>우리 회사 템플릿은 {TEMPLATE_MAX_PER_COMPANY}개까지 만들 수 있습니다.</>
            )}
          </div>

          <form key={formKey} action={saveAction} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <div>
              <label style={labelStyle} htmlFor="tpl-name">템플릿 이름</label>
              <input
                id="tpl-name"
                name="name"
                type="text"
                maxLength={TEMPLATE_NAME_MAX}
                placeholder="예시) 공지 안내"
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="tpl-body">문구</label>
              <textarea
                id="tpl-body"
                name="body"
                rows={5}
                placeholder="예시) [회사명] 새 공지가 등록되었습니다. [내용]"
                style={{ ...inputStyle, height: "auto", padding: "12px 14px", lineHeight: 1.7, resize: "vertical" }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />

              {/* 글자 수·단문/장문 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
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
                <span style={{ fontSize: 12, color: "var(--text-sub)", wordBreak: "keep-all" }}>
                  (한글 2바이트 · {SMS_SHORT_MAX_BYTES}바이트를 넘으면 장문이 되어 요금이 올라갑니다
                  {hasVars ? " · 아래 예시 기준이며, 자리에 들어가는 글자에 따라 달라집니다" : ""})
                </span>
              </div>

              {bad.length > 0 && (
                <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 8, wordBreak: "keep-all" }}>
                  문자로 보낼 수 없는 글자가 있습니다: {bad.join(" ")} — 이모지는 받는 분 휴대폰에서 깨집니다.
                </div>
              )}
              {unknownVars.length > 0 && (
                <div style={{ fontSize: 13, color: "#B45309", fontWeight: 700, marginTop: 8, wordBreak: "keep-all" }}>
                  이 자리는 바뀌지 않고 <b>적은 그대로 나갑니다</b>: {unknownVars.join(" ")} — 바뀌는 자리는 아래 네 가지뿐입니다.
                </div>
              )}
              {tooLong && (
                <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>
                  문구가 너무 깁니다. {SMS_LONG_MAX_BYTES}바이트 아래로 줄여 주세요.
                </div>
              )}
            </div>

            {/* 바꿔 넣는 자리 */}
            <div>
              <div style={{ ...labelStyle, marginBottom: 8 }}>바꿔 넣는 자리 (누르면 문구 끝에 붙습니다)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => addVar(v.key)}
                    title={v.desc}
                    style={{
                      height: 32,
                      padding: "0 11px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    {v.key}
                  </button>
                ))}
              </div>
            </div>

            {/* 미리보기 */}
            {body.trim() !== "" && (
              <div>
                <div style={{ ...labelStyle, marginBottom: 8 }}>이렇게 나갑니다 (예시)</div>
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

            {saveState.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{saveState.error}</div>}
            {justSaved && saveState.message && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "#15803D", fontWeight: 700 }}>{saveState.message}</span>
                {/* 저장 뒤에도 폼에 값이 남는다 — 그대로 또 누르면 "같은 이름" 오류가 나므로 비우는 길을 준다(검수 경미 2). */}
                <button
                  type="button"
                  onClick={startNew}
                  style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "var(--primary)", textDecoration: "underline", cursor: "pointer" }}
                >
                  비우고 새로 만들기
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={savePending || tooLong || bad.length > 0}
              style={{
                height: 48,
                border: "none",
                borderRadius: 10,
                background: "var(--primary)",
                color: "#fff",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: 700,
                cursor: savePending || tooLong || bad.length > 0 ? "default" : "pointer",
                opacity: savePending || tooLong || bad.length > 0 ? 0.6 : 1,
              }}
            >
              {savePending ? "저장 중..." : editing ? "수정 저장" : "템플릿 저장"}
            </button>
          </form>
        </section>

        {/* ── 오른쪽: 목록 ─────────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              우리 회사 템플릿 <span style={{ color: "var(--primary)" }}>{rows.length}개</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16 }}>
              직접 만든 문구입니다. 고치거나 지울 수 있습니다.
            </div>

            {delState.error && (
              <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700, marginBottom: 12 }}>{delState.error}</div>
            )}

            {rows.length === 0 ? (
              <div style={{ padding: "22px 0", fontSize: 14, color: "var(--text-sub)", textAlign: "center", wordBreak: "keep-all" }}>
                아직 만든 템플릿이 없습니다. 아래 기본 문구에서 [가져오기]를 누르면 쉽게 시작할 수 있습니다.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map((t) => (
                  <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => startEdit(t)}
                          style={{ height: 30, padding: "0 11px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDel(t)}
                          style={{ height: 30, padding: "0 11px", borderRadius: 8, border: "1px solid #FECACA", background: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "var(--danger)", cursor: "pointer" }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "keep-all" }}>
                      {t.body}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>기본 문구 {defaults.length}개</div>
            <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, wordBreak: "keep-all" }}>
              가온이 미리 준비한 문구입니다. <b>[가져오기]</b>를 누르면 왼쪽 폼에 채워지고, 고쳐서 우리 회사 템플릿으로 저장할
              수 있습니다(원본은 그대로 남습니다).
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {defaults.map((d) => (
                <div key={d.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", background: "var(--bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
                    <button
                      type="button"
                      onClick={() => startFromDefault(d)}
                      style={{ height: 30, padding: "0 11px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "var(--primary)", cursor: "pointer", flexShrink: 0 }}
                    >
                      가져오기
                    </button>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 6, lineHeight: 1.6, wordBreak: "keep-all" }}>
                    {d.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 삭제 확인 — 공용 Modal(디자인 규칙 §5.7) */}
      <Modal open={confirmDel !== null} onClose={() => setConfirmDel(null)} title="템플릿 삭제" maxWidth={420}>
        <div style={{ fontSize: 14, lineHeight: 1.7, wordBreak: "keep-all" }}>
          <b>{confirmDel?.name}</b> 템플릿을 지웁니다. 되돌릴 수 없습니다.
        </div>
        <form
          action={delAction}
          onSubmit={() => {
            // 지금 고치고 있던 템플릿을 지우는 경우 → 폼을 새로 만들기로 되돌린다.
            //  안 그러면 사라진 템플릿을 수정하는 폼이 남아, 저장을 누르면 "찾을 수 없습니다"가 난다.
            if (editing && confirmDel && editing.id === confirmDel.id) startNew();
            setConfirmDel(null);
          }}
          style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}
        >
          <input type="hidden" name="id" value={confirmDel?.id ?? ""} />
          <button
            type="button"
            onClick={() => setConfirmDel(null)}
            style={{ height: 42, padding: "0 16px", borderRadius: 10, border: "1px solid var(--border)", background: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            취소
          </button>
          <button
            type="submit"
            disabled={delPending}
            style={{ height: 42, padding: "0 16px", borderRadius: 10, border: "none", background: "var(--danger)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: delPending ? "default" : "pointer", opacity: delPending ? 0.6 : 1 }}
          >
            {delPending ? "지우는 중..." : "삭제"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
