"use server";
// 문자 발송 액션 — 초대·임시비밀번호(A-2). 관리자 전용·회사격리.
//  💰 2026-11-21 메시지 관리 2단계: **그 회사가 연결한 비즈모아샷 계정**으로 보낸다(요금은 회사 부담).
//     연결 안 한 회사는 거부한다 — 가온 계정(.env)은 회사 계정 인증 문자 전용이라 대신 보내지 않는다.
//     화면 버튼도 연결한 회사에만 보이지만(app/employees) 서버 액션은 화면과 무관하게 호출될 수 있으므로
//     여기서도 같은 판정(companySmsReady)으로 막는다.
//  · 버튼 수동 발송 + 1회 제한(같은 초대/요청 중복발송 차단). 1회 제한은 SmsLog 유니크로 원자 보장.
//  · 문자는 부가기능 — 실패해도 초대 생성·임시비번 발급 본기능에는 영향 없음(별도 액션).
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { sendCompanySms, normalizePhone } from "@/lib/sms";
import { verifyPassword } from "@/lib/password";
import { revalidatePath } from "next/cache";
import { companySmsReady } from "@/lib/company-sms-account";

/** 회사 문자 계정이 없을 때의 거부 문구. */
const COMPANY_SMS_OFF =
  "문자 보내기는 [설정 → 문자·알림톡]에서 회사의 비즈모아샷 계정을 연결한 뒤에 쓸 수 있습니다. 지금은 링크·비밀번호를 복사해 직접 전달해 주세요.";

// unknown: 문자 회사 응답이 늦어 **나갔는지 모른다**(시간 초과 등). 화면은 버튼을 다시 그리지 않고 "결과 미확인"을 보여 준다
//  — 슬롯을 풀지 않으므로 다시 눌러도 거부되기 때문이다(2단계 검수 M-2).
type ActionResult = { error?: string; ok?: boolean; unknown?: boolean };

/** 결과 미확인 안내(같은 문구를 발송 직후·다시 눌렀을 때 함께 쓴다). */
const UNKNOWN_DETAIL =
  "문자 회사의 응답이 늦어 결과를 확인하지 못했습니다. 실제로 나갔을 수 있으니 직원에게 받았는지 확인해 주시고, 안 왔으면 복사해서 직접 전달해 주세요.";

// 이 시간이 지나도 "보내는 중"인 기록은 정상 진행일 수 없다(문자 API 호출은 10초 제한).
const STALE_PENDING_MS = 5 * 60 * 1000;

