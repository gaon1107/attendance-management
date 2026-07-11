// 얼굴 크기 가이드 타원 — 웹캠 영상 위에 "이 안에 얼굴을 채우세요" 안내선을 그린다.
// 타원 폭 = 통과 기준(minPercent)의 1.5배 → 타원에 맞추면 자연스럽게 기준을 넘는다.
// 출퇴근 촬영(FaceClockPanel)·얼굴 등록(FaceCapture) 공용. position:relative인 부모(영상 박스) 안에서 사용.
export function FaceGuide({ minPercent }: { minPercent: number }) {
  const w = Math.min(70, Math.round(minPercent * 1.5)); // 타원 폭(화면 폭 %)
  const h = Math.min(88, Math.round(w * 1.73)); // 타원 높이(4:3 화면 높이 % — 얼굴 비율 반영)
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "48%",
          transform: "translate(-50%, -50%)",
          width: `${w}%`,
          height: `${h}%`,
          border: "3px dashed rgba(255,255,255,0.85)",
          borderRadius: "50%",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.18)", // 타원 밖을 살짝 어둡게 해 시선 유도
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 8,
          textAlign: "center",
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          textShadow: "0 1px 4px rgba(0,0,0,0.7)",
        }}
      >
        얼굴을 타원 안에 채워주세요
      </div>
    </div>
  );
}
