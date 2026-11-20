// 고객사 사용 안내서를 **그림이 들어 있는 HTML 파일 하나**로 굽는다. (2026-11-20 사장님 승인)
//
// 왜 이렇게 하나: 사장님이 고객사에 **메일로 첨부**하거나 **더블클릭**해서 여실 수 있어야 한다.
//   그림을 옆 폴더에 두면 파일 하나만 보냈을 때 그림이 전부 깨진다. 그래서 그림을 HTML 안에 심는다.
//
// 쓰는 법 (webapp 폴더에서):
//   node scripts/build-guide.mjs
//
// 입력:  ../docs/12_안내서/src/*.html  + 같은 폴더의 img/*.webp
// 출력:  ../docs/12_안내서/근태관리_사용안내서.html      (관리자용 — 전체)
//        ../docs/12_안내서/근태관리_직원안내서.html      (직원 배포용 — 휴대폰 사용법만)
//
// ⚠️ 출력 파일을 손으로 고치지 말 것. 다시 구우면 덮어쓴다. 고칠 내용은 src/ 쪽을 고친다.
// ⚠️ 화면이 바뀌면 먼저 `node scripts/make-guide-shots.mjs "<비밀번호>" <출력폴더>` 로 다시 찍고,
//    나온 webp 를 src/img/ 에 덮어쓴 뒤 이 스크립트를 돌린다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDE_DIR = path.resolve(__dirname, "..", "..", "docs", "12_안내서");
const SRC_DIR = path.join(GUIDE_DIR, "src");
const IMG_DIR = path.join(SRC_DIR, "img");

// src 파일 이름 → 내보낼 파일 이름
const TARGETS = [
  ["관리자_사용안내서.html", "근태관리_사용안내서.html"],
  ["직원_사용안내서.html", "근태관리_직원안내서.html"],
];

const MIME = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

/** src="img/파일.webp" 를 그림이 통째로 들어간 data: 주소로 바꾼다. */
function inlineImages(html, stats) {
  return html.replace(/src="img\/([^"]+)"/g, (whole, file) => {
    const full = path.join(IMG_DIR, decodeURIComponent(file));
    if (!fs.existsSync(full)) {
      // 🔴 조용히 넘어가면 **그림이 빠진 안내서**가 고객사에 가게 된다. 바로 멈춘다.
      throw new Error(`그림을 찾을 수 없습니다: ${full}`);
    }
    const buf = fs.readFileSync(full);
    stats.count += 1;
    stats.bytes += buf.length;
    const mime = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
    return `src="data:${mime};base64,${buf.toString("base64")}"`;
  });
}

/** 🔴 loading="lazy" 를 뗀다.
 *  그림이 파일 안에 들어 있어 **받아올 것이 없으므로 미루는 이득이 0**인데,
 *  미뤄 두면 인쇄하거나 빠르게 훑어 내릴 때 **빈칸으로 찍히는** 쪽만 남는다.
 *  (원본 src/ 에는 남겨 둔다 — 그쪽은 그림을 파일로 따로 읽어 오므로 lazy 가 실제로 이득이다.) */
function dropLazy(html) {
  return html.replace(/\s+loading="lazy"/g, "");
}

/** 브라우저가 바로 열 수 있게 겉껍데기를 씌운다.
 *  ⚠️ charset 이 없으면 더블클릭으로 열었을 때 **한글이 깨질 수 있다**. 반드시 맨 앞에 둔다. */
function wrap(inner) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${inner}
</html>
`;
}

let total = 0;
for (const [srcName, outName] of TARGETS) {
  const srcPath = path.join(SRC_DIR, srcName);
  if (!fs.existsSync(srcPath)) throw new Error(`원본이 없습니다: ${srcPath}`);
  const stats = { count: 0, bytes: 0 };
  const out = wrap(dropLazy(inlineImages(fs.readFileSync(srcPath, "utf8"), stats)));
  const outPath = path.join(GUIDE_DIR, outName);
  fs.writeFileSync(outPath, out, "utf8");
  const mb = Math.round((Buffer.byteLength(out) / 1024 / 1024) * 10) / 10;
  total += Buffer.byteLength(out);
  console.log(`✔ ${outName}  — 그림 ${stats.count}장 포함 · ${mb}MB`);
}
console.log(`\n출력 폴더: ${GUIDE_DIR}`);
console.log(`합계 ${Math.round((total / 1024 / 1024) * 10) / 10}MB — 메일 첨부로 보낼 수 있는 크기입니다.`);
