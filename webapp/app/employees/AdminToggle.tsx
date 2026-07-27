"use client";
// 직원 목록의 [관리자로 지정] / [관리자 해제] 버튼.
//  · 실수로 누르는 일이 없게 **누르면 한 번 물어본다**(권한 변경은 되돌릴 수 있지만 놀라는 일은 막는다).
//  · 본인 행에는 버튼을 띄우지 않는다(서버도 본인 변경을 거부한다 — 화면과 서버가 같은 규칙).
import { setAdminRole } from "@/app/actions/owner";

export function AdminToggle({ userId, isAdmin, isMe, name }: {
  userId: string;
  isAdmin: boolean;
  isMe: boolean;
  name: string;
}) {
  if (isMe) {
    return <span style={{ fontSize: 12, color: "var(--text-sub)" }}>본인</span>;
  }

  const ask = isAdmin
    ? `${name} 님의 관리자 권한을 해제할까요?\n\n해제하면 관리자 화면(직원관리·설정·리포트)에 들어갈 수 없게 됩니다.`
    : `${name} 님을 관리자로 지정할까요?\n\n관리자는 직원 정보·근태 기록·회사 설정을 모두 볼 수 있습니다.`;

  return (
    <form action={setAdminRole} onSubmit={(e) => { if (!confirm(ask)) e.preventDefault(); }}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="makeAdmin" value={isAdmin ? "0" : "1"} />
      <button
        type="submit"
        style={{
          height: 30,
          padding: "0 11px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: isAdmin ? "#FEF3C7" : "#fff",
          color: isAdmin ? "#B45309" : "var(--text-sub)",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isAdmin ? "관리자 해제" : "관리자로 지정"}
      </button>
    </form>
  );
}
