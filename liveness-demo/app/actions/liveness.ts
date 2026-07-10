"use server";
// 데모 서버 액션 — 웹캠 사진 1장을 받아 ① 얼굴 위치(GaonFR detect) ② 위조 판독(MiniFASNet) 수행.
// 실제 근태 적용 때와 동일한 파이프라인. 사진은 판독 후 메모리에서 폐기(저장 안 함).
import { detectFaces, isConfigured, type FaceRect } from "@/lib/gaonfr";
import { analyzeFace, type ModelScore } from "@/lib/liveness";

export type AnalyzeResult = {
  ok: boolean;
  message?: string;
  faceCount?: number;
  rect?: FaceRect;
  imageSize?: { width: number; height: number };
  realScore?: number;
  models?: ModelScore[];
  detectMs?: number;
  livenessMs?: number;
};

export async function analyzeLiveness(formData: FormData): Promise<AnalyzeResult> {
  if (!isConfigured()) return { ok: false, message: "얼굴서버 설정(.env FACE_*)이 없습니다." };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "사진이 없습니다. 다시 촬영해 주세요." };
  if (file.size > 900 * 1024) return { ok: false, message: "사진 용량이 너무 큽니다(900KB 초과). 다시 시도해 주세요." };

  const buffer = Buffer.from(await file.arrayBuffer());

  const t0 = Date.now();
  const det = await detectFaces(buffer);
  const detectMs = Date.now() - t0;
  if (!det.success) return { ok: false, message: det.message };
  if (det.faces.length === 0) return { ok: false, message: "얼굴을 찾지 못했습니다. 화면 가운데에 오도록 해주세요.", faceCount: 0 };

  // 여러 얼굴이면 가장 큰 얼굴 기준으로 판독(데모 표시용) — 개수는 함께 반환
  const rect = det.faces.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));

  const lv = await analyzeFace(buffer, rect);
  if (!lv.ok) return { ok: false, message: lv.message, faceCount: det.faces.length, rect, imageSize: det.imageSize };

  return {
    ok: true,
    faceCount: det.faces.length,
    rect,
    imageSize: det.imageSize,
    realScore: lv.realScore,
    models: lv.models,
    detectMs,
    livenessMs: lv.elapsedMs,
  };
}
