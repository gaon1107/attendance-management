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
  // 얼굴 폭 = 화면(4:3, 좌우 잘림)에서 보이는 폭 대비 % — 근태 webapp과 동일 계산
  facePercent?: number;
  // 이 촬영에 실제 적용된 얼굴 크기 기준(%) — 화면 표시는 이 값을 쓴다(슬라이더를 나중에 움직여도 과거 결과가 안 바뀌게)
  minPercent?: number;
  // 얼굴이 기준(minPercent)보다 작아 판독을 진행하지 않음 (근태 출퇴근과 동일 동작)
  tooSmall?: boolean;
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

  // 얼굴 크기 기준(%) — 화면 슬라이더 값. 범위 밖이면 기본 30.
  const minRaw = Number(formData.get("minPercent"));
  const minPercent = Number.isFinite(minRaw) && minRaw >= 10 && minRaw <= 50 ? Math.round(minRaw) : 30;

  const buffer = Buffer.from(await file.arrayBuffer());

  const t0 = Date.now();
  const det = await detectFaces(buffer);
  const detectMs = Date.now() - t0;
  if (!det.success) return { ok: false, message: det.message };
  if (det.faces.length === 0) return { ok: false, message: "얼굴을 찾지 못했습니다. 화면 가운데에 오도록 해주세요.", faceCount: 0 };

  // 여러 얼굴이면 가장 큰 얼굴 기준으로 판독(데모 표시용) — 개수는 함께 반환
  const rect = det.faces.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));

  // 얼굴 크기(비율) — 기준 미만이면 판독을 진행하지 않는다 (근태 출퇴근과 동일 동작)
  let facePercent: number | undefined;
  if (det.imageSize?.width && det.imageSize?.height) {
    const visibleWidth = Math.min(det.imageSize.width, (det.imageSize.height * 4) / 3);
    facePercent = (rect.width / visibleWidth) * 100;
    if (facePercent < minPercent) {
      return {
        ok: false,
        tooSmall: true,
        facePercent,
        minPercent,
        faceCount: det.faces.length,
        rect,
        imageSize: det.imageSize,
        detectMs,
        message: `얼굴이 작습니다 — 화면의 ${facePercent.toFixed(0)}% (기준 ${minPercent}%). 타원 안에 얼굴을 채워 다시 촬영해 주세요.`,
      };
    }
  }

  const lv = await analyzeFace(buffer, rect);
  if (!lv.ok) return { ok: false, message: lv.message, faceCount: det.faces.length, rect, imageSize: det.imageSize, facePercent, minPercent };

  return {
    ok: true,
    faceCount: det.faces.length,
    rect,
    imageSize: det.imageSize,
    facePercent,
    minPercent,
    realScore: lv.realScore,
    models: lv.models,
    detectMs,
    livenessMs: lv.elapsedMs,
  };
}
