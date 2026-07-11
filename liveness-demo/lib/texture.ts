// [질감 검사 모듈] 인쇄 망점·화면 격자(모아레) 흔적 탐지 — 관찰(캘리브레이션) 모드용
// 원리: 진짜 피부는 매끄러운 무작위 질감이라 주파수 스펙트럼이 완만하게 퍼지지만,
//       인쇄물(망점)과 화면(픽셀 격자)은 "규칙적인 미세 무늬"라 스펙트럼에 뾰족한 피크가 생긴다.
// 판독 AI가 80×80으로 축소하기 전, 원본 해상도 얼굴 중앙부를 그대로 잘라 2차원 FFT로 피크 세기를 점수화한다.
// ⚠️ 이 점수는 웹캠 화질·조명·거리에 따라 정상 범위가 달라진다.
//    기준값(판정 반영)은 반드시 현장 웹캠으로 진짜/위조를 실측해 정할 것 — 그 전까지는 화면 표시(관찰)만 한다.
// ⚠️ lib/liveness.ts와 마찬가지로 근태 이식 후보 모듈 — 데모 전용 로직을 넣지 말 것.
import sharp from "sharp";
import type { FaceRect } from "./gaonfr";

export type TextureResult =
  | {
      ok: true;
      // 규칙무늬 점수: 스펙트럼에서 "같은 반경대(주파수대) 평균 대비 가장 뾰족한 피크가 몇 배인가".
      // 클수록 인쇄/화면일 가능성이 높다. 판정 기준은 실측 후 결정.
      score: number;
      // 뚜렷한 피크(같은 반경대 중앙값의 8배 초과) 개수 — 규칙 무늬가 여러 방향이면 늘어난다
      peakCount: number;
      // 분석에 사용한 정사각형 창 크기(px, 원본 해상도) — 작을수록 신뢰도 낮음
      window: number;
      elapsedMs: number;
    }
  | { ok: false; message: string };

// 분석 창: 얼굴 상자 중앙의 정사각형. FFT를 위해 2의 거듭제곱, 최대 256, 최소 64.
const MAX_WINDOW = 256;
const MIN_WINDOW = 64;
// 분석 주파수 대역(반경, 창 크기 대비 비율): 저주파(얼굴 윤곽·조명)는 제외, 최고주파 끝단(노이즈)도 제외
const BAND_LOW = 0.08;
const BAND_HIGH = 0.48;
// 뚜렷한 피크로 세는 배율 기준
const PEAK_RATIO = 8;

