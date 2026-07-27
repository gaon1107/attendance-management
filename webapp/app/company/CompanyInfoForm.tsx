"use client";
// 회사 상세정보 입력 폼 — 기본정보 · 주소/연락처 · 담당자 · 비고.
// 우편번호/주소는 4단계에서 다음 우편번호 팝업(PostcodeButton)으로 자동 채우므로 controlled(state)로 둔다.
import { useActionState, useState } from "react";
import { saveCompanyInfo } from "@/app/actions/company";
import { PostcodeButton } from "@/app/components/PostcodeButton";

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  color: "var(--text)",
  outline: "none",
  width: "100%",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const cardStyle: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 };
const cardTitle: React.CSSProperties = { fontSize: 16, fontWeight: 700, marginBottom: 16 };
const rowStyle: React.CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 };

export type CompanyInitial = {
  name: string;
  bizRegNo: string | null;
  /** "국세청 확인됨 (날짜)" 또는 "국세청 확인 보류". 사업자번호가 비어 있으면 null. */
  bizRegVerifiedLabel: string | null;
  corpRegNo: string | null;
  ceoName: string | null;
  bizType: string | null;
  bizItem: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  companyPhone: string | null;
  companyFax: string | null;
  companyEmail: string | null;
  website: string | null;
  managerName: string | null;
  managerTitle: string | null;
  managerPhone: string | null;
  managerEmail: string | null;
  companyNote: string | null;
};

// 한 칸(라벨 + 입력). uncontrolled(defaultValue) 기본.
function Field({
  label, name, defaultValue, type = "text", placeholder, minWidth = 200,
}: {
  label: string; name: string; defaultValue?: string | null; type?: string; placeholder?: string; minWidth?: number;
}) {
  return (
    <div style={{ flex: 1, minWidth }}>
      <label style={labelStyle}>{label}</label>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

export function CompanyInfoForm({ initial }: { initial: CompanyInitial }) {
  const [state, formAction, pending] = useActionState(saveCompanyInfo, {});
  const [zipCode, setZipCode] = useState(initial.zipCode ?? "");
  const [address, setAddress] = useState(initial.address ?? "");

  return (
    <form action={formAction}>
      {/* 기본정보 */}
      <div style={cardStyle}>
        <div style={cardTitle}>기본 정보</div>
        <div style={rowStyle}>
          <Field label="회사명 *" name="name" defaultValue={initial.name} placeholder="㈜하늘테크" />
          <div>
            <Field label="사업자등록번호" name="bizRegNo" defaultValue={initial.bizRegNo} placeholder="123-12-12345" />
            {/* 가입할 때 국세청에 확인한 결과. 확인 서버에 닿지 못했으면 "보류"로 남는다(가입은 막지 않는다). */}
            {initial.bizRegVerifiedLabel && (
              <div style={{ fontSize: 12, marginTop: 6, fontWeight: 700, color: initial.bizRegVerifiedLabel.includes("확인됨") ? "#15803D" : "#B45309" }}>
                {initial.bizRegVerifiedLabel}
              </div>
            )}
          </div>
          <Field label="법인등록번호" name="corpRegNo" defaultValue={initial.corpRegNo} />
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <Field label="대표자" name="ceoName" defaultValue={initial.ceoName} placeholder="홍길동" />
          <Field label="업태" name="bizType" defaultValue={initial.bizType} placeholder="제조업" />
          <Field label="종목" name="bizItem" defaultValue={initial.bizItem} placeholder="금형" />
        </div>
      </div>

      {/* 주소 · 연락처 */}
      <div style={cardStyle}>
        <div style={cardTitle}>주소 · 연락처</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div style={{ width: 160 }}>
            <label style={labelStyle}>우편번호</label>
            <input name="zipCode" type="text" value={zipCode} onChange={(e) => setZipCode(e.target.value)} placeholder="12345" style={inputStyle} readOnly />
          </div>
          <PostcodeButton onComplete={(z, a) => { setZipCode(z); setAddress(a); }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>주소</label>
          <input name="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소 검색으로 채우거나 직접 입력" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>상세주소</label>
          <input name="addressDetail" type="text" defaultValue={initial.addressDetail ?? ""} placeholder="동·층·호수 등" style={inputStyle} />
        </div>
        <div style={rowStyle}>
          <Field label="대표전화" name="companyPhone" type="tel" defaultValue={initial.companyPhone} placeholder="02-1234-5678" />
          <Field label="팩스" name="companyFax" type="tel" defaultValue={initial.companyFax} />
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <Field label="대표 이메일" name="companyEmail" type="email" defaultValue={initial.companyEmail} placeholder="info@company.co.kr" />
          <Field label="홈페이지" name="website" defaultValue={initial.website} placeholder="https://" />
        </div>
      </div>

      {/* 담당자 */}
      <div style={cardStyle}>
        <div style={cardTitle}>담당자 (근태 담당)</div>
        <div style={rowStyle}>
          <Field label="담당자 이름" name="managerName" defaultValue={initial.managerName} placeholder="김담당" />
          <Field label="직책" name="managerTitle" defaultValue={initial.managerTitle} placeholder="과장" />
        </div>
        <div style={{ ...rowStyle, marginBottom: 0 }}>
          <Field label="담당 연락처" name="managerPhone" type="tel" defaultValue={initial.managerPhone} placeholder="010-1234-5678" />
          <Field label="담당 이메일" name="managerEmail" type="email" defaultValue={initial.managerEmail} />
        </div>
      </div>

      {/* 비고 */}
      <div style={cardStyle}>
        <div style={cardTitle}>비고</div>
        <textarea
          name="companyNote"
          defaultValue={initial.companyNote ?? ""}
          placeholder="메모 (선택)"
          style={{ ...inputStyle, height: 100, padding: "12px 14px", resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      {/* 저장 */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          type="submit"
          disabled={pending}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 32px" }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
        {state?.error && <span style={{ fontSize: 14, color: "var(--danger)", fontWeight: 700 }}>{state.error}</span>}
        {state?.ok && <span style={{ fontSize: 14, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</span>}
      </div>
    </form>
  );
}
