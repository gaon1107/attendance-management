// [검증 스크립트] 다중 프레임 서버 액션 실행 테스트
// 실행: npx -y tsx scripts/multiframe-test.ts
// 같은 이미지를 3장으로 넣어 ① 3장 판독 ② 1장 판독(기존 호환) ③ 4장 거절 ④ 크기 미달 경로를 확인한다.
import fs from "fs";
import path from "path";

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

// 실제 웹캠은 장마다 바이트가 미세하게 다르다(센서 노이즈). 이를 흉내 내기 위해
// JPEG 끝(EOI) 뒤에 무해한 여분 바이트를 붙여 "내용은 같지만 바이트는 다른" 프레임을 만든다.
function makeForm(buf: Buffer, count: number, minPercent?: number, identical = false): FormData {
  const fd = new FormData();
  for (let i = 0; i < count; i++) {
    const b = identical ? buf : Buffer.concat([buf, Buffer.alloc(i)]);
    fd.append("image", new File([new Uint8Array(b)], "frame.jpg", { type: "image/jpeg" }));
  }
  if (minPercent !== undefined) fd.append("minPercent", String(minPercent));
  return fd;
}

async function main() {
  const { analyzeLiveness } = await import("../app/actions/liveness");
  const buf = fs.readFileSync(path.join(process.cwd(), "public", "test-real.jpg"));

  console.log("--- ① 3장 판독 (기본 기준 30%) ---");
  const r3 = await analyzeLiveness(makeForm(buf, 3));
  console.log(JSON.stringify({ ok: r3.ok, message: r3.message, faceCount: r3.faceCount, facePercent: r3.facePercent?.toFixed(1), detectMs: r3.detectMs, livenessMs: r3.livenessMs, frames: r3.frames?.map((f) => ({ realScore: +(f.realScore * 100).toFixed(1), tex: f.texture?.score, texMs: f.textureMs, lvMs: f.livenessMs })) }, null, 2));

  await new Promise((r) => setTimeout(r, 4000)); // 얼굴서버 연속 호출 제한(429) 회피
  console.log("--- ② 1장 판독 (기존 단일 호환) ---");
  const r1 = await analyzeLiveness(makeForm(buf, 1));
  console.log(JSON.stringify({ ok: r1.ok, message: r1.message, realScore: r1.realScore != null ? +(r1.realScore * 100).toFixed(1) : null, frameCount: r1.frames?.length }, null, 2));

  console.log("--- ③ 4장 → 거절되어야 함 (서버 호출 없이 즉시) ---");
  const r4 = await analyzeLiveness(makeForm(buf, 4));
  console.log(JSON.stringify({ ok: r4.ok, message: r4.message }));

  await new Promise((r) => setTimeout(r, 4000));
  console.log("--- ④ 크기 미달(기준 50%) → tooSmall이어야 함 ---");
  const rs = await analyzeLiveness(makeForm(buf, 3, 50));
  console.log(JSON.stringify({ ok: rs.ok, tooSmall: rs.tooSmall, facePercent: rs.facePercent?.toFixed(1), minPercent: rs.minPercent, message: rs.message }));

  console.log("--- ⑤ 동일 바이트 3장 → 거절되어야 함 (서버 호출 없이 즉시) ---");
  const ri = await analyzeLiveness(makeForm(buf, 3, undefined, true));
  console.log(JSON.stringify({ ok: ri.ok, message: ri.message }));
}

main().catch((e) => {
  console.error("스크립트 실패:", e);
  process.exit(1);
});
