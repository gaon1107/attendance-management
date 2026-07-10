// [라이브니스 판독 모듈] MiniFASNet V1SE + V2 (Apache-2.0, minivision-ai 공개 가중치의 ONNX 변환본)
// 원 구현(yakhyo/face-anti-spoofing · minivision-ai/Silent-Face-Anti-Spoofing)의 전처리를 그대로 재현:
//   얼굴 상자를 배율(V1SE=4.0, V2=2.7)로 넓혀 크롭 → 80×80 리사이즈 → BGR·0~255 float·CHW → softmax
//   출력 3클래스 중 [1] = 진짜(Real) 확률. 두 모델의 진짜 확률 평균을 최종 점수로 쓴다.
// ⚠️ 이 파일은 근태관리 적용(1단계) 때 그대로 옮겨갈 코드다 — 데모 전용 로직을 넣지 말 것.
import path from "path";
import fs from "fs";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { FaceRect } from "./gaonfr";

// 모델 폴더 찾기 — dev 서버를 상위 폴더에서 띄워도(cwd가 달라져도) 동작하도록 후보를 순서대로 확인
function modelsDir(): string {
  const candidates = [
    path.join(process.cwd(), "models"),
    path.join(process.cwd(), "liveness-demo", "models"),
    path.join(process.cwd(), "webapp", "models"), // 근태 적용(1단계) 시 대비
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "MiniFASNetV2.onnx"))) return c;
  }
  return candidates[0];
}

const INPUT_SIZE = 80;
const MODELS = [
  { name: "V1SE", file: "MiniFASNetV1SE.onnx", scale: 4.0 },
  { name: "V2", file: "MiniFASNetV2.onnx", scale: 2.7 },
] as const;

// 모델은 프로세스당 1회만 로드(첫 호출 때). 실패하면 다음 호출에서 재시도.
let sessionsPromise: Promise<ort.InferenceSession[]> | null = null;
function getSessions(): Promise<ort.InferenceSession[]> {
  if (!sessionsPromise) {
    const dir = modelsDir();
    sessionsPromise = Promise.all(
      MODELS.map((m) => ort.InferenceSession.create(path.join(dir, m.file)))
    ).catch((e) => {
      sessionsPromise = null;
      throw e;
    });
  }
  return sessionsPromise;
}

// 원 구현 crop_face와 동일한 확장 크롭 좌표 계산 (파이썬 int() = 버림 재현)
function cropBox(srcW: number, srcH: number, rect: FaceRect, scale: number) {
  const limited = Math.min((srcH - 1) / rect.height, (srcW - 1) / rect.width, scale);
  const newW = rect.width * limited;
  const newH = rect.height * limited;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const x1 = Math.max(0, Math.trunc(cx - newW / 2));
  const y1 = Math.max(0, Math.trunc(cy - newH / 2));
  const x2 = Math.min(srcW - 1, Math.trunc(cx + newW / 2));
  const y2 = Math.min(srcH - 1, Math.trunc(cy + newH / 2));
  return { left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

export type ModelScore = { name: string; realProb: number; probs: number[] };
export type LivenessResult = {
  ok: boolean;
  message?: string;
  realScore?: number; // 두 모델 진짜 확률 평균 (0~1)
  models?: ModelScore[];
  elapsedMs?: number;
};

// 사진 원본(JPEG buffer) + 얼굴 위치(원본 좌표) → 진짜/위조 점수
export async function analyzeFace(imageBuffer: Buffer, rect: FaceRect): Promise<LivenessResult> {
  const started = Date.now();
  try {
    const meta = await sharp(imageBuffer).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (!srcW || !srcH) return { ok: false, message: "이미지 크기를 읽지 못했습니다." };
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, message: "얼굴 영역이 올바르지 않습니다." };

    const sessions = await getSessions();
    const models: ModelScore[] = [];

    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i];
      const box = cropBox(srcW, srcH, rect, m.scale);
      // RGB(HWC, 0~255) 원시 픽셀 추출
      const raw = await sharp(imageBuffer)
        .extract(box)
        // 보간(kernel)은 원 구현 cv2.resize(INTER_LINEAR)에 가장 가까운 linear로 고정.
        // ⚠️ 커널이 바뀌면 점수가 최대 12%p 움직인다(검수 실측) — 기준값(threshold)은 반드시 이 설정으로 자체 공격 테스트에서 정하고, 이후 변경 금지.
        .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill", kernel: "linear" })
        .removeAlpha()
        .raw()
        .toBuffer();
      // BGR·CHW·float(0~255, 정규화 없음 — 원 구현과 동일)
      const px = INPUT_SIZE * INPUT_SIZE;
      const data = new Float32Array(3 * px);
      for (let p = 0; p < px; p++) {
        data[0 * px + p] = raw[p * 3 + 2]; // B
        data[1 * px + p] = raw[p * 3 + 1]; // G
        data[2 * px + p] = raw[p * 3 + 0]; // R
      }
      const tensor = new ort.Tensor("float32", data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const session = sessions[i];
      const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: tensor };
      const outputs = await session.run(feeds);
      const logits = outputs[session.outputNames[0]].data as Float32Array;
      const probs = softmax(logits);
      models.push({ name: m.name, realProb: probs[1] ?? 0, probs });
    }

    const realScore = models.reduce((a, b) => a + b.realProb, 0) / models.length;
    return { ok: true, realScore, models, elapsedMs: Date.now() - started };
  } catch (e) {
    // 내부 오류 원문(영문)은 서버 로그에만 남기고, 화면에는 한국어 안내만 보낸다
    console.error("[liveness] 판독 실패:", e);
    return { ok: false, message: "판독 처리 중 오류가 발생했습니다. 다시 시도해 주세요." };
  }
}
