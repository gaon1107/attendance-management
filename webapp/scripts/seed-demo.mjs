// 홍보용 캡처를 위한 **데모 회사** 데이터 만들기 / 지우기 — 서버에서 직접 실행하는 명령이다.
//
// 왜 만들었나 (2026-08-23 사장님 승인):
//   홈화면(랜딩)에 넣을 제품 화면을 캡처해야 하는데, 지금 DB의 회사들은 출퇴근 기록이 49건뿐이라
//   어느 화면을 찍어도 `0명 / 0분 / 기록이 없습니다`만 나온다. 캡처를 찍을 수 있게 데이터를 채운다.
//
// 사용법 (webapp 폴더에서):
//   node scripts/seed-demo.mjs "<관리자 비밀번호>"   ← 만들기 (이미 있으면 지우고 다시 만든다)
//   node scripts/seed-demo.mjs --undo               ← 이 데모 회사가 만든 것 **전부** 지우기
//   node scripts/seed-demo.mjs --check              ← 지금 들어 있는 양만 세어 보기(아무것도 바꾸지 않음)
//
// 🔴 반드시 지킨 것 (고치기 전에 반드시 읽을 것)
//  ① **isDemo = true.** 홈화면의 "가입한 회사 N개사 / 직원 N명"은 진짜 DB를 센다(lib/public-stats.ts).
//     이 값이 false면 데모 회사가 실고객으로 집계되어 **표시광고법상 허위표시**가 된다.
//  ② **다른 회사는 건드리지 않는다.** 이 파일의 모든 조회·삭제는 아래 COMPANY_NAME 으로 찾은
//     회사 하나의 id 로만 좁힌다. 회사 id 조건 없는 delete 를 **절대** 쓰지 말 것.
//  ③ **비밀번호를 파일에 적지 않는다**(사규 8). 실행할 때 인자로 받고, 해시는 앱과 같은
//     lib/password.ts 의 hashPassword 를 그대로 쓴다(직접 구현하면 로그인 안 되는 계정이 생긴다).
//  ④ **원시 SQL을 쓰지 않는다.** 이 저장소는 날짜를 정수(ms)로 저장한다 — SQL에 CURRENT_TIMESTAMP 를
//     쓰면 형식이 어긋나 화면에서 날짜가 깨진다. 전부 Prisma 클라이언트로 넣는다.
//  ⑤ **스키마를 바꾸지 않는다.** 기존 표에 행만 넣는다(마이그레이션 없음).
//
// 🔴 캡처에 **빨간 경고가 찍히지 않게** 맞춘 숫자 두 개 — 바꿀 때 함께 확인할 것
//  · 회사 가입일 = 오늘 - SIGNUP_DAYS_AGO(22일). 30일이 지나면 대시보드 맨 위에
//    "30일 무료 체험이 끝났습니다" **빨간 띠**가 뜬다(lib/trial.ts). 22일이면 "8일 남음"(파란 띠)이다.
//    ⚠️ 7일 이하가 되면 주황 띠로 바뀐다. 22~23일 사이를 유지할 것.
//  · 주간 실근무 합계 ≤ WEEK_CAP_HOURS(46시간). 회사 경고선이 48시간이라 넘으면 노랑/빨강
//    초과근무 배지가 화면에 붙는다(Company.overtimeWarnHours). 아래 capWeeklyHours() 가 강제로 맞춘다.
//
// ⚠️ 출퇴근 기록은 **회사 가입일 이후**만 만든다. 가입 전 날짜에 근무 기록이 있으면 앞뒤가 안 맞는다.
// ⚠️ 얼굴 사진(ClockPhoto)은 만들지 않는다 — 실제 암호화 파일이 있어야 동작하고, 생체정보라
//    가짜로 채우면 안 된다.
// ⚠️ 이메일 도메인은 `.example` — RFC 2606이 예약해 둔, **실제로 존재할 수 없는** 도메인이다.
//    실존 회사 도메인을 쓰면 홍보 캡처에 남의 회사 주소가 박힌다.
import { PrismaClient } from "@prisma/client";

