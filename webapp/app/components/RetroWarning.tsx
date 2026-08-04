"use client";
// 소급 변경 경고 상자 (검수 M-9·M-10) — "저장하면 과거 기록이 이만큼 다르게 읽힙니다"를 보여주고
// 한 번 더 누르게 한다. 문구는 서버(lib/retroactive.ts)가 만들고 여기서는 보여주기만 한다
// (같은 말을 세 화면이 각자 만들면 서로 달라진다).
//
// 확인 버튼은 **같은 폼 안의 submit 버튼**이다 — `name="confirm" value="1"`이 그대로 FormData에 실려
// 서버가 "관리자가 알고 눌렀다"를 구분한다. 별도 상태가 필요 없어 어긋날 여지가 없다.
//
// ⚠️ 이 상자를 **폼 안 맨 앞에 두지 말 것**(검수 중간 1). HTML은 트리 순서상 첫 submit 버튼을 폼의 기본 버튼으로
//    삼기 때문에, 앞에 두면 입력칸에서 Enter만 눌러도 confirm=1로 저장돼 2단계 확인이 1단계가 된다.
//    반드시 원래 저장 버튼 **뒤**에 둔다.

export function RetroWarning({
  warning,
  label = "확인했습니다. 그대로 저장",
  disabled = false,
}: {
  warning: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #FDE68A",
        background: "#FFFBEB",
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>⚠️ 지난 기록의 판정이 바뀝니다</div>
      <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.7, whiteSpace: "pre-line", wordBreak: "keep-all" }}>
        {warning}
      </div>
      <button
        type="submit"
        name="confirm"
        value="1"
        disabled={disabled}
        style={{
          height: 38,
          border: "none",
          borderRadius: 8,
          background: "#B45309",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 700,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          padding: "0 16px",
          alignSelf: "flex-start",
        }}
      >
        {label}
      </button>
    </div>
  );
}
