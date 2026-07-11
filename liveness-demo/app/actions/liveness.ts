"use server";
// 데모 서버 액션 — 웹캠 연속 사진(1~3장)을 받아 ① 얼굴 위치(GaonFR detect) ② 위조 판독(MiniFASNet) ③ 질감 점수 수행.
// 실제 근태 적용 때와 동일한 파이프라인. 사진은 판독 후 메모리에서 폐기(저장 안 함).
// 얼굴 검출은 첫 장에서 1회만 하고 좌표를 재사용한다 — 연속 detect 호출은 얼굴서버 429(요청 폭주)에 걸리는 것을 실측 확인.
//   (장 간격이 0.3초라 얼굴 이동이 미미하고, 판독 크롭이 4.0/2.7배로 넓어 좌표 오차에 관대함)
import { detectFaces, isConfigured, type FaceRect } from "@/lib/gaonfr";
import { analyzeFace, type ModelScore } from "@/lib/liveness";
import { textureScore } from "@/lib/texture";
import { faceBrightness } from "@/lib/quality";

// 장별 판독 결과 — 판정(전부 통과 여부)은 화면에서 기준값 슬라이더로 계산한다
export type FrameResult = {
  realScore: number; // 두 모델 진짜 확률 평균 (0~1)
  models: ModelScore[];
  // 질감(망점·모아레) 규칙무늬 점수 — 관찰 모드: 판정에 반영하지 않고 표시만 한다 (기준값은 현장 실측 후 결정)
  texture?: { score: number; peakCount: number; window: number };
  textureError?: string;
  livenessMs: number;
  textureMs?: number;
};

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
  // 얼굴 영역 평균 밝기(0~255, 첫 장 기준) — 관찰·캘리브레이션용으로 항상 반환
  brightness?: number;
  // 이 촬영에 실제 적용된 밝기 기준(0~255) — 화면 표시는 이 값을 쓴다
  minBrightness?: number;
  // 얼굴이 기준(minBrightness)보다 어두워 판독을 진행하지 않음 (저조도 오탐 방지 — 재촬영 유도)
  tooDark?: boolean;
  // 첫 장 기준 값(기존 단일 장 호출과 동일 의미 — 호환 유지)
  realScore?: number;
  models?: ModelScore[];
  detectMs?: number;
  livenessMs?: number;
  // 장별 상세 (1~3장) — frames[0]이 첫 장
  frames?: FrameResult[];
};

export async function analyzeLiveness(formData: FormData): Promise<AnalyzeResult> {
  if (!isConfigured()) return { ok: false, message: "얼굴서버 설정(.env FACE_*)이 없습니다." };

  // "image" 항목 1~3장 (1장이면 기존 단일 판독과 동일하게 동작)
  const files = formData.getAll("image").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, message: "사진이 없습니다. 다시 촬영해 주세요." };
  if (files.length > 3) return { ok: false, message: "사진은 최대 3장까지 판독합니다." };
  for (const f of files) {
    if (f.size > 900 * 1024) return { ok: false, message: "사진 용량이 너무 큽니다(900KB 초과). 다시 시도해 주세요." };
  }

  // 얼굴 크기 기준(%) — 화면 슬라이더 값. 범위 밖이면 기본 30.
  const minRaw = Number(formData.get("minPercent"));
  const minPercent = Number.isFinite(minRaw) && minRaw >= 10 && minRaw <= 50 ? Math.round(minRaw) : 30;

  // 밝기 기준(0~255) — 화면 슬라이더 값. 0이면 밝기 안내 꺼짐(기존 동작과 동일). 범위 밖이면 0.
  const brightRaw = Number(formData.get("minBrightness"));
  const minBrightness = Number.isFinite(brightRaw) && brightRaw >= 0 && brightRaw <= 255 ? Math.round(brightRaw) : 0;

  const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const buffer = buffers[0];

  // 완전히 동일한 사진이 반복 수신되면 거절 — 실제 웹캠은 센서 노이즈로 장마다 미세하게 달라지므로,
  // 동일 바이트 반복은 정지 이미지 주입(가상 카메라 등)이나 카메라 멈춤 신호다 (연속 촬영 방어 우회 차단)
  for (let i = 1; i < buffers.length; i++) {
    for (let j = 0; j < i; j++) {
      if (buffers[i].equals(buffers[j])) {
        return { ok: false, message: "동일한 사진이 반복 감지되었습니다. 카메라 상태를 확인하고 다시 촬영해 주세요." };
      }
    }
  }

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

  // 얼굴 영역 밝기 측정(첫 장) — 저조도면 판독 대신 재촬영 안내(tooDark). 측정 실패 시 gate하지 않고 판독 진행.
  const bright = await faceBrightness(buffer, rect);
  const brightness = bright.ok ? Math.round(bright.mean * 10) / 10 : undefined;
  if (minBrightness > 0 && brightness != null && brightness < minBrightness) {
    return {
      ok: false,
      tooDark: true,
      brightness,
      minBrightness,
      facePercent,
      minPercent,
      faceCount: det.faces.length,
      rect,
      imageSize: det.imageSize,
      detectMs,
      message: `화면이 어둡습니다 — 밝기 ${brightness.toFixed(1)} (기준 ${minBrightness}). 더 밝은 곳에서 다시 촬영해 주세요.`,
    };
  }

  // 장별 순차 판독 — 모두 첫 장의 얼굴 좌표(rect)를 사용
  const frames: FrameResult[] = [];
  for (const buf of buffers) {
    const lv = await analyzeFace(buf, rect);
    if (!lv.ok || !lv.models || typeof lv.realScore !== "number") {
      return { ok: false, message: lv.message, faceCount: det.faces.length, rect, imageSize: det.imageSize, facePercent, minPercent };
    }
    // 질감 점수는 관찰용 — 실패해도 판독 자체는 유효하므로 오류만 기록하고 계속 진행
    const tex = await textureScore(buf, rect);
    frames.push({
      realScore: lv.realScore,
      models: lv.models,
      ...(tex.ok
        ? { texture: { score: tex.score, peakCount: tex.peakCount, window: tex.window }, textureMs: tex.elapsedMs }
        : { textureError: tex.message }),
      livenessMs: lv.elapsedMs ?? 0,
    });
  }

  return {
    ok: true,
    faceCount: det.faces.length,
    rect,
    imageSize: det.imageSize,
    facePercent,
    minPercent,
    brightness,
    minBrightness,
    realScore: frames[0].realScore,
    models: frames[0].models,
    detectMs,
    livenessMs: frames.reduce((a, f) => a + f.livenessMs, 0),
    frames,
  };
}
