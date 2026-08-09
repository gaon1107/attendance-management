// 비밀번호 찾기 인증코드 — 직원이 관리자 승인 없이 스스로 비밀번호를 되찾는 경로의 핵심 규칙.
//
// 왜 만들었나
//  · 기존 경로(PasswordResetRequest)는 **관리자가 승인해야만** 임시비번이 나온다. 밤·주말에 관리자가
//    안 보면 직원이 로그인하지 못한다. 근태 제품에서 로그인 불가 = 근로기록 누락이다.
//
// 🔴 절대 깨면 안 되는 설계 4가지
//  ① **코드를 보냈다고 비밀번호를 미리 바꾸지 않는다.** 남의 이메일만 알면 그 계정을 잠글 수 있게 된다.
//     비밀번호는 코드까지 맞힌 사람이 새 비밀번호를 정하는 순간에만 바뀐다.
//  ② **어떤 실패든 밖으로 보이는 답이 같아야 한다.** 계정 없음/전화번호 불일치/한도초과/발송실패가
//     서로 다른 답을 주면, 그 차이만으로 "직원 명부"와 "전화번호 뒷 4자리"를 알아낼 수 있다(검수 치명 1·2).
//     ⚠️ 화면을 숨기는 것은 방어가 아니다 — 서버 액션은 화면과 무관하게 호출된다. 여기서 막아야 한다.
//  ③ **코드 원문을 저장하지 않는다.** DB가 새도 코드를 알 수 없게 scrypt 해시로만 남긴다.
//  ④ **모든 상한은 DB가 원자적으로 보장한다.** "읽어보고 판단해서 쓰기"는 동시 요청 앞에서 전부 뚫린다
//     (검수 치명 3·4). 횟수는 increment + 조건부 갱신, 발송 슬롯은 유니크 선점으로만 지킨다.
//
// ⚠️ IP 제한(lib/login-throttle.ts)은 `TRUST_PROXY=1`이 켜지기 전까지 **아무 일도 하지 않는다.**
//    그래서 이 파일의 **계정 단위 제한이 실질적인 유일한 방어선**이다.
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/password";
import { sendSms, normalizePhone, smsConfigured } from "@/lib/sms";
import { recordAccess } from "@/lib/access-log";
import { randomInt } from "crypto";

// ── 정책 값(전부 여기 한 곳에서만 고친다) ──────────────────────────────────
/** 코드 유효시간. 짧을수록 안전하지만 문자 도착 지연을 감안해 5분. */
export const CODE_TTL_MS = 5 * 60 * 1000;
/** 이만큼 틀리면 그 코드는 즉시 폐기한다. 6자리=100만분의 1이라 이 상한이 실질 방어선이다. */
export const CODE_MAX_ATTEMPTS = 5;
/** 재발송 최소 간격. DB 유니크 슬롯으로 강제한다(읽고 판단하지 않는다). */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** 한 계정에 하루(24시간) 보낼 수 있는 최대 건수. 문자는 건당 비용이다. */
export const MAX_CODES_PER_DAY = 5;
/** 본인확인에 쓰는 전화번호 뒷자리 수. */
export const PHONE_TAIL_LEN = 4;
/** 다 쓴 코드 기록 보관기간. 무한 누적을 막는다(개인 식별정보는 없지만 행이 계속 쌓인다). */
export const CODE_RETENTION_DAYS = 30;

/** 6자리 숫자 코드. Math.random이 아니라 암호학적 난수를 쓴다(예측 차단). */
export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * 입력한 뒷자리가 그 사람 전화번호의 뒷자리와 맞는가.
 * · 하이픈·공백은 무시하고 숫자만 비교한다("010-1234-5678" ↔ "5678").
 * · 전화번호가 없거나 자릿수가 모자라면 **항상 실패**다(빈 값끼리 맞아떨어지는 사고 방지).
 */
export function phoneTailMatches(storedPhone: string | null | undefined, input: string): boolean {
  const phone = normalizePhone(storedPhone ?? "");
  const tail = normalizePhone(input ?? "");
  if (phone.length < PHONE_TAIL_LEN || tail.length !== PHONE_TAIL_LEN) return false;
  return phone.slice(-PHONE_TAIL_LEN) === tail;
}