// 원자적 1회 제한 + 발송 + 결과확정.
//  ① (companyId,kind,refId) 유니크로 먼저 "pending" 선점 → 동시 클릭 시 두 번째는 P2002로 즉시 차단(발송 전).
//  ② 성공 → result="success"로 확정(이후 재발송 영구 차단).
//  ③ 실패 → 과금 없음이므로 refId를 null로 바꿔 슬롯을 풀어 재시도 허용(실패 기록은 감사용으로 남김).
async function claimSendFinalize(input: {
  companyId: string;
  userId: string | null;
  kind: "invite" | "temp_password";
  refId: string;
  to: string;
  text: string;
}): Promise<ActionResult> {
  // 🔴 [검수 M-8] "보내는 중(pending)"으로 영구히 잠기는 것을 푼다.
  //    발송 도중 서버가 재시작되면 pending 기록이 남고, 유니크 제약 때문에 그 초대·임시비번은
  //    영원히 "이미 보내는 중입니다"만 반복했다(다시 보낼 방법이 없었다).
  //    문자 발송 호출은 10초 제한이므로, STALE_PENDING_MS(5분)이 지난 pending은 정상 진행 중일 수 없다.
  //
  //  ⚠️ 두 가지를 지킨다(검수 중간 5):
  //   ① **"실패"라고 단정하지 않는다** — 문자가 실제로 나가고 과금까지 된 뒤에 서버가 죽었을 수 있다.
  //      사실이 아닌 값을 감사기록에 남기지 않도록 result="unknown"으로 남긴다.
  //   ② **자동으로 다시 보내지 않는다** — 슬롯만 풀고 이번 클릭은 여기서 멈춘다. 관리자가 안내를 읽고
  //      한 번 더 누르면 그때 발송한다. 이중 발송·이중 과금은 사람이 결정할 일이다.
  const released = await prisma.smsLog.updateMany({
    where: {
      companyId: input.companyId,
      kind: input.kind,
      refId: input.refId,
      result: "pending",
      createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) },
    },
    // refId는 유니크 키라 비워야 슬롯이 풀린다 → 어느 건이었는지는 detail에 남겨 추적을 유지한다(검수 경미 5).
    data: { result: "unknown", refId: null, detail: `발송 결과 미확인(서버 중단 추정) — 대상: ${input.kind}/${input.refId}` },
  });
  if (released.count > 0) {
    return {
      error:
        "이전 발송의 결과를 확인할 수 없습니다(서버가 중단된 것으로 보입니다). 이미 발송됐을 수도 있으니, 그래도 다시 보내려면 한 번 더 눌러 주세요.",
    };
  }

  let logId: string;
  try {
    const log = await prisma.smsLog.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        kind: input.kind,
        refId: input.refId,
        toNumber: input.to,
        result: "pending",
        // 회사 계정 발송 → 가온 전체 상한에서 빠진다(lib/sms.ts countRecentSends).
        viaCompany: true,
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // 이미 있는 기록이 "결과 미확인"이면 그대로 알린다 — "보내는 중"이라고 하면 사실이 아니다(2단계 검수 M-2).
      const prev = await prisma.smsLog.findFirst({
        where: { companyId: input.companyId, kind: input.kind, refId: input.refId },
        select: { result: true },
      });
      if (prev?.result === "unknown") return { error: UNKNOWN_DETAIL, unknown: true };
      return { error: "이미 문자를 보냈거나 보내는 중입니다.(중복 발송 방지)" };
    }
    throw e;
  }

  const res = await sendCompanySms({ to: input.to, text: input.text, companyId: input.companyId, purpose: "general" });

  // ⚠️ 결과 확정(update)이 실패하면 pending이 그대로 남아 위 ①②의 "결과 미확인" 경로로 빠진다.
  //    그 사실을 서버 로그에 남겨 원인을 추적할 수 있게 한다(검수 중간 5 — 예전엔 예외가 그냥 튀어나갔다).
  const finalize = async (data: { result: string; refId?: null; detail: string | null }) => {
    try {
      await prisma.smsLog.update({ where: { id: logId }, data });
    } catch (e) {
      console.error("[sms] 발송 결과 기록 실패 — 기록은 '보내는 중'으로 남는다", { logId, result: data.result }, e);
    }
  };

  if (res.ok) {
    await finalize({ result: "success", detail: null });
    return { ok: true };
  }
  // 시간 초과·응답 도중 끊김 = 실제로 나갔을 수 있다 → "결과 미확인"으로 남기고 **슬롯을 풀지 않는다**
  //  (풀면 다시 눌러 이중 발송·이중 과금이 된다). 관리자는 직원에게 받았는지 물어보고, 안 왔으면 복사해 전달한다.
  if (res.uncertain) {
    await finalize({ result: "unknown", detail: res.detail.slice(0, 200) });
    return { error: UNKNOWN_DETAIL, unknown: true };
  }
  // 실패: 과금 안 됨 → refId를 풀어 재시도 허용(실패 기록은 남김).
  await finalize({ result: "fail", refId: null, detail: res.detail.slice(0, 200) });
  return { error: `문자 발송 실패: ${res.detail}` };
}