// 반복(비재귀) 기수-2 FFT — 길이는 2의 거듭제곱 전제. re/im을 제자리에서 변환한다.
function fft1d(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// 2의 거듭제곱으로 내림
function floorPow2(v: number): number {
  let p = 1;
  while (p * 2 <= v) p *= 2;
  return p;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// 사진 원본 + 얼굴 위치 → 규칙무늬(망점·격자) 점수
export async function textureScore(imageBuffer: Buffer, rect: FaceRect): Promise<TextureResult> {
  const started = Date.now();
  try {
    const meta = await sharp(imageBuffer).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (!srcW || !srcH) return { ok: false, message: "이미지 크기를 읽지 못했습니다." };
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, message: "얼굴 영역이 올바르지 않습니다." };

    // 얼굴 중앙의 정사각형 창 — 축소 없이 원본 해상도 그대로 (축소하면 망점 증거가 지워진다)
    const side = Math.min(rect.width, rect.height, srcW, srcH);
    const n = Math.min(MAX_WINDOW, floorPow2(Math.trunc(side)));
    if (n < MIN_WINDOW) {
      return { ok: false, message: `얼굴이 너무 작아 질감 분석 불가 (창 ${n}px < 최소 ${MIN_WINDOW}px)` };
    }
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const left = Math.max(0, Math.min(srcW - n, Math.trunc(cx - n / 2)));
    const top = Math.max(0, Math.min(srcH - n, Math.trunc(cy - n / 2)));

    const gray = await sharp(imageBuffer)
      .extract({ left, top, width: n, height: n })
      .grayscale()
      .raw()
      .toBuffer();

    // 평균 제거 + 한(Hann) 창 적용 — 창 경계의 인위적 단절이 가짜 피크를 만드는 것을 방지
    let mean = 0;
    for (let i = 0; i < n * n; i++) mean += gray[i];
    mean /= n * n;
    const hann = new Float64Array(n);
    for (let i = 0; i < n; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        re[y * n + x] = (gray[y * n + x] - mean) * hann[y] * hann[x];
      }
    }

    // 2차원 FFT = 행 방향 1차원 FFT 후 열 방향 1차원 FFT
    const rowRe = new Float64Array(n);
    const rowIm = new Float64Array(n);
    for (let y = 0; y < n; y++) {
      rowRe.set(re.subarray(y * n, y * n + n));
      rowIm.set(im.subarray(y * n, y * n + n));
      fft1d(rowRe, rowIm);
      re.set(rowRe, y * n);
      im.set(rowIm, y * n);
    }
    const colRe = new Float64Array(n);
    const colIm = new Float64Array(n);
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        colRe[y] = re[y * n + x];
        colIm[y] = im[y * n + x];
      }
      fft1d(colRe, colIm);
      for (let y = 0; y < n; y++) {
        re[y * n + x] = colRe[y];
        im[y * n + x] = colIm[y];
      }
    }

    // 반경(주파수 크기)별로 진폭을 모은다 — 자연 영상은 주파수가 높을수록 진폭이 줄어들므로,
    // "같은 반경대 안에서 얼마나 튀는가"로 정규화해야 공정한 피크 탐지가 된다.
    const rLow = BAND_LOW * n;
    const rHigh = BAND_HIGH * n;
    const jpegGrid = n / 8; // JPEG 압축 블록(8px)이 만드는 격자 주파수 — 진짜/위조 모두에 생기므로 제외
    const byRadius: number[][] = [];
    const entries: { r: number; mag: number; fx: number; fy: number }[] = [];
    for (let y = 0; y < n; y++) {
      const fy = y <= n / 2 ? y : y - n;
      for (let x = 0; x < n; x++) {
        const fx = x <= n / 2 ? x : x - n;
        const r = Math.hypot(fx, fy);
        if (r < rLow || r > rHigh) continue;
        const gx = Math.abs(fx) % jpegGrid;
        const gy = Math.abs(fy) % jpegGrid;
        if ((gx <= 1 || gx >= jpegGrid - 1) && (gy <= 1 || gy >= jpegGrid - 1)) continue;
        const mag = Math.hypot(re[y * n + x], im[y * n + x]);
        const ri = Math.round(r);
        (byRadius[ri] ??= []).push(mag);
        entries.push({ r, mag, fx, fy });
      }
    }
    if (entries.length === 0) return { ok: false, message: "분석 대역이 비어 있습니다." };

    const medByRadius: number[] = [];
    for (let ri = 0; ri < byRadius.length; ri++) {
      if (byRadius[ri]) medByRadius[ri] = median(byRadius[ri].slice().sort((a, b) => a - b));
    }

    let maxRatio = 0;
    let peakCount = 0;
    for (const e of entries) {
      const med = medByRadius[Math.round(e.r)];
      if (!med || med <= 0) continue;
      const ratio = e.mag / med;
      if (ratio > maxRatio) maxRatio = ratio;
      // 실수 입력의 스펙트럼은 원점 대칭 쌍(켤레)으로 나타나므로, 위쪽 절반만 세어 물리적 피크 수를 만든다
      if (ratio > PEAK_RATIO && (e.fy > 0 || (e.fy === 0 && e.fx > 0))) peakCount++;
    }

    return {
      ok: true,
      score: Math.round(maxRatio * 10) / 10,
      peakCount,
      window: n,
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    console.error("[texture] 질감 분석 실패:", e);
    return { ok: false, message: "질감 분석 중 오류가 발생했습니다." };
  }
}
