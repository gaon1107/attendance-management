// 회사 계정 복구용 번호 확인 — "등록한 번호가 정말 내가 문자를 받을 수 있는 휴대폰인가".
//
// 왜 필요한가
//  · 지금까지는 "010 형식인가"만 봤다. 그래서 `010-0000-0000`도, 오타 없이 정확히 입력한 **남의 번호**도,
//    해지된 번호도 그대로 저장됐다. 회사 계정은 이 번호가 유일한 복구 수단이라, 틀린 번호 = 회사 잠김이다.
//  · 가입 때 적은 번호는 확인을 거친 적이 없다 — 대개 가입한 담당자 개인 폰이다.
//    확인 없이 복구를 열면 그 사람이 퇴사한 뒤에도 회사 열쇠를 되찾을 수 있는 "뒷문"이 된다(2026-08-12 되돌림).
//
// 이 파일이 하는 일
//  · 등록된 번호로 6자리 인증번호를 보내고(issuePhoneVerifyCode), 맞으면 "확인됨"으로 표시한다(confirmPhoneVerifyCode).
//  · 판정(복구가 열렸는가)은 lib/owner-recovery.ts ownerRecoveryState가 한다. 여기는 표시만 남긴다.
//
// 🔴 비밀번호 찾기 인증번호(lib/reset-code.ts)와 **테이블을 나눈 이유**는 schema.prisma PhoneVerifyCode 주석 참고.
//    규칙(원문 미저장·1분 1건 유니크 슬롯·시도 상한 원자 갱신·실제 발송 건만 세기)은 그쪽과 같게 맞췄다.
//
// ※ 이 창구는 **로그인한 회사 계정 본인**만 부른다. 비로그인 창구와 달리 실패 사유를 숨길 필요가 없어
//    "왜 안 되는지"를 그대로 알려준다(본인이 고칠 수 있게).
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/password";
import { sendSms, smsConfigured, isSmsLimitDetail } from "@/lib/sms";
import { toLocalPhone, isMobilePhone } from "@/lib/phone";
import { generateResetCode, CODE_TTL_MS, CODE_MAX_ATTEMPTS, RESEND_COOLDOWN_MS } from "@/lib/reset-code";

/** 한 계정이 24시간에 받을 수 있는 확인 문자 최대 건수(문자는 건당 비용). */
export const VERIFY_MAX_SENDS_PER_DAY = 5;
/** SmsLog.kind — 발송 기록 구분값. */
const VERIFY_KIND = "phone_verify";

type Result = { ok: true } | { ok: false; error: string };
type Owner = { id: string; companyId: string; phone: string | null };

function slotKeyFor(userId: string, now: Date): string {
  return `${userId}_${Math.floor(now.getTime() / RESEND_COOLDOWN_MS)}`;
}