// 앱과 **같은** 암호화 함수를 쓴다. (create-operator.mjs 와 같은 이유·같은 방식)
let hashPassword;
try {
  ({ hashPassword } = await import("../lib/password.ts"));
} catch (e) {
  console.error("✖ 앱 코드(lib/password.ts)를 불러오지 못했습니다.");
  console.error("  Node 22.6 이상에서만 .ts 를 그대로 불러올 수 있습니다. 현재:", process.version);
  console.error("  원인:", e?.message);
  process.exit(1);
}

const prisma = new PrismaClient();

// ── 이 데모 회사를 알아보는 유일한 표식 ────────────────────────────────
// 삭제는 전부 "이 이름 + isDemo=true" 로 찾은 회사 하나의 id 로만 좁힌다.
const COMPANY_NAME = "주식회사 한빛솔루션";
const EMAIL_DOMAIN = "hanbit.example";

const SIGNUP_DAYS_AGO = 22; // 위 주석 참고 — 30일 넘기면 빨간 띠
const WEEK_CAP_HOURS = 46; // 위 주석 참고 — 48시간 넘기면 초과근무 경고 배지
const DAY_MS = 24 * 60 * 60 * 1000;

// ── 되풀이해도 같은 결과가 나오게(고정 씨앗 난수) ──────────────────────
// Math.random 을 쓰면 돌릴 때마다 숫자가 달라져서, 캡처를 다시 찍을 때 화면이 바뀐다.
let _seed = 20260823;
function rnd() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ── 사람·조직 (전부 가공. 실존 인물·거래처 아님) ───────────────────────
const DEPTS = ["경영지원팀", "영업팀", "개발팀", "디자인팀"];
const GRADES = [
  { name: "사원", level: 1 },
  { name: "대리", level: 2 },
  { name: "과장", level: 3 },
  { name: "팀장", level: 4 },
];
const PEOPLE = [
  { name: "김서준", dept: "경영지원팀", grade: "팀장", role: "admin", auth: "face" },
  { name: "서준혁", dept: "경영지원팀", grade: "대리", role: "employee", auth: "gps" },
  { name: "정민재", dept: "영업팀", grade: "과장", role: "employee", auth: "face" },
  { name: "한소영", dept: "영업팀", grade: "사원", role: "employee", auth: "gps" },
  { name: "문예린", dept: "영업팀", grade: "사원", role: "employee", auth: "face" },
  { name: "박도현", dept: "개발팀", grade: "과장", role: "employee", auth: "face" },
  { name: "이수민", dept: "개발팀", grade: "대리", role: "employee", auth: "gps" },
  { name: "오지훈", dept: "개발팀", grade: "사원", role: "employee", auth: "face" },
  { name: "최윤아", dept: "디자인팀", grade: "대리", role: "employee", auth: "face" },
  { name: "임채원", dept: "디자인팀", grade: "사원", role: "employee", auth: "gps" },
];
// 이메일 아이디 — 이름과 짝이 맞게 손으로 적는다(자동 변환하면 겹칠 수 있다).
const EMAIL_ID = ["seojun.kim", "junhyuk.seo", "minjae.jung", "soyoung.han", "yerin.moon",
  "dohyun.park", "sumin.lee", "jihoon.oh", "yuna.choi", "chaewon.lim"];

/** 그 날의 자정(로컬). 서버 TZ=Asia/Seoul 전제(저장소 관례). */
function midnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
/** "YYYY-MM-DD" (KST 기준 로컬 날짜). Holiday 표가 이 형식이다. */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** 그 날 h시 m분 */
function at(day, h, m) {
  const x = midnight(day);
  x.setHours(h, m, randInt(0, 59), 0);
  return x;
}

// ══════════════════════════════════════════════════════════════════════
// 삭제 — 이 데모 회사 하나만
// ══════════════════════════════════════════════════════════════════════
async function findDemo() {
  return prisma.company.findFirst({ where: { name: COMPANY_NAME, isDemo: true }, select: { id: true, name: true } });
}

