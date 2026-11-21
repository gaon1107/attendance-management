// 고객사 사용 안내서 **원본 → webapp 안 사본**으로 복사한다. (사장님 승인 2026-11-20)
//
// 왜 사본이 필요한가
//  · 운영 서버로 올라가는 짐 꾸러미는 **webapp 폴더만** 담는다(docker-compose.prod.yml: `build: ./webapp`).
//    docs/ 는 들어가지 않으므로, 화면이 원본(docs/12_안내서)을 그대로 가리키면 **운영 서버에서는 안 열린다.**
//  · 그래서 사본을 webapp/guide-files/ 에 두고 저장소에 함께 넣는다. 화면과 통로는 이 사본만 본다.
//
// 언제 도는가
//  · 개발서버를 켤 때마다 자동(package.json 의 `predev`). 안내서를 다시 구우면 사본도 따라 최신이 된다.
//  · `npm run build` 앞에서도 자동(`prebuild`).
//  · 손으로: webapp 폴더에서  node scripts/sync-guide.mjs
//
// ⚠️ 원본(docs/12_안내서/*.html)과 그것을 굽는 scripts/build-guide.mjs 는 **읽기만** 한다. 고치지 않는다.
// 🔴 원본이 없어도(운영 상자 빌드 안처럼) **오류로 멈추지 않는다.** 이 스크립트가 터지면 사장님의
//    [근태관리 실행] 버튼이 개발서버를 띄우지 못한다 → 무슨 일이 있어도 정상 종료(0)한다.
//    (그래도 파일 자체가 없어지는 경우까지 막으려고 package.json 쪽에 `|| exit 0` 을 한 번 더 뒀다.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// (다른 스크립트들과 같은 방식 — 옛 Node 에서도 동작한다)
const WEBAPP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.resolve(WEBAPP_DIR, "..", "docs", "12_안내서");
const DEST_DIR = path.join(WEBAPP_DIR, "guide-files");
// 사본의 "만든 날짜"를 적어 두는 목록표. 왜 필요한가:
//  🔴 git 은 **파일 시간을 보존하지 않는다.** 운영 서버는 코드를 새로 받아(clone/pull) 상자를 굽기 때문에
//     그 안의 파일 시간은 "서버가 받은 날"이 된다. 파일 시간으로 기준일을 보여 주면 **운영에서만 거짓 날짜**가
//     나온다(개발 PC 에서는 맞아서 눈치채기 어렵다). 그래서 날짜를 이 파일에 적어 **코드와 함께** 보낸다.
const MANIFEST = path.join(DEST_DIR, "manifest.json");
const TMP_PREFIX = ".sync-tmp-";

