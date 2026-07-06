"use client";
// 생체정보 동의 화면의 상호작용 부분(체크박스 + 제출 버튼)만 클라이언트로 분리.
// 나머지 안내·레이아웃은 서버 컴포넌트(page.tsx)에서 AppShell로 감싼다.
import { useState } from "react";
import { agreeBiometric } from "@/app/actions/authmethod";

export function ConsentForm() {
  const [checked, setChecked] = useState(false);

  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer", fontSize: 15, fontWeight: 700 }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 18, height: 18 }} />
        위 내용에 동의합니다.
      </label>

      <form action={agreeBiometric}>
        <button
          type="submit"
          disabled={!checked}
          style={{
            width: "100%",
            height: 52,
            border: "none",
            borderRadius: 10,
            background: checked ? "var(--primary)" : "#D1D5DB",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 16,
            fontWeight: 700,
            cursor: checked ? "pointer" : "not-allowed",
          }}
        >
          동의하고 계속하기
        </button>
      </form>
    </>
  );
}
