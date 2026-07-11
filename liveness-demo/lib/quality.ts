// [영상 품질 검사 모듈] 얼굴 영역 평균 밝기 측정 — 저조도 재촬영 안내용
// 어두운 곳에서 판독 AI(특히 모델 A)가 진짜 얼굴을 위조로 오탐하는 것을 막기 위해,
// 얼굴이 너무 어두우면 위조로 판정하지 않고 "더 밝은 곳에서 촬영해 주세요"로 안내하기 위한 밝기 값.
// ⚠️ lib/liveness.ts와 마찬가지로 근태 이식 후보 모듈 — 데모 전용 로직을 넣지 말 것.
import sharp from "sharp";
import type { FaceRect } from "./gaonfr";

export type BrightnessResult =
  | { ok: true; mean: number; elapsedMs: number } // mean: 얼굴 영역 평균 밝기 0~255 (클수록 밝음)
  | { ok: false; message: string };

// 사진 원본 + 얼굴 위치 → 얼굴 영역 평균 밝기(0~255)
// sharp의 stats()는 픽셀을 직접 순회하지 않고 채널 통계를 내주어 매우 가볍다.
export async function faceBrightness(imageBuffer: Buffer, rect: FaceRect): Promise<BrightnessResult> {
  const started = Date.now();
  try {
    const meta = await sharp(imageBuffer).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (!srcW || !srcH) return { ok: false, message: "이미지 크기를 읽지 못했습니다." };
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, message: "얼굴 영역이 올바르지 않습니다." };

    // 얼굴 상자를 이미지 경계 안으로 클램핑 (검출 좌표가 이미지 밖으로 나가는 경우 방지)
    const left = Math.max(0, Math.min(srcW - 1, Math.trunc(rect.x)));
    const top = Math.max(0, Math.min(srcH - 1, Math.trunc(rect.y)));
    const width = Math.max(1, Math.min(srcW - left, Math.trunc(rect.width)));
    const height = Math.max(1, Math.min(srcH - top, Math.trunc(rect.height)));

    const stats = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .grayscale()
      .stats();

    const mean = stats.channels[0]?.mean;
    if (typeof mean !== "number" || !Number.isFinite(mean)) {
      return { ok: false, message: "밝기 값을 읽지 못했습니다." };
    }
    return { ok: true, mean, elapsedMs: Date.now() - started };
  } catch (e) {
    console.error("[quality] 밝기 측정 실패:", e);
    return { ok: false, message: "밝기 측정 중 오류가 발생했습니다." };
  }
}