async function removeDemo(quiet = false) {
  const c = await findDemo();
  if (!c) {
    if (!quiet) console.log("· 지울 데모 회사가 없습니다(이미 깨끗함).");
    return false;
  }
  const companyId = c.id;
  const users = await prisma.user.findMany({ where: { companyId }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const atts = await prisma.attendance.findMany({ where: { companyId }, select: { id: true } });
  const attIds = atts.map((a) => a.id);

  // 순서가 중요하다 — 참조하는 쪽부터 지운다(외래키).
  // ⚠️ 모든 조건에 companyId(또는 그 회사 소속 id 목록)가 들어 있는지 확인할 것.
  await prisma.break.deleteMany({ where: { attendanceId: { in: attIds } } });
  await prisma.clockPhoto.deleteMany({ where: { companyId } });
  await prisma.attendance.deleteMany({ where: { companyId } });
  await prisma.leaveRequest.deleteMany({ where: { companyId } });
  await prisma.announcement.deleteMany({ where: { companyId } });
  await prisma.attendanceCorrection.deleteMany({ where: { companyId } });
  await prisma.outingRequest.deleteMany({ where: { companyId } });
  await prisma.remoteWorkRequest.deleteMany({ where: { companyId } });
  await prisma.overtimeRequest.deleteMany({ where: { companyId } });
  await prisma.businessTripRequest.deleteMany({ where: { companyId } });
  await prisma.companyHoliday.deleteMany({ where: { companyId } });
  await prisma.companyEvent.deleteMany({ where: { companyId } });
  await prisma.accessEvent.deleteMany({ where: { companyId } });
  await prisma.invite.deleteMany({ where: { companyId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetRequest.deleteMany({ where: { companyId } });
  // 부서가 직원을 부서장으로 가리키고 있으면 직원을 못 지운다 → 먼저 끊는다.
  await prisma.department.updateMany({ where: { companyId }, data: { headUserId: null, deputyUserId: null } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.department.deleteMany({ where: { companyId } });
  await prisma.jobGrade.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  if (!quiet) console.log(`· 데모 회사 "${c.name}" 및 딸린 데이터를 모두 지웠습니다.`);
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// 만들기
// ══════════════════════════════════════════════════════════════════════
async function seed(password) {
  const now = new Date();
  const signedUp = midnight(new Date(now.getTime() - SIGNUP_DAYS_AGO * DAY_MS));
  signedUp.setHours(10, 12, 0, 0);

  // 이미 있으면 지우고 다시 만든다(같은 결과가 두 벌 생기지 않게).
  await removeDemo(true);

  const company = await prisma.company.create({
    data: {
      name: COMPANY_NAME,
      isDemo: true, // 🔴 홈화면 공개 통계에서 제외 — 위 불변식 ① 참고
      createdAt: signedUp,
      workStartTime: "09:00",
      workEndTime: "18:00",
      lateGraceMin: 10,
      standardWorkHours: 8,
      workDays: "1,2,3,4,5",
      overtimeAlertOn: true,
      overtimeWarnHours: 48,
      // 사업장 위치 — 안 채우면 [현황판] 지도가 비어 보인다.
      officeAddress: "서울특별시 강남구 테헤란로 152",
      officeAddressDetail: "9층",
      officeLat: 37.500622,
      officeLng: 127.036456,
      officeRadiusM: 150,
      // ⚠️ 사내 네트워크 IP를 비워 두면 [현황판]의 접속 칸이 전부 **"판정 불가(IP 미설정)"** 로 뜬다
      //    (2026-08-23 실측: 20건이 판정 불가로 찍혀 홍보 캡처에 결함처럼 보였다).
      //    아래 203.0.113.0/24 는 RFC 5737이 문서·예시용으로 예약한 대역이라 실존 회사 IP와 겹치지 않는다.
      officeIps: "203.0.113.",
    },
  });
  const companyId = company.id;

  const deptRows = {};
  for (const name of DEPTS) {
    deptRows[name] = await prisma.department.create({ data: { companyId, name, createdAt: signedUp } });
  }
  const gradeRows = {};
  for (const g of GRADES) {
    gradeRows[g.name] = await prisma.jobGrade.create({ data: { companyId, name: g.name, level: g.level, createdAt: signedUp } });
  }

  const passwordHash = await hashPassword(password);
  const users = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    const u = await prisma.user.create({
      data: {
        companyId,
        email: `${EMAIL_ID[i]}@${EMAIL_DOMAIN}`,
        passwordHash,
        name: p.name,
        role: p.role,
        departmentId: deptRows[p.dept].id,
        jobGradeId: gradeRows[p.grade].id,
        position: p.grade,
        employeeNo: `H${String(1001 + i)}`,
        authMethod: p.auth,
        // 얼굴 선택자는 동의·등록까지 마친 상태로 둔다(화면에 "미등록"만 뜨지 않게).
        // ※ 실제 얼굴 데이터는 만들지 않는다 — 이건 "등록했다"는 참조 표시뿐이다(schema 주석 참고).
        faceConsentAt: p.auth === "face" ? signedUp : null,
        faceEnrolledAt: p.auth === "face" ? signedUp : null,
        faceEnrollCount: p.auth === "face" ? 3 : 0,
        hireDate: midnight(new Date(signedUp.getTime() - randInt(200, 1500) * DAY_MS)),
        createdAt: signedUp,
        tourSeenAt: signedUp, // 온보딩 투어가 캡처 위에 뜨지 않게
        noticesSeenAt: signedUp,
      },
    });
    users.push({ ...p, id: u.id, email: u.email });
  }
  // 부서장 지정(결재선이 "관리자 폴백"으로만 보이지 않게)
  await prisma.department.update({ where: { id: deptRows["경영지원팀"].id }, data: { headUserId: users[0].id } });
  await prisma.department.update({ where: { id: deptRows["영업팀"].id }, data: { headUserId: users[2].id } });
  await prisma.department.update({ where: { id: deptRows["개발팀"].id }, data: { headUserId: users[5].id } });
  await prisma.department.update({ where: { id: deptRows["디자인팀"].id }, data: { headUserId: users[8].id } });

  // ── 휴가 5건 (승인 3 · 대기 2) ─────────────────────────────────────
  const dayOf = (offset) => midnight(new Date(now.getTime() + offset * DAY_MS));
  const leaves = [
    { u: 3, type: "annual", from: -9, to: -9, days: 1, status: "approved", reason: "개인 사유" },
    { u: 7, type: "annual", from: -5, to: -4, days: 2, status: "approved", reason: "가족 여행" },
    { u: 4, type: "half_am", from: -3, to: -3, days: 0.5, status: "approved", reason: "병원 진료" },
    { u: 6, type: "annual", from: 4, to: 4, days: 1, status: "pending", reason: "개인 사유" },
    { u: 9, type: "annual", from: 8, to: 9, days: 2, status: "pending", reason: "가족 행사" },
  ];
  const leaveDays = new Map(); // userId -> Set("YYYY-MM-DD")  (승인된 휴가일엔 출근 기록을 만들지 않는다)
  for (const l of leaves) {
    const user = users[l.u];
    await prisma.leaveRequest.create({
      data: {
        companyId, userId: user.id, type: l.type,
        startDate: dayOf(l.from), endDate: dayOf(l.to), days: l.days,
        reason: l.reason, status: l.status,
        decidedAt: l.status === "approved" ? new Date(dayOf(l.from).getTime() - DAY_MS) : null,
        decidedById: l.status === "approved" ? users[0].id : null,
        createdAt: new Date(dayOf(l.from).getTime() - 3 * DAY_MS),
      },
    });
    // 반차(half_am)는 반나절만 쉬므로 출근 기록을 지우지 않는다.
    if (l.status === "approved" && l.type === "annual") {
      if (!leaveDays.has(user.id)) leaveDays.set(user.id, new Set());
      for (let o = l.from; o <= l.to; o++) leaveDays.get(user.id).add(isoDate(dayOf(o)));
    }
  }

  // ── 공지 2건 ──────────────────────────────────────────────────────
  await prisma.announcement.create({
    data: {
      companyId, title: "9월 정기 안전교육 일정 안내",
      body: "9월 4일(금) 오후 2시, 9층 대회의실에서 정기 안전교육을 진행합니다. 전 직원 참석 대상이며, 부득이한 사유로 참석이 어려운 경우 경영지원팀으로 미리 알려주세요.",
      authorName: users[0].name, createdAt: new Date(now.getTime() - 2 * DAY_MS),
    },
  });
  await prisma.announcement.create({
    data: {
      companyId, title: "여름 휴가 신청 마감 안내",
      body: "8월 휴가 신청은 8월 25일(화)까지 마감합니다. 팀별 일정이 겹치지 않도록 팀장님과 조율 후 신청해 주세요.",
      authorName: users[0].name, createdAt: new Date(now.getTime() - 6 * DAY_MS),
    },
  });

  // ── 출퇴근 기록 ────────────────────────────────────────────────────
  // 회사 가입일 다음 날부터 **오늘까지**. 주말·공휴일·승인된 연차는 건너뛴다.
  const holidays = new Set(
    (await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date),
  );
  const workDaySet = new Set([1, 2, 3, 4, 5]);
  const days = [];
  for (let o = -(SIGNUP_DAYS_AGO - 1); o <= 0; o++) {
    const d = dayOf(o);
    // 오늘은 요일과 무관하게 포함한다 — 캡처의 핵심인 "지금 근무 중" 숫자가 0이 되면 안 된다.
    if (o !== 0 && (!workDaySet.has(d.getDay()) || holidays.has(isoDate(d)))) continue;
    days.push({ date: d, offset: o });
  }

  // 지각을 넣을 자리 4곳(사람·날짜)을 미리 정해 둔다 — 전원이 정시면 한눈에 가짜로 보인다.
  const lateSlots = new Set(["1|-14", "5|-8", "3|-5", "8|-2"]);
  // 결근 2건(무단결근이 아니라 "기록 없음")
  const absentSlots = new Set(["9|-11", "2|-6"]);

  const created = []; // { id, userId, dateKey, inAt, outAt }
  for (const { date, offset } of days) {
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const key = `${i}|${offset}`;
      if (absentSlots.has(key)) continue;
      if (leaveDays.get(u.id)?.has(isoDate(date))) continue;

      const late = lateSlots.has(key);
      const inAt = late ? at(date, 9, randInt(14, 27)) : at(date, 8, randInt(38, 59));
      if (!late && rnd() < 0.35) inAt.setHours(9, randInt(0, 8), randInt(0, 59), 0);

      // 근무형태 — 사무실 80% · 재택 15% · 외근 5%
      // ⚠️ **오늘치만 사람별로 못 박는다.** [현황판]의 "사무실 N · 재택 N · 외근 N"이 캡처의 핵심인데,
      //    난수로 두면 그날 우연히 재택 0명·외근 0명이 나온다(2026-08-23 실제로 그렇게 찍혔다).
      //    이 제품이 파는 것이 바로 그 세 가지 구분이라 0이 뜨면 안 된다.
      const r = rnd();
      const workMode = offset === 0
        ? (i <= 6 ? "office" : i <= 8 ? "home" : "field")
        : r < 0.8 ? "office" : r < 0.95 ? "home" : "field";
      // 위치 확인 결과는 사무실 출근에만 의미가 있다(재택·외근은 null = 해당 없음).
      // ⚠️ "확인 불가"(unavailable)는 만들지 않는다. 실제 서비스에선 실내 GPS 오차로 흔한 값이지만,
      //    홍보 화면에 주황색 "위치 확인 불가" 배지가 뜨면 **제품 결함처럼 읽힌다**(2026-08-23 캡처에서 확인).
      const locationStatus = workMode !== "office" ? null : "verified";

      let outAt = null;
      if (offset === 0) {
        // 오늘 — 대부분은 아직 근무 중(퇴근 null)이어야 [현황판]·[대시보드]가 채워진다.
        // ⚠️ 먼저 퇴근시키는 사람은 **사무실 근무자 중에서** 고른다. 재택·외근인 사람을 퇴근시키면
        //    위에서 애써 맞춘 "재택 N · 외근 N"이 다시 0이 된다(둘은 짝이다).
        if ((i === 1 || i === 5) && now.getHours() >= 17) outAt = at(date, 17, randInt(30, 55));
      } else {
        // ⚠️ 퇴근은 **기준 퇴근시각(18:00) 이후**로만 만든다. 1분이라도 빠르면 "조퇴" 배지가 붙는다
        //    (2026-08-23 실측: 17:52 퇴근을 섞었더니 한 주에 조퇴 6건이 찍혔다).
        outAt = at(date, 18, randInt(2, 45));
        if (rnd() < 0.12) outAt = at(date, 19, randInt(0, 20));
      }

      const a = await prisma.attendance.create({
        data: { userId: u.id, companyId, clockIn: inAt, clockOut: outAt, workMode, locationStatus, createdAt: inAt },
      });
      created.push({ id: a.id, userId: u.id, userIdx: i, dateKey: isoDate(date), inAt, outAt, workMode });
    }
  }

  // ── 🔴 점심시간을 외출로 기록한다 (전 기록) ─────────────────────────
  //  이걸 빼면 09시 출근·18시 퇴근이 **실근무 9시간**으로 잡혀, 기준 8시간을 넘긴 1시간이
  //  매일 초과근무로 쌓인다 → [근태 리포트]에 전 직원 주황색 "초과근무 18시간"이 뜬다.
  //  근로기준법 준수를 파는 제품의 홍보 화면에 그게 찍히면 자기모순이다(2026-08-23 실측으로 확인).
  //  이 제품은 점심을 외출(Break)로 빼는 설계다 — 화면 안내문도 "실근무 = (퇴근−출근) − 외출".
  for (const c of created) {
    const start = midnight(c.inAt);
    start.setHours(12, randInt(0, 10), 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    if (start <= c.inAt) continue;
    if (c.outAt && end >= c.outAt) continue;
    if (!c.outAt && start > now) continue; // 아직 점심 전인 "근무 중" 기록
    await prisma.break.create({
      data: { attendanceId: c.id, reason: "식사", startAt: start, endAt: end, createdAt: start },
    });
  }

  // ── 그 밖의 외출 6건(점심과 겹치지 않게 오후로) ─────────────────────
  const withOut = created.filter((c) => c.outAt);
  for (let n = 0; n < 6 && withOut.length; n++) {
    const c = withOut[Math.floor(rnd() * withOut.length)];
    const start = new Date(midnight(c.inAt).getTime());
    start.setHours(randInt(14, 15), randInt(0, 55), 0, 0);
    if (start <= c.inAt || start >= c.outAt) continue;
    const end = new Date(start.getTime() + randInt(30, 50) * 60 * 1000);
    if (end >= c.outAt) continue;
    await prisma.break.create({
      data: { attendanceId: c.id, reason: pick(["개인용무", "외근"]), startAt: start, endAt: end, createdAt: start },
    });
  }

  // ── 일정 (대시보드 달력이 텅 비어 보이지 않게) ──────────────────────
  const events = [
    { off: -8, title: "월례 전체회의", color: "#2563EB" },
    { off: -2, title: "3분기 실적 점검", color: "#7C3AED" },
    { off: 3, title: "신규 입사자 오리엔테이션", color: "#0891B2" },
    { off: 6, title: "사내 안전교육", color: "#059669" },
    { off: 12, title: "창립기념 워크숍", color: "#DB2777" },
  ];
  for (const e of events) {
    // ⚠️ 주말·공휴일에 회의 일정이 찍히면 앞뒤가 안 맞는다(실측: "월례 전체회의"가 광복절에 걸렸다).
    //    평일이 될 때까지 하루씩 앞으로 당긴다.
    let d = dayOf(e.off);
    for (let guard = 0; guard < 7; guard++) {
      if (workDaySet.has(d.getDay()) && !holidays.has(isoDate(d))) break;
      d = new Date(d.getTime() - DAY_MS);
    }
    await prisma.companyEvent.create({
      data: { companyId, userId: null, date: isoDate(d), title: e.title, color: e.color, createdBy: users[0].name },
    });
  }

  // ── 접속 기록 (현황판의 "오늘 접속 0건"을 채운다) ───────────────────
  //  ⚠️ 로그인 성공 기록만 만든다. 실패·차단 기록을 만들면 [보안] 화면에 경고가 뜬다.
  for (const c of created.filter((x) => isoDate(x.inAt) === isoDate(now))) {
    const u = users[c.userIdx];
    await prisma.accessEvent.create({
      data: {
        companyId, userId: u.id, actorName: u.name, emailTried: u.email,
        kind: "login", result: "success", ip: "203.0.113.20",
        device: pick(["Windows PC", "Mac", "iPhone", "Android"]),
        createdAt: new Date(c.inAt.getTime() - randInt(1, 8) * 60 * 1000),
      },
    });
    await prisma.accessEvent.create({
      data: {
        companyId, userId: u.id, actorName: u.name,
        kind: "clock_in", result: "success", ip: "203.0.113.20", meta: c.workMode ?? "office",
        createdAt: c.inAt,
      },
    });
  }

  // ── 🔴 주간 실근무 상한 강제 ───────────────────────────────────────
  await capWeeklyHours(companyId);

  return { company, users };
}

/**
 * 주(월~일)별 실근무 합계가 WEEK_CAP_HOURS 를 넘으면 그 주에서 가장 긴 날의 퇴근을 당겨 맞춘다.
 * ⚠️ 이걸 빼면 화면에 노랑/빨강 초과근무 경고 배지가 붙는다(홍보 캡처에 들어가면 안 된다).
 *    난수로 만든 기록이라 "대충 짧게" 만드는 것만으로는 넘지 않는다고 보장할 수 없어서, 실제로 세어 맞춘다.
 */
async function capWeeklyHours(companyId) {
  const rows = await prisma.attendance.findMany({
    where: { companyId, clockOut: { not: null } },
    select: { id: true, userId: true, clockIn: true, clockOut: true, breaks: { select: { startAt: true, endAt: true } } },
  });
  const minutes = (r) => {
    let m = (r.clockOut - r.clockIn) / 60000;
    for (const b of r.breaks) if (b.endAt) m -= (b.endAt - b.startAt) / 60000;
    return m;
  };
  // 그 주 월요일 자정을 키로 묶는다
  const weekKey = (d) => {
    const x = midnight(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return `${x.getTime()}`;
  };
  const buckets = new Map();
  for (const r of rows) {
    const k = `${r.userId}|${weekKey(r.clockIn)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  let fixed = 0;
  for (const list of buckets.values()) {
    let total = list.reduce((s, r) => s + minutes(r), 0);
    const cap = WEEK_CAP_HOURS * 60;
    while (total > cap) {
      list.sort((a, b) => minutes(b) - minutes(a));
      const longest = list[0];
      const cut = Math.min(minutes(longest) - 6 * 60, total - cap); // 하루 6시간 밑으로는 안 깎는다
      if (cut <= 0) break;
      const newOut = new Date(longest.clockOut.getTime() - Math.ceil(cut) * 60000);
      await prisma.attendance.update({ where: { id: longest.id }, data: { clockOut: newOut } });
      longest.clockOut = newOut;
      total -= cut;
      fixed++;
    }
  }
  if (fixed) console.log(`· 주 ${WEEK_CAP_HOURS}시간을 넘지 않게 퇴근 시각 ${fixed}건을 당겼습니다(초과근무 경고 방지).`);
}

// ══════════════════════════════════════════════════════════════════════
// 세어 보기 (아무것도 바꾸지 않는다)
// ══════════════════════════════════════════════════════════════════════
async function check() {
  const c = await findDemo();
  if (!c) return console.log("· 데모 회사가 없습니다.");
  const companyId = c.id;
  const [u, a, open, l, an, br] = await Promise.all([
    prisma.user.count({ where: { companyId } }),
    prisma.attendance.count({ where: { companyId } }),
    prisma.attendance.count({ where: { companyId, clockOut: null } }),
    prisma.leaveRequest.count({ where: { companyId } }),
    prisma.announcement.count({ where: { companyId } }),
    prisma.break.count({ where: { attendance: { companyId } } }),
  ]);
  console.log(`· "${c.name}" — 직원 ${u}명 · 출퇴근 ${a}건(근무 중 ${open}건) · 휴가 ${l}건 · 공지 ${an}건 · 외출 ${br}건`);
}

// ══════════════════════════════════════════════════════════════════════
const arg = process.argv[2];
try {
  if (arg === "--undo") {
    await removeDemo();
  } else if (arg === "--check") {
    await check();
  } else if (!arg || arg.startsWith("--")) {
    console.log("사용법:");
    console.log('  node scripts/seed-demo.mjs "<관리자 비밀번호>"   ← 만들기');
    console.log("  node scripts/seed-demo.mjs --undo               ← 전부 지우기");
    console.log("  node scripts/seed-demo.mjs --check              ← 세어 보기");
    process.exit(1);
  } else {
    const { company, users } = await seed(arg);
    console.log(`\n✔ 데모 회사를 만들었습니다: ${company.name} (isDemo=true)`);
    console.log(`  관리자 로그인: ${users[0].email}`);
    console.log("  (비밀번호는 방금 입력하신 값입니다 — 어디에도 저장하지 않았습니다)");
    await check();
    console.log("\n되돌리려면:  node scripts/seed-demo.mjs --undo");
  }
} catch (e) {
  console.error("✖ 실패:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