try {
  if (!fs.existsSync(SRC_DIR)) {
    // 운영 상자 안에서는 정상 상황이다(docs 가 애초에 없다). 저장소에 들어 있는 사본을 그대로 쓴다.
    console.log(`[sync-guide] 안내서 원본 폴더가 없어 건너뜁니다(사본 그대로 사용): ${SRC_DIR}`);
    process.exit(0);
  }
  fs.mkdirSync(DEST_DIR, { recursive: true });

  // 지난번에 복사하다 멈춘 찌꺼기 정리(아래 '덮어쓰다 잘린 파일' 방지용 임시 파일).
  for (const f of fs.readdirSync(DEST_DIR)) {
    if (f.startsWith(TMP_PREFIX)) fs.rmSync(path.join(DEST_DIR, f), { force: true });
  }

  // 🔴 복사 대상을 **목록으로 적지 않고** 원본 폴더의 html 을 전부 가져온다.
  //    목록을 두 곳(여기 + lib/guide.ts)에 적으면 한쪽만 고쳤을 때 복사가 조용히 빠져
  //    화면에서 카드만 사라진다. 적는 곳을 하나로 줄여 그 사고를 없앤다.
  const names = fs.readdirSync(SRC_DIR).filter((f) => f.toLowerCase().endsWith(".html"));
  if (names.length === 0) console.log("[sync-guide] 원본 폴더에 안내서(.html)가 없습니다.");

  // 🔴 기존 목록표를 **이어서** 쓴다. 통째로 새로 쓰면, 원본 폴더는 있는데 html 하나가 잠깐 없는 상태로
  //    돌렸을 때 그 파일의 기록(장 목록·만든 날짜)이 사라진다 → 링크가 맨 위로 가고 기준일이 거짓이 된다(검수 경미 11).
  const manifest = { files: {} };
  //    ⚠️ 단, **사본 폴더에 실제로 남아 있는 파일만** 이어받는다. 안 그러면 이름이 바뀌어 없어진
  //       안내서의 기록이 옛 날짜 그대로 영원히 남는다(재검수 경미 2).
  try {
    const old = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    if (old && typeof old.files === "object") {
      for (const [k, v] of Object.entries(old.files)) {
        if (fs.existsSync(path.join(DEST_DIR, k))) manifest.files[k] = v;
      }
    }
  } catch {
    // 목록표가 아직 없다 — 새로 만든다.
  }
  let copied = 0;
  let same = 0;
  for (const name of names) {
    const src = path.join(SRC_DIR, name);
    const dest = path.join(DEST_DIR, name);
    const s = fs.statSync(src);
    // 🔴 안내서 안에 **어떤 장·어떤 화면이 있는지** 기록해 둔다(<section id="s0">, <figure id="s7-break-time">…).
    //    2026-11-21: 장(s0~s10)만 세던 것을 **화면 단위 표식까지** 넓혔다. 07장에 화면 13개가 들어가면서
    //    장 맨 위로만 보내면 사장님이 스크롤로 자기 화면을 찾아야 했다 — 이제 그 자리로 바로 열린다.
    //    화면별 도움말이 "이 화면은 안내서 05장" 하고 보내는데, 안내서가 바뀌어 그 장이 사라지면
    //    엉뚱한 곳으로 가 버린다. 목록을 적어 두면 없는 장일 때 **그냥 맨 위로** 열 수 있다(무해).
    //    ⚠️ 여기서 읽는 것은 원본이다 — 사본과 내용이 같으므로 결과는 같다.
    const anchors = [...new Set([...fs.readFileSync(src, "utf8").matchAll(/\sid=["'](s[\w-]+)["']/g)].map((m) => m[1]))];
    // 🔴 하나도 못 찾으면 **조용히 넘어가지 않는다.** 안내서 굽는 방식이 바뀌어 장 표시가 달라지면
    //    화면별 도움말의 [그림까지 자세히 보기]가 전부 맨 위로 가는데, 그걸 알아챌 길이 없다(검수 경미 10).
    //    ※ 직원 안내서는 원래 장 구분이 없다 — 그쪽은 정상이다.
    if (anchors.length === 0 && name.includes("사용안내서")) {
      console.warn(`[sync-guide] ⚠️ ${name} 에서 장(id="sN")을 하나도 찾지 못했습니다 — 화면별 도움말 링크가 모두 맨 위로 열립니다.`);
    }
    manifest.files[name] = { bytes: s.size, updatedAt: new Date(s.mtimeMs).toISOString(), anchors };

    if (fs.existsSync(dest)) {
      const d = fs.statSync(dest);
      // 크기와 날짜가 같으면 같은 파일로 본다 — 3MB 를 매번 다시 쓰지 않는다.
      // ⚠️ 1ms 여유를 두는 이유: 아래 utimesSync 가 날짜를 ms 단위로 **반올림**해 저장해서,
      //    딱 맞게 비교하면 영원히 "다르다"가 나와 매번 복사하게 된다(검수 중간 2).
      if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) <= 1) {
        same += 1;
        continue;
      }
    }
    // 🔴 바로 덮어쓰지 않고 **임시 이름으로 쓴 뒤 이름만 바꾼다.** 덮어쓰는 도중에 관리자가 안내서를
    //    열면 **반쯤 잘린 파일**이 내려갈 수 있다. 이름 바꾸기는 한순간에 끝나 그 틈이 없어진다.
    const tmp = path.join(DEST_DIR, TMP_PREFIX + name);
    fs.copyFileSync(src, tmp);
    // 사본의 날짜를 **원본과 같게** 맞춘다(위 '같으면 건너뛴다' 판단의 기준).
    fs.utimesSync(tmp, s.atime, s.mtime);
    fs.renameSync(tmp, dest);
    copied += 1;
    console.log(`[sync-guide] 갱신: ${name} (${(s.size / 1024 / 1024).toFixed(1)}MB)`);
  }

  // 목록표도 같은 방식으로 한순간에 바꿔 쓴다.
  const mtmp = path.join(DEST_DIR, TMP_PREFIX + "manifest.json");
  fs.writeFileSync(mtmp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.renameSync(mtmp, MANIFEST);

  console.log(`[sync-guide] 완료 — 갱신 ${copied} · 그대로 ${same} · 전체 ${names.length}`);
} catch (e) {
  console.warn("[sync-guide] 복사 실패 — 사본을 그대로 두고 계속합니다:", e instanceof Error ? e.message : e);
}
process.exit(0);
