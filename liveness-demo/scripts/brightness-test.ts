// [검증 스크립트] 얼굴 밝기 측정 + tooDark 경로 확인
// 실행: npx -y tsx scripts/brightness-test.ts
// test-real.jpg의 원본/어둡게(50%·20%) 버전 밝기를 측정하고, 서버 액션 tooDark 경로를 확인한다.
import fs from "fs";
import path from "path";
import sharp from "sharp";

// .env 수동 로딩 (gaonfr.ts가 모듈 로드 시점에 env를 읽으므로 import보다 먼저 설정)
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// 이미지를 비율만큼 어둡게 (밝기 곱)
async function darken(buf: Buffer, factor: number): Promise<Buffer> {
  return sharp(buf).linear(factor, 0).jpeg({ quality: 90 }).toBuffer();
}

function makeForm(buf: Buffer, count: number, extra?: Record<string, string>): FormData {
  const fd = new FormData();
  // 동일 사진 반복 거절을 피하려고 장마다 여분 바이트를 덧붙임(내용 동일, 바이트 상이)
  for (let i = 0; i < count; i++) {
    fd.append("image", new File([new Uint8Array(Buffer.concat([buf, Buffer.alloc(i)]))], "frame.jpg", { type: "image/jpeg" }));
  }
  for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
  return fd;
}

async function main() {
  const { detectFaces } = await import("../lib/gaonfr");
  const { faceBrightness } = await import("../lib/quality");
  const { analyzeLiveness } = await import("../app/actions/liveness");

  const orig = fs.readFileSync(path.join(process.cwd(), "public", "test-real.jpg"));

  console.log("=== 1) 밝기 측정 (원본 / 50% / 20%) ===");
  const det = await detectFaces(orig);
  if (!det.success || det.faces.length === 0) {
    console.error("얼굴 검출 실패:", det.message);
    process.exit(1);
  }
  const rect = det.faces.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  for (const [label, factor] of [["원본", 1], ["50%", 0.5], ["20%", 0.2]] as const) {
    const buf = factor === 1 ? orig : await darken(orig, factor);
    const b = await faceBrightness(buf, rect);
    console.log(`  ${label}: ${b.ok ? `평균 밝기 ${b.mean.toFixed(1)} (0~255) · ${b.elapsedMs}ms` : `실패 ${b.message}`}`);
  }

  await new Promise((r) => setTimeout(r, 4000)); // 얼굴서버 429 회피
  console.log("=== 2) 서버 액션: 밝기 기준 0(꺼짐) → 정상 판독, brightness 반환 ===");
  const r0 = await analyzeLiveness(makeForm(orig, 3, { minPercent: "30", minBrightness: "0" }));
  console.log(`  ok=${r0.ok} tooDark=${r0.tooDark ?? false} brightness=${r0.brightness?.toFixed(1)} 판독장수=${r0.frames?.length}`);

  await new Promise((r) => setTimeout(r, 4000));
  console.log("=== 3) 서버 액션: 어둡게(20%) + 높은 밝기 기준 → tooDark ===");
  const dark = await darken(orig, 0.2);
  const rd = await analyzeLiveness(makeForm(dark, 3, { minPercent: "30", minBrightness: "120" }));
  console.log(`  ok=${rd.ok} tooDark=${rd.tooDark ?? false} brightness=${rd.brightness?.toFixed(1)} message=${rd.message}`);
}

main().catch((e) => {
  console.error("스크립트 실패:", e);
  process.exit(1);
});