/** 발송 슬롯 키 — 같은 사람은 1분에 1건. 유니크 제약이 동시 요청을 DB에서 걷어낸다. */
function slotKeyFor(userId: string, now: Date): string {
  return `${userId}_${Math.floor(now.getTime() / RESEND_COOLDOWN_MS)}`;
}

/** 지금 쓸 수 있는(미사용·미폐기·미만료) 가장 최근 코드 1건. 없으면 null. */
async function findLiveCode(userId: string, now: Date) {
  return prisma.passwordResetCode.findFirst({
    where: { userId, usedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 인증코드를 만들어 문자로 보낸다.
 *
 * 🔴 **반환값은 언제나 void다 — 성공했는지 알려주지 않는다.**
 *    계정이 없든·전화번호가 틀리든·한도를 넘었든·발송사가 죽었든 호출부는 구분할 수 없어야 한다.
 *    (예전엔 발송 실패만 사유를 돌려줬는데, 그것만으로 "이메일+뒷4자리가 맞다"를 1만 번 안에
 *     확정할 수 있는 판별기가 됐다 — 검수 치명 2.)
 *    운영자가 볼 흔적은 서버 로그와 SmsLog에 남긴다.
 */
export async function issueResetCode(
  email: string,
  phoneTail: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<void> {
  // 🔒 전체를 감싼다 — 이 함수는 **계정·뒷자리가 맞았을 때만** 아래 경로를 탄다.
  //    그래서 DB 오류가 그대로 튀어나가면 "실재 계정에서만 화면이 깨지는" 신호가 되어,
  //    문구를 통일한 의미가 사라진다(검수 중간 4). 무슨 일이 나도 조용히 끝낸다.
  try {
    await issueResetCodeInner(email, phoneTail, meta, now);
  } catch (e) {
    console.error("[reset-code] 인증번호 발급 중 오류(조용히 종료):", e);
  }
}

async function issueResetCodeInner(
  email: string,
  phoneTail: string,
  meta: { ip?: string | null; userAgent?: string | null },
  now: Date
): Promise<void> {
  // 문자 계정이 없으면 아무 일도 하지 않는다. 화면을 숨기는 것과 별개로 **액션 자체를 무력화**한다.
  if (!smsConfigured()) return;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, companyId: true, name: true, phone: true, deactivatedAt: true, isOwner: true, company: { select: { name: true } } },
  });

  // 아래는 전부 조용히 종료한다 — 사유를 하나라도 알려주면 계정·전화번호 확인 창구가 된다.
  //  · 계정 없음 / 퇴사자 / 🔒 회사 계정(마스터 열쇠는 이 경로로 못 되찾는다)
  //  · 전화번호 뒷자리 불일치(전화번호 미등록이면 phoneTailMatches가 항상 false)
  if (!user || user.deactivatedAt || user.isOwner) return;
  if (!phoneTailMatches(user.phone, phoneTail)) return;

  // ── 1분 1건: DB 유니크 슬롯으로 선점한다(actions/sms.ts의 P2002 선점 패턴과 같은 방식). ──
  //    동시에 몇 건이 들어와도 create에 성공하는 건 딱 하나다.
  const code = generateResetCode();
  let created: { id: string; createdAt: Date };
  try {
    created = await prisma.passwordResetCode.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        codeHash: hashPassword(code), // 🔒 원문 미저장
        slotKey: slotKeyFor(user.id, now),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
      select: { id: true, createdAt: true },
    });
  } catch (e) {
    // P2002 = 같은 분에 이미 만들었다 → 재발송 간격 위반. 조용히 종료.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }

  // ── 하루 상한: **실제로 문자가 나간 건만** 센다. ──
  //    🔴 여기서 `sentAt`을 빼고 전체 행을 세면, 한도에 걸려 아무것도 못 보낸 시도가 남긴 행이
  //       다음 요청의 카운트를 또 밀어올려 **창이 영원히 갱신**된다(검수 치명 A).
  //       그러면 남의 이메일+뒷번호를 아는 사람이 1분에 한 번만 눌러도 그 직원을 영구히 잠글 수 있고,
  //       발송사 장애 때는 직원이 안내대로 몇 번 누른 것만으로 스스로 하루를 잠근다.
  //    ※ 순서(만들고 → 센다)는 유지한다. 먼저 세고 나중에 만들면 동시 요청이 전부 통과한다.
  const sentToday = await prisma.passwordResetCode.count({
    where: { userId: user.id, sentAt: { not: null }, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  if (sentToday >= MAX_CODES_PER_DAY) {
    // 문자가 나가지 않은 행은 감사 가치가 없고 카운트만 흐린다 → 남기지 않고 지운다.
    await prisma.passwordResetCode.delete({ where: { id: created.id } });
    return;
  }

  const to = normalizePhone(user.phone ?? "");
  const minutes = Math.round(CODE_TTL_MS / 60000);
  const text = `[${user.company.name}] 비밀번호 찾기 인증번호 ${code} (${minutes}분 이내 입력). 요청한 적 없으면 무시하세요.`;

  // 발송 기록(SmsLog) — 문자는 건당 비용이라 "언제 몇 건 나갔는지"를 남긴다.
  //  · refId는 이 코드의 id라 매번 달라진다 → 초대·임시비번의 1회 제한 유니크와 절대 충돌하지 않는다.
  //  · ⚠️ 본문(코드)은 절대 기록하지 않는다.
  let logId: string | null = null;
  try {
    const log = await prisma.smsLog.create({
      data: { companyId: user.companyId, userId: user.id, kind: "reset_code", refId: created.id, toNumber: to, result: "pending" },
      select: { id: true },
    });
    logId = log.id;
  } catch (e) {
    console.warn("[reset-code] 발송기록 생성 실패(발송은 진행):", e);
  }

  const res = await sendSms({ to, text });

  if (logId) {
    try {
      await prisma.smsLog.update({
        where: { id: logId },
        // 실패는 과금이 없으므로 refId를 풀어 둔다(actions/sms.ts와 같은 규칙).
        data: res.ok ? { result: "success", detail: null } : { result: "fail", refId: null, detail: res.detail.slice(0, 200) },
      });
    } catch (e) {
      console.error("[reset-code] 발송결과 기록 실패(기록은 '보내는 중'으로 남는다):", { logId }, e);
    }
  }

  if (!res.ok) {
    // 사용자에게는 알리지 않는다(위 ② 원칙). 대신 운영자가 볼 수 있게 서버 로그에 남긴다.
    console.error("[reset-code] 인증번호 문자 발송 실패:", res.detail);
    // 나가지 않은 코드는 흔적을 남기지 않고 지운다 — 남기면 하루 상한만 갉아먹는다(치명 A).
    await prisma.passwordResetCode.delete({ where: { id: created.id } });
    return;
  }

  // 🔒 여기서부터가 "문자가 실제로 나간" 상태다.
  await prisma.passwordResetCode.update({ where: { id: created.id }, data: { sentAt: now } });

  // ── 발송이 성공한 뒤에야 옛 코드를 폐기한다. ──
  //    ⚠️ 순서가 중요하다(검수 중간 6). 먼저 폐기하면, 발송사가 죽어 있을 때
  //       "받아둔 멀쩡한 코드까지 잃고 하루 한도만 깎이는" 상태가 된다.
  //    ⚠️ **나보다 오래된 것만** 폐기한다(검수 중간 M-1). `id != 나`로만 걸면, 분 경계(12:00:59와
  //       12:01:00)에 만들어진 두 코드가 **서로를 죽여** 문자 2통을 받고도 둘 다 안 먹는다.
  await prisma.passwordResetCode.updateMany({
    where: { userId: user.id, createdAt: { lt: created.createdAt }, usedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });

  // 회사 관리자가 [보안]-[접속기록]에서 볼 수 있게 회사·접속정보를 붙여 남긴다.
  //  ※ meta를 따로 둔다 — IP 제한은 "reset_request"만 정확일치로 세므로 이 기록은 한도를 갉아먹지 않는다.
  await recordAccess({
    companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email,
    kind: "public_request", result: "success", ip: meta.ip, userAgent: meta.userAgent, meta: "reset_code_sent",
  });

  // 오래된 코드 기록 정리(무한 누적 방지). 실패해도 본기능을 막지 않는다.
  try {
    await prisma.passwordResetCode.deleteMany({
      where: { userId: user.id, createdAt: { lt: new Date(now.getTime() - CODE_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
    });
  } catch (e) {
    console.warn("[reset-code] 오래된 코드 기록 정리 실패(무시):", e);
  }
}

/**
 * 코드가 맞는지 확인한다. **비밀번호는 건드리지 않는다.**
 *
 * 🔴 실패 사유를 나누지 않는다 — `ok: false` 하나뿐이다.
 *    "코드가 틀림" 과 "코드가 아예 없음"을 구분해 주면, 이메일만 바꿔가며 던져서
 *    **재직 중인 직원 명부를 통째로 열거**할 수 있다(검수 치명 1).
 *
 * @param consume true면 확인 성공 시 그 코드를 사용 완료로 표시한다(마지막 단계에서만 true).
 */
export async function checkResetCode(
  email: string,
  code: string,
  consume: boolean,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date()
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, companyId: true, name: true, deactivatedAt: true, isOwner: true },
  });
  if (!user || user.deactivatedAt || user.isOwner) return { ok: false };

  const live = await findLiveCode(user.id, now);
  if (!live) return { ok: false };

  const input = (code ?? "").trim();
  if (!/^\d{6}$/.test(input) || !verifyPassword(input, live.codeHash)) {
    // ── 시도 횟수는 DB가 원자적으로 올린다. ──
    //    ⚠️ 예전엔 읽은 값에 1을 더해 썼는데, 동시에 200건을 던지면 200건이 모두 같은 값을 읽고
    //       같은 값을 써서 **200번 찍고 횟수는 1만 올랐다**(검수 치명 3).
    //    조건(attemptCount < 상한)을 where에 넣어, 상한에 닿는 순간 더는 갱신되지 않게 한다.
    const bumped = await prisma.passwordResetCode.updateMany({
      where: { id: live.id, usedAt: null, invalidatedAt: null, attemptCount: { lt: CODE_MAX_ATTEMPTS } },
      data: { attemptCount: { increment: 1 } },
    });
    // 갱신이 안 됐다는 건 이미 상한이라는 뜻 → 폐기한다. 갱신됐어도 상한에 닿았으면 폐기한다.
    const after = await prisma.passwordResetCode.findUnique({ where: { id: live.id }, select: { attemptCount: true } });
    if (bumped.count === 0 || (after?.attemptCount ?? 0) >= CODE_MAX_ATTEMPTS) {
      await prisma.passwordResetCode.updateMany({
        where: { id: live.id, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
    }

    // 무차별 대입 흔적 — **시도 횟수가 실제로 올라갔을 때만** 남긴다.
    //  · 왜 이 조건인가: "살아있는 코드가 있으면 기록"으로 했더니, 동시에 50건을 던지면 50건이
    //    모두 코드를 살아있는 상태로 읽어 **50줄이 쌓였다**(자체 검증에서 51건 확인). 익명 호출로
    //    DB를 채우는 통로가 된다. increment가 성공한 요청만 기록하면 건수가 코드당 상한(5)에 묶인다.
    //  · 없는 계정·없는 코드는 아무것도 쓰지 않는다.
    if (bumped.count > 0) {
      await recordAccess({
        companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email,
        kind: "public_request", result: "fail", ip: meta.ip, userAgent: meta.userAgent, meta: "reset_code_wrong",
      });
    }
    return { ok: false };
  }

  if (consume) {
    // 🔒 1회용 보장: updateMany + usedAt:null 조건으로 **동시에 두 번 들어와도 한 번만** 성공한다.
    const done = await prisma.passwordResetCode.updateMany({
      where: { id: live.id, usedAt: null, invalidatedAt: null },
      data: { usedAt: now },
    });
    if (done.count === 0) return { ok: false };
  }

  return { ok: true, userId: user.id };
}