/** 지금 등록된 번호로 확인 인증번호를 보낸다. */
export async function issuePhoneVerifyCode(user: Owner, now: Date = new Date()): Promise<Result> {
  if (!smsConfigured()) {
    return { ok: false, error: "문자 발송이 아직 연결되지 않아 번호를 확인할 수 없습니다." };
  }
  const phone = toLocalPhone(user.phone);
  if (!phone) return { ok: false, error: "먼저 복구용 휴대폰 번호를 등록해 주세요." };
  if (!isMobilePhone(phone)) return { ok: false, error: "이 번호로는 문자를 받을 수 없습니다. 휴대폰 번호로 바꿔 주세요." };

  // ── 1분 1건: DB 유니크 슬롯 선점(동시에 몇 번 눌러도 하나만 통과) ──
  const code = generateResetCode();
  let created: { id: string; createdAt: Date };
  try {
    created = await prisma.phoneVerifyCode.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        phone,
        codeHash: await hashPassword(code), // 🔒 원문 미저장
        slotKey: slotKeyFor(user.id, now),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
      select: { id: true, createdAt: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "방금 인증번호를 보냈습니다. 1분 뒤에 다시 받을 수 있습니다." };
    }
    throw e;
  }

  // ── 하루 상한: 실제로 나간 건만 센다(막힌 시도가 창을 밀어 영구히 잠기는 것 방지 — reset-code.ts 치명 A) ──
  const sentToday = await prisma.phoneVerifyCode.count({
    where: { userId: user.id, sentAt: { not: null }, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  if (sentToday >= VERIFY_MAX_SENDS_PER_DAY) {
    await prisma.phoneVerifyCode.delete({ where: { id: created.id } });
    return { ok: false, error: `확인 문자는 하루 ${VERIFY_MAX_SENDS_PER_DAY}번까지 받을 수 있습니다. 내일 다시 시도해 주세요.` };
  }

  const minutes = Math.round(CODE_TTL_MS / 60000);
  // ⚠️ 회사명을 넣지 않는다 — 관리자가 바꿀 수 있는 임의 문구라 우리 발신번호 문자 앞부분을 남이 쓰게 된다
  //    (actions/account.ts 통지 문자와 같은 규칙).
  // 끝 마침표가 없다 — 있으면 91바이트로 단문 한도(90)를 넘어 매번 비싼 장문으로 나간다(검수 경미 8).
  const text = `[근태관리] 복구용 연락처 확인 인증번호 ${code} (${minutes}분 이내 입력). 요청한 적 없으면 무시하세요`;

  // 발송 기록 — 전체 발송 상한(lib/sms.ts M7)이 이 행을 센다. 셀 수 없는 문자는 보내지 않는다.
  let logId: string;
  try {
    const log = await prisma.smsLog.create({
      data: { companyId: user.companyId, userId: user.id, kind: VERIFY_KIND, refId: created.id, toNumber: phone, result: "pending" },
      select: { id: true },
    });
    logId = log.id;
  } catch (e) {
    console.error("[phone-verify] 발송기록 생성 실패(발송하지 않음):", e instanceof Error ? e.message : String(e));
    await prisma.phoneVerifyCode.delete({ where: { id: created.id } });
    return { ok: false, error: "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const res = await sendSms({ to: phone, text, companyId: user.companyId, purpose: "security" });
  try {
    await prisma.smsLog.update({
      where: { id: logId },
      // 실패는 과금이 없으므로 refId를 풀어 둔다(다른 발송 창구와 같은 규칙).
      data: res.ok ? { result: "success", detail: null } : { result: "fail", refId: null, detail: res.detail.slice(0, 200) },
    });
  } catch (e) {
    console.error("[phone-verify] 발송결과 기록 실패:", { logId }, e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    console.error("[phone-verify] 확인 문자 발송 실패:", res.detail);
    await prisma.phoneVerifyCode.delete({ where: { id: created.id } });
    if (isSmsLimitDetail(res.detail)) return { ok: false, error: res.detail };
    return { ok: false, error: "인증번호 문자를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  await prisma.phoneVerifyCode.update({ where: { id: created.id }, data: { sentAt: now } });
  // 발송 성공 뒤에야 나보다 오래된 코드를 닫는다(reset-code.ts와 같은 순서·같은 이유).
  await prisma.phoneVerifyCode.updateMany({
    where: { userId: user.id, createdAt: { lt: created.createdAt }, usedAt: null, invalidatedAt: null },
    data: { invalidatedAt: now },
  });
  return { ok: true };
}

/** 받은 인증번호를 확인하고, 맞으면 지금 번호를 "확인됨"으로 표시한다. */
export async function confirmPhoneVerifyCode(user: Owner, code: string, now: Date = new Date()): Promise<Result> {
  const phone = toLocalPhone(user.phone);
  const live = await prisma.phoneVerifyCode.findFirst({
    where: { userId: user.id, usedAt: null, invalidatedAt: null, sentAt: { not: null }, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!live) return { ok: false, error: "인증번호가 만료되었거나 없습니다. 인증번호를 다시 받아 주세요." };

  // 인증번호를 받은 뒤에 번호를 바꿨다면, 옛 번호로 받은 인증번호로 새 번호를 "확인"해 주면 안 된다.
  if (live.phone !== phone) {
    await prisma.phoneVerifyCode.updateMany({ where: { id: live.id, invalidatedAt: null }, data: { invalidatedAt: now } });
    return { ok: false, error: "번호가 바뀌어 이 인증번호는 쓸 수 없습니다. 인증번호를 다시 받아 주세요." };
  }

  const input = (code ?? "").trim();
  if (!/^\d{6}$/.test(input) || !(await verifyPassword(input, live.codeHash))) {
    // 시도 횟수는 DB가 원자적으로 올린다(읽고+1 하고 쓰면 동시 요청 앞에서 무력화 — reset-code.ts 치명 3).
    const bumped = await prisma.phoneVerifyCode.updateMany({
      where: { id: live.id, usedAt: null, invalidatedAt: null, attemptCount: { lt: CODE_MAX_ATTEMPTS } },
      data: { attemptCount: { increment: 1 } },
    });
    const after = await prisma.phoneVerifyCode.findUnique({ where: { id: live.id }, select: { attemptCount: true } });
    const used = after?.attemptCount ?? CODE_MAX_ATTEMPTS;
    if (bumped.count === 0 || used >= CODE_MAX_ATTEMPTS) {
      await prisma.phoneVerifyCode.updateMany({ where: { id: live.id, invalidatedAt: null }, data: { invalidatedAt: now } });
      return { ok: false, error: "인증번호를 여러 번 틀려 이 인증번호는 더 쓸 수 없습니다. 다시 받아 주세요." };
    }
    return { ok: false, error: `인증번호가 맞지 않습니다. (${CODE_MAX_ATTEMPTS - used}번 더 시도할 수 있습니다)` };
  }

  // 🔒 한 묶음: 인증번호 소모(1회용) + 확인 표시. 둘 중 하나라도 안 되면 없던 일로 한다.
  //  · 확인 표시는 **번호가 그대로일 때만** 한다(where phone). 그 사이 번호가 바뀌었으면 0건 → 되돌린다.
  try {
    await prisma.$transaction(async (tx) => {
      const done = await tx.phoneVerifyCode.updateMany({
        where: { id: live.id, usedAt: null, invalidatedAt: null },
        data: { usedAt: now },
      });
      if (done.count === 0) throw new VerifyRace();
      const marked = await tx.user.updateMany({
        where: { id: user.id, phone: user.phone },
        data: { phoneVerifiedAt: now, phoneVerifiedNumber: live.phone },
      });
      if (marked.count === 0) throw new VerifyRace();
    });
  } catch (e) {
    if (e instanceof VerifyRace) {
      return { ok: false, error: "인증번호를 확인하는 사이 상태가 바뀌었습니다. 인증번호를 다시 받아 주세요." };
    }
    throw e;
  }
  return { ok: true };
}

/** 트랜잭션을 되돌리기 위한 표시용 예외(동시 사용·번호 변경). */
class VerifyRace extends Error {}
