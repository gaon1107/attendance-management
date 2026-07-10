import { isConfigured } from "@/lib/gaonfr";
import { DemoClient } from "./DemoClient";

export default function DemoPage() {
  const ready = isConfigured();
  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 20px 60px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>라이브니스 데모 — 사진 위조 판독 테스트</h1>
      <p style={{ fontSize: 14, color: "#6B7280", marginTop: 0, marginBottom: 20, lineHeight: 1.6 }}>
        웹캠으로 촬영하면 ① 얼굴서버가 얼굴 위치를 찾고 ② 판독 AI(MiniFASNet 2종)가 <b>진짜 사람인지 사진/화면인지</b> 점수를 매깁니다.
        진짜 얼굴 / A4 인쇄 사진 / 휴대폰 화면 / 모니터 화면 / 동영상 재생으로 각각 시험해 보세요. 사진은 판독 후 버려지며 저장되지 않습니다.
      </p>
      {!ready ? (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "14px 16px", fontSize: 14, color: "#92400E" }}>
          얼굴서버 설정(.env FACE_*)이 없습니다. liveness-demo/.env 파일을 확인하세요.
        </div>
      ) : (
        <DemoClient />
      )}
    </main>
  );
}