// 관리자: 초대 링크를 문자로 발송. url은 클라이언트가 만든 전체 초대 URL(토큰 일치를 서버가 검증).
export async function sendInviteSms(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };
  if (!(await companySmsReady(me.companyId))) return { error: COMPANY_SMS_OFF };

  const inviteId = String(formData.get("inviteId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const to = normalizePhone(String(formData.get("phone") ?? ""));

  if (!url) return { error: "초대 링크가 없습니다." };
  if (to.length < 9 || to.length > 12) return { error: "받는 사람 전화번호를 정확히 입력해주세요." };

  // 회사 격리 + 유효 초대 확인(미사용·미만료)
  const invite = await prisma.invite.findFirst({ where: { id: inviteId, companyId: me.companyId } });
  if (!invite) return { error: "초대를 찾을 수 없습니다." };
  if (invite.usedAt) return { error: "이미 가입에 사용된 초대입니다." };
  if (invite.expiresAt < new Date()) return { error: "만료된 초대입니다." };
  // URL 위·변조 방지: 반드시 이 초대의 토큰 경로를 담고 있어야 한다(다른 링크로 치환 차단).
  if (!url.includes(`/invite/${invite.token}`)) return { error: "초대 링크가 올바르지 않습니다." };

  const text = `[${me.company.name}] 근태관리 초대입니다. ${url} (7일 이내 가입해 주세요)`;
  const result = await claimSendFinalize({ companyId: me.companyId, userId: null, kind: "invite", refId: inviteId, to, text });

  revalidatePath("/employees");
  return result;
}

// 관리자: 임시 비밀번호를 대상 직원 전화번호로 발송. temp는 방금 발급돼 화면에 표시된 값.
export async function sendTempPasswordSms(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };
  if (!(await companySmsReady(me.companyId))) return { error: COMPANY_SMS_OFF };

  const requestId = String(formData.get("requestId") ?? "");
  const temp = String(formData.get("temp") ?? "");
  if (!temp) return { error: "임시 비밀번호가 없습니다." };

  // 회사 격리 + 대상 직원(전화번호는 직원 프로필에서 서버가 조회 — 클라이언트가 못 바꿈)
  const req = await prisma.passwordResetRequest.findFirst({
    where: { id: requestId, companyId: me.companyId },
    include: { user: true },
  });
  if (!req) return { error: "요청을 찾을 수 없습니다." };

  // 🔴 [검수 M-21] 문자 본문에 들어갈 값을 **클라이언트가 정하게 두지 않는다.**
  //    예전엔 formData의 temp를 그대로 본문에 넣었다 → 관리자 계정이 털리면 회사 이름이 붙은
  //    "신뢰받는 문자"로 임의 문구(피싱 링크 등)를 직원들에게 보낼 수 있었다.
  //    이제 **그 계정에 실제로 적용된 임시 비밀번호가 맞는지** 해시로 확인하고, 아니면 보내지 않는다.
  //    (임시 비밀번호는 발급 순간에만 평문으로 존재하므로 서버가 다시 만들어낼 수는 없다 → 대조로 검증한다)
  //    ⚠️ 2026-08-05: `mustChangePassword`만 보면 부족했다. [직원 추가]에도 이 표시를 세우게 되면서
  //       **관리자가 글자를 직접 정하는 경로**가 생겼기 때문이다. 그대로 두면 "비밀번호"에 아무 문구나
  //       넣어 만든 계정으로 이 가드를 통과시켜, 회사 이름이 붙은 문자를 임의 문구로 보낼 수 있었다.
  //       → **기한(tempPasswordExpiresAt)이 살아 있는지**까지 확인하도록 했다.
  //    ⚠️ 2026-08-09 갱신 — 위 문장에 있던 "이 값은 issueTempPassword만 세운다"는 **더 이상 사실이 아니다.**
  //       [직원 상세]의 재설정(employees.ts resetEmployeePassword)도 이제 48시간 기한을 세운다.
  //       그래도 M-21은 여전히 막힌다: 세 발급 경로(직원 추가·직원 상세 재설정·재설정 요청 처리)가
  //       **전부 서버 무작위 생성**으로 바뀌어, 관리자가 문자 본문에 들어갈 글자를 정하는 경로 자체가 없다.
  //       지금 이 기한 검사는 "오래된 임시비번을 다시 문자로 보내는 것"을 막는 용도로 남아 있다.
  //       ※ [직원 추가]는 여전히 기한을 세우지 않으므로(employees.ts) 그 계정은 이 문자 경로를 탈 수 없다.
  const tempAlive = !!req.user.tempPasswordExpiresAt && req.user.tempPasswordExpiresAt > new Date();
  if (!req.user.mustChangePassword || !tempAlive || !(await verifyPassword(temp, req.user.passwordHash))) {
    return { error: "방금 발급한 임시 비밀번호가 아닙니다. 임시 비밀번호를 다시 발급한 뒤 보내주세요." };
  }

  const to = normalizePhone(req.user.phone ?? "");
  if (to.length < 9 || to.length > 12) {
    return { error: "직원 전화번호가 없습니다. 직원 상세에서 전화번호를 먼저 입력해 주세요." };
  }

  const text = `[${me.company.name}] 임시 비밀번호: ${temp} — 로그인 후 새 비밀번호로 변경해 주세요.`;
  const result = await claimSendFinalize({ companyId: me.companyId, userId: req.userId, kind: "temp_password", refId: requestId, to, text });

  revalidatePath("/employees");
  return result;
}
