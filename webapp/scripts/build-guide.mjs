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

/** src="img/파일.webp" 를 그림이 통째로 들어간 data: 주소로 바꾼다.
 *  홑따옴표·`./img/` 같은 변형도 함께 받는다(안 받으면 그림만 조용히 빠진다). */
function inlineImages(html, stats, used) {
  const out = html.replace(/(src|href)=(["'])\.?\/?img\/([^"']+)\2/g, (whole, attr, q, file) => {
    let name = file;
    try {
      name = decodeURIComponent(file);
    } catch {
      // 파일명에 % 가 들어 있으면 디코딩이 터진다 — 원문 그대로 쓴다.
    }
    const full = path.join(IMG_DIR, name);
    if (!fs.existsSync(full)) {
      // 🔴 조용히 넘어가면 **그림이 빠진 안내서**가 고객사에 가게 된다. 바로 멈춘다.
      throw new Error(`그림을 찾을 수 없습니다: ${full}`);
    }
    const buf = fs.readFileSync(full);
    stats.count += 1;
    stats.bytes += buf.length;
    used.add(name);
    const mime = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
    return `${attr}="data:${mime};base64,${buf.toString("base64")}"`;
  });
  // 🔴 바꾸지 못하고 남은 img/ 참조가 있으면 그 그림은 **고객 화면에서 깨진다**. 멈춘다.
  const left = out.match(/["'(]\.?\/?img\//);
  if (left) throw new Error(`심지 못한 그림 참조가 남았습니다: ${out.slice(Math.max(0, out.indexOf(left[0]) - 60), out.indexOf(left[0]) + 60)}`);
  return out;
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
  // 고객사에 가는 문서이므로 아티팩트 전용 meta 는 뺀다.
  const body = inner.replace(/^\s*<meta name="claude:[^>]*>\s*$/gm, "").trim();
  // ⚠️ </head><body> 를 생략하면 브라우저는 보정해 주지만 **메일 미리보기·PDF 변환기**가 어긋날 수 있다.
  //    <style> 까지가 머리, 그 뒤가 몸이다.
  const cut = body.lastIndexOf("</style>");
  const head = cut >= 0 ? body.slice(0, cut + 8) : "";
  const rest = cut >= 0 ? body.slice(cut + 8) : body;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${rest}
</body>
</html>
`;
}

// 🔴 **전부 만든 뒤에 한꺼번에 저장한다.**
//    하나 쓰고 다음을 검사하면, 둘째에서 멈출 때 "새 관리자용 + 옛 직원용"이 섞인 채 남고
//    사장님은 그걸 모른 채 둘 다 보내게 된다.
const built = [];
const used = new Set();
for (const [srcName, outName] of TARGETS) {
  const srcPath = path.join(SRC_DIR, srcName);
  if (!fs.existsSync(srcPath)) throw new Error(`원본이 없습니다: ${srcPath}`);
  const stats = { count: 0, bytes: 0 };
  // dropLazy 를 먼저 — 그림을 심은 뒤면 2MB짜리 base64 를 통째로 훑게 된다.
  const out = wrap(inlineImages(dropLazy(fs.readFileSync(srcPath, "utf8")), stats, used));
  built.push({ outName, out, stats });
}

let total = 0;
for (const { outName, out, stats } of built) {
  fs.writeFileSync(path.join(GUIDE_DIR, outName), out, "utf8");
  const mb = Math.round((Buffer.byteLength(out) / 1024 / 1024) * 10) / 10;
  total += Buffer.byteLength(out);
  console.log(`✔ ${outName}  — 그림 ${stats.count}장 포함 · ${mb}MB`);
}

// 찍어 두고 **어느 안내서에도 안 실린 그림**을 알려 준다. 조용히 빠지면 아무도 모른다.
const unused = fs.readdirSync(IMG_DIR).filter((f) => /\.(webp|png|jpe?g|svg)$/i.test(f) && !used.has(f));
if (unused.length) {
  console.log(`\n⚠ 안내서에 안 쓰인 그림 ${unused.length}장: ${unused.join(", ")}`);
  console.log("  의도한 것이면 그대로 두셔도 됩니다. 빠뜨린 것이면 src/ 의 HTML 에 넣어 주세요.");
}

console.log(`\n출력 폴더: ${GUIDE_DIR}`);
console.log(`합계 ${Math.round((total / 1024 / 1024) * 10) / 10}MB — 메일 첨부로 보낼 수 있는 크기입니다.`);
