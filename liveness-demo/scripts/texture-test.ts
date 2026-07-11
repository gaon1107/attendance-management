// [검증 스크립트] 질감 점수 실측 — public/test-real.jpg(진짜) vs test-fake.jpg(위조)
// 실행: npx -y tsx scripts/texture-test.ts
// .env(FACE_*)를 읽어 얼굴서버로 얼굴 위치를 찾은 뒤, lib/texture.ts 점수를 출력한다.
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

async function main() {
  const { detectFaces, isConfigured } = await import("../lib/gaonfr");
  const { textureScore } = await import("../lib/texture");
  const { analyzeFace } = await import("../lib/liveness");

  if (!isConfigured()) {
    console.error("얼굴서버 설정(.env FACE_*)이 없습니다.");
    process.exit(1);
  }

  for (const name of ["test-real.jpg", "test-fake.jpg"]) {
    const file = path.join(process.cwd(), "public", name);
    const buf = fs.readFileSync(file);
    // 얼굴서버 429(요청 폭주) 대비 — 실패 시 3초 쉬고 최대 3회 재시도
    let det = await detectFaces(buf);
    for (let retry = 0; retry < 3 && !det.success; retry++) {
      await new Promise((r) => setTimeout(r, 3000));
      det = await detectFaces(buf);
    }
    if (!det.success || det.faces.length === 0) {
      console.error(`${name}: 얼굴 검출 실패 — ${det.message ?? "얼굴 없음"}`);
      continue;
    }
    const rect = det.faces.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    const tex = await textureScore(buf, rect);
    const lv = await analyzeFace(buf, rect);
    console.log(`\n=== ${name} ===`);
    console.log(`이미지 ${det.imageSize?.width}x${det.imageSize?.height}, 얼굴 ${rect.width}x${rect.height} @ (${rect.x},${rect.y})`);
    if (tex.ok) {
      console.log(`질감 점수(피크 배율): ${tex.score} · 뚜렷한 피크 ${tex.peakCount}개 · 분석창 ${tex.window}px · ${tex.elapsedMs}ms`);
    } else {
      console.log(`질감 분석 실패: ${tex.message}`);
    }
    if (lv.ok && lv.models) {
      console.log(`(참고) 판독 AI: ${lv.models.map((m) => `${m.name}=${(m.realProb * 100).toFixed(1)}%`).join(", ")} · 평균 ${(lv.realScore! * 100).toFixed(1)}%`);
    }
  }
}

main().catch((e) => {
  console.error("스크립트 실패:", e);
  process.exit(1);
});
