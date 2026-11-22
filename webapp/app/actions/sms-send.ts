"use server";
// 직접 문자 보내기 — 관리자가 직원을 골라 문자를 보낸다. 메시지 관리 3-2b (2026-11-22).
//  · 화면: app/messages/sms/send/ ([메시지 관리 → 문자 관리 → 메시지 발송] 탭).
//  · 권한: 관리자 전원. 회사 격리: 받는 사람은 **내 회사 재직 직원**만(회사 계정 제외), 조회·발송 모두 companyId로 묶는다.
//  · 요금: 그 회사가 연결한 비즈모아샷 계정에서 나간다(가온 대체 발송 없음 — 2026-11-21 요금 규칙).
//
// 🔴 돈이 나가는 기능이라 안전장치를 겹쳐 둔다. 하나라도 빼지 말 것(2026-11-22 검수 치명 4건 + 재검수 치명 1건).
//
//   ① **같은 날 같은 문자는 한 사람에게 한 번만** — 묶음 번호를 **서버가** "오늘 날짜 + 문구 + 내용"으로 만든다.
//      기록 자리(SmsLog.refId)는 "묶음:받는 사람"이라, 체크를 바꾸든·새로고침하든·다른 탭에서 보내든 결과가 같다.
//      · 처음엔 화면이 묶음 번호를 들고 있었는데, 제출할 때마다(1차) 또는 받는 사람을 바꿀 때마다(2차) 새 번호가 되어
//        **이미 받은 사람에게 또 나가는** 길이 계속 열렸다(재검수 치명 C-1). 화면 상태에 기대지 않는 것이 핵심이다.
//      · 일부러 같은 문자를 또 보내야 하면 확인 창에서 "이미 받은 분에게도 다시 보냅니다"를 체크한다 →
//        화면이 일회용 번호(resendNonce)를 보내고, 그 번호로 새 묶음이 된다(같은 번호를 두 번 보내면 또 막힌다).
//      · "같은 화면에서 다시 누르기" = "못 받은 분에게만 다시 보내기"가 된다(실패하면 자리를 풀고, 멈춰서 못 보낸 분은
//        기록을 만들지 않으므로).
//   ② **한 번에 30명**까지(SEND_MAX_RECIPIENTS).
//   ③ **멈춰야 할 때 그 자리에서 멈춘다** — 남은 분에게는 보내지 않고(기록도 만들지 않는다) 그대로 알린다.
//      · 문자 회사 쪽 실패 1건(계정·잔액·발신번호·상한·연결) — 다음 분도 똑같이 실패한다. 계속 두드리면 가온 서버 IP에서
//        인증 실패가 쏟아져 **비즈모아샷이 IP를 막을 수 있고, 그러면 모든 고객사의 문자가 멈춘다**.
//      · 결과 미확인 2건 연속 · **시작 후 35초**(운영 nginx는 60초에 연결을 끊는다 — 마지막 1건 10초 + 마무리까지 넉넉히)
//      · 예상 못 한 저장 오류 — 예외를 그대로 던지면 화면이 오류 페이지로 바뀌어 결과를 못 보고 다시 누르게 된다.
//   ④ 보낼 내용은 **사람마다 이름을 채운 뒤** 공용 모듈로 다시 검사한다(깨지는 글자·길이). 이름 하나가 문제면
//      그 분만 건너뛰고 계속한다(외부에 보내기 전에 걸러지므로 IP 위험이 없다).
//   ⑤ 누가 몇 명에게 보냈는지 접속기록에 남긴다(본문·번호는 남기지 않는다).
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { findUnsupportedChars, getEuckrByteLength } from "@newgaon/moashot";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { companySmsReady } from "@/lib/company-sms-account";
import { sendCompanySms, isSmsLimitDetail } from "@/lib/sms";
import { isMobilePhone, toLocalPhone } from "@/lib/phone";
import { toISODate } from "@/lib/period";
import { normalizeTemplateText, renderTemplate, SMS_LONG_MAX_BYTES, SEND_MAX_RECIPIENTS } from "@/lib/sms-templates";

/** 이 시간이 지나면 남은 분에게 보내지 않고 멈춘다. 운영 nginx 연결 끊김(60초)보다 넉넉히 짧게(재검수 경미). */
const SEND_DEADLINE_MS = 35_000;
/** "결과 미확인"(시간 초과 등)이 이만큼 연달아 나오면 멈춘다 — 문자 회사가 느린 상태라 계속하면 마감을 넘긴다. */
const MAX_CONSECUTIVE_UNKNOWN = 2;

export type SendFormState = {
  error?: string;
  ok?: boolean;
  /** 이번에 새로 접수된 건수. */
  sent?: number;
  /** 오늘 같은 문자를 이미 보냈거나 결과 확인 중인 분 — 다시 보내지 않았다. */
  duplicate?: number;
  /** 보내지 못한 건수. */
  failed?: number;
  /** 결과를 확인하지 못한 건수(나갔을 수 있다 — 요금이 붙었을 수 있다). */
  unknown?: number;
  /** 중간에 멈추거나 건너뛰어 아예 보내지 않은 건수. */
  notSent?: number;
  message?: string;
};

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return null;
  return me;
}

/** 오늘 날짜를 "11월 22일" 꼴로. 템플릿 [날짜] 자리에 들어간다. */
function todayLabel(): string {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 보낼 본문 최종 검사 — 자리를 채운 뒤의 글이 기준이다. 통과면 null. */
function finalCheck(text: string): string | null {
  try {
    if (text.trim() === "") return "보낼 내용이 비어 있습니다.";
    // 길이를 먼저 본다 — 아주 긴 글이 들어와도 글자 하나하나를 인코딩하지 않는다.
    const bytes = getEuckrByteLength(text);
    if (bytes > SMS_LONG_MAX_BYTES) return `보낼 내용이 너무 깁니다(${bytes}/${SMS_LONG_MAX_BYTES}바이트).`;
    const bad = findUnsupportedChars(text);
    if (bad.length) return `문자로 보낼 수 없는 글자가 있습니다: ${bad.join(" ")}`;
    return null;
  } catch (e) {
    console.error("[sms-send] 글자 검사 실패:", e);
    return "내용을 검사하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/**
 * 묶음 번호 — **서버가** 만든다(①). 같은 날·같은 문구·같은 내용이면 언제 누가 눌러도 같은 번호다.
 *  · 회사 구분은 SmsLog의 유일 조건([companyId, kind, refId])이 이미 하므로 여기 넣지 않는다.
 *  · "다시 보내기"를 골랐으면 화면이 준 일회용 번호로 새 묶음을 만든다.
 */
function batchKeyFor(body: string, content: string, resendNonce: string | null): string {
  const day = toISODate(new Date()).replace(/-/g, "");
  // 다시 보내기도 **내용을 함께** 섞는다(최종 검수 M-2). 같은 일회용 번호로 같은 내용을 다시 누르면 같은 묶음이라
  //  "이어 보내기"가 되고(이미 받은 분은 건너뜀), 체크한 채 문구를 고치면 다른 묶음이 된다.
  const h = createHash("sha256").update(`${day}\n${body}\n${content}\n${resendNonce ?? ""}`).digest("hex").slice(0, 32);
  return resendNonce ? `r${day}-${h}` : `d${day}-${h}`;
}

/**
 * 고른 직원들에게 문자를 보낸다.
 *  formData: body(자리 포함 원문), content([내용]에 넣을 값), userIds(여러 개), resendNonce(다시 보낼 때만)
 */
export async function sendDirectSms(_prev: SendFormState, formData: FormData): Promise<SendFormState> {
  const me = await requireAdmin();
  if (!me) return { error: "권한이 없습니다." };

  // 회사가 비즈모아샷 계정을 연결하지 않았으면 문자가 나가지 않는다(가온이 대신 보내지 않는다).
  if (!(await companySmsReady(me.companyId))) {
    return { error: "[설정 → 문자·알림톡]에서 우리 회사 문자 계정을 먼저 연결해 주세요. 연결 전에는 문자가 나가지 않습니다." };
  }

  // 줄바꿈을 한 가지(\n)로 맞춘다 — 브라우저·저장된 템플릿마다 \r\n이 섞이면 같은 문자인데 묶음이 갈린다(최종 검수 K-1).
  const body = normalizeTemplateText(String(formData.get("body") ?? "")).replace(/\r\n?/g, "\n").trim();
  // 🔴 [최종 검수 M-1] [내용] 자리가 없는 문구면 내용 값은 **버린다.** 화면에서 템플릿을 바꾸면 입력칸은 사라져도
  //    옛 값이 함께 올 수 있는데, 그 값이 묶음 번호에 섞이면 같은 문자인데 다른 묶음이 되어 또 나간다.
  const contentRaw = normalizeTemplateText(String(formData.get("content") ?? "")).replace(/\r\n?/g, "\n").trim();
  const content = body.includes("[내용]") ? contentRaw : "";
  if (!body) return { error: "보낼 내용을 입력해 주세요." };

  const nonceRaw = String(formData.get("resendNonce") ?? "").trim();
  if (nonceRaw && !/^[A-Za-z0-9-]{8,64}$/.test(nonceRaw)) {
    return { error: "보내기 정보를 확인하지 못했습니다. 화면을 새로고침해 주세요." };
  }
  const batchKey = batchKeyFor(body, content, nonceRaw || null);

  const userIds = formData.getAll("userIds").map((v) => String(v)).filter(Boolean);
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return { error: "받는 직원을 한 명 이상 골라 주세요." };
  // 인원 검사는 DB를 읽기 **전에** 한다(큰 목록을 직접 보내도 서버가 일을 하지 않게).
  if (uniqueIds.length > SEND_MAX_RECIPIENTS) {
    return { error: `한 번에 ${SEND_MAX_RECIPIENTS}명까지 보낼 수 있습니다. 나눠서 보내 주세요.` };
  }

  // 본문 자체에 문제가 있으면(누구에게 보내도 똑같이 걸린다) **아무에게도 보내기 전에** 멈춘다.
  //  이름 대신 짧은 자리값을 넣어 본다 — 여기서 걸리면 이름 탓이 아니다.
  {
    const probe = renderTemplate(body, { 직원명: "가", 회사명: me.company.name, 날짜: todayLabel(), 내용: content });
    const probeError = finalCheck(probe);
    if (probeError) return { error: probeError };
  }

  // 🔒 회사 격리 + 받을 수 있는 분만: 내 회사 · 재직 중 · **회사 계정 아님** · 휴대폰 번호 있음.
  //  회사 계정의 번호는 복구용 연락처라 공지를 보낼 대상이 아니다(이 제품은 회사 계정을 직원 목록에서 늘 뺀다).
  const targets = await prisma.user.findMany({
    where: { companyId: me.companyId, id: { in: uniqueIds }, deactivatedAt: null, isOwner: false },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
  });
  // 같은 번호를 쓰는 직원이 둘이면 한 번만 보낸다 — 같은 사람에게 2통·2요금이 나가지 않게.
  const seenPhones = new Set<string>();
  const sendable: { id: string; name: string; to: string }[] = [];
  let samePhone = 0;
  for (const t of targets) {
    const to = toLocalPhone(t.phone);
    if (!isMobilePhone(to)) continue;
    if (seenPhones.has(to)) {
      samePhone += 1;
      continue;
    }
    seenPhones.add(to);
    // 맥·아이폰에서 만든 명단으로 올린 이름은 분해형 한글일 수 있다 — 합쳐 둔다.
    sendable.push({ id: t.id, name: normalizeTemplateText(t.name), to });
  }
  // 고른 사이에 퇴사했거나 번호가 바뀐 분 — 조용히 빠지지 않게 숫자로 알린다(재검수 경미).
  const unreachable = uniqueIds.length - sendable.length - samePhone;
  if (sendable.length === 0) return { error: "고른 직원 중 문자를 받을 수 있는 번호가 없습니다." };

  const startedAt = Date.now();
  const today = todayLabel();
  let sent = 0;
  let duplicate = 0;
  let failed = 0;
  let unknownCount = 0;
  let notSent = 0;
  let consecutiveUnknown = 0;
  const skippedNames: string[] = [];
  /** 멈춘 이유(화면에 그대로 보여 줄 문구). null이면 끝까지 갔다. */
  let stopReason: string | null = null;

  for (const t of sendable) {
    if (stopReason) {
      notSent += 1;
      continue;
    }
    if (Date.now() - startedAt > SEND_DEADLINE_MS) {
      stopReason = "시간이 오래 걸려 여기서 멈췄습니다(문자 회사 응답이 느립니다).";
      notSent += 1;
      continue;
    }

    const text = renderTemplate(body, { 직원명: t.name, 회사명: me.company.name, 날짜: today, 내용: content });
    if (finalCheck(text)) {
      // 본문은 위에서 통과했으니 **이 분의 이름** 때문이다 → 이 분만 건너뛰고 계속한다(재검수 M-3).
      //  외부에 보내기 전에 걸러지므로 IP 위험이 없다. 누구인지 알려야 관리자가 이름을 고칠 수 있다.
      skippedNames.push(t.name);
      notSent += 1;
      continue;
    }

    let logId: string;
    try {
      const log = await prisma.smsLog.create({
        data: {
          companyId: me.companyId,
          userId: t.id,
          kind: "direct",
          // 묶음 + 받는 분 → 같은 묶음을 다시 보내면 P2002로 막히고, 서로 다른 분은 막지 않는다.
          refId: `${batchKey}:${t.id}`,
          toNumber: t.to,
          result: "pending",
          viaCompany: true, // 회사 계정 발송 → 가온 전체 상한에서 빠진다.
        },
        select: { id: true },
      });
      logId = log.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // 오늘 같은 문자를 이미 보냈다(또는 보내는 중·결과 미확인) — 다시 보내지 않는다.
        duplicate += 1;
        continue;
      }
      // 🔴 [재검수 M-1] 예상 못 한 저장 오류 — 던지면 화면이 오류 페이지로 바뀌어 결과를 못 보고 다시 누르게 된다.
      //    여기서 멈추고 지금까지의 결과를 정상으로 돌려준다.
      console.error("[sms-send] 발송 기록 만들기 실패 — 여기서 멈춘다", e);
      stopReason = "저장 중 오류가 나서 여기서 멈췄습니다. 잠시 후 다시 시도해 주세요.";
      notSent += 1;
      continue;
    }

    const res = await sendCompanySms({ to: t.to, text, companyId: me.companyId, purpose: "general" });

    // indexCode(접수번호) = 도착 결과 회신이 이 기록을 찾는 열쇠다(3-3). 저장하지 않으면 그 건은 결과를 못 받는다.
    const finalize = async (data: { result: string; refId?: null; detail: string | null; indexCode?: string | null }) => {
      try {
        await prisma.smsLog.update({ where: { id: logId }, data });
      } catch (e) {
        // 실패로 고쳐 쓰지 못하면 자리가 풀리지 않아 이 분은 "이미 보낸 분"으로 건너뛰어진다 — 원인을 남긴다.
        console.error("[sms-send] 발송 결과 기록 실패 — 기록은 '보내는 중'으로 남는다", { logId, result: data.result }, e);
      }
    };

    if (res.ok) {
      await finalize({ result: "success", detail: null, indexCode: res.indexCode ?? null });
      sent += 1;
      consecutiveUnknown = 0;
      continue;
    }
    if (res.uncertain) {
      // 시간 초과 등 — 나갔을 수 있다. 자리를 풀지 않는다(다시 눌러도 이 분에게는 다시 가지 않게).
      await finalize({ result: "unknown", detail: res.detail.slice(0, 200), indexCode: res.indexCode ?? null });
      unknownCount += 1;
      consecutiveUnknown += 1;
      if (consecutiveUnknown >= MAX_CONSECUTIVE_UNKNOWN) {
        stopReason = "문자 회사 응답이 계속 늦어 여기서 멈췄습니다.";
      }
      continue;
    }
    // 보내지 못함 → 자리를 풀어, 같은 화면에서 다시 누르면 이 분에게 다시 갈 수 있게 한다.
    await finalize({ result: "fail", refId: null, detail: res.detail.slice(0, 200) });
    failed += 1;
    // 🔴 [검수 치명 4] 실패는 **한 번이면 멈춘다.** 남은 분 대부분이 같은 이유로 똑같이 실패한다.
    stopReason = isSmsLimitDetail(res.detail)
      ? res.detail
      : `${t.name}님에게 보내다 실패해 여기서 멈췄습니다: ${res.detail} — [설정 → 문자·알림톡]에서 계정·잔액·발신번호를 확인해 주세요.`;
  }

  // 누가 몇 명에게 보냈는지 남긴다(본문·번호는 남기지 않는다).
  try {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({
      companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
      kind: "config", result: sent + unknownCount > 0 ? "success" : "fail", ip, userAgent,
      meta: `sms_direct_send:${sent}/${sendable.length}`,
    });
  } catch (e) {
    console.warn("[sms-send] 접속기록 남기기 실패(발송에는 영향 없음):", e);
  }

  revalidatePath("/messages/sms/logs");

  // ── 결과 문구 — 숫자와 말이 사실과 맞아야 한다(요금이 걸려 있다). ─────────────────
  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent}명에게 보냈습니다.`);
  // ⚠️ "이미 받은 분"이라고 단정하지 않는다 — 결과 미확인·보내는 중인 분도 여기 들어온다(재검수 M-4).
  if (duplicate > 0) parts.push(`${duplicate}명은 오늘 같은 문자를 이미 보냈거나 결과 확인 중인 분이라 다시 보내지 않았습니다.`);
  if (unknownCount > 0) parts.push(`${unknownCount}명은 결과를 확인하지 못했습니다 — 나갔을 수 있으니 받았는지 확인해 주세요.`);
  // ⚠️ "요금 없음"이라고 단정하지 않는다 — 문자 회사가 빈 응답을 준 경우 등은 접수됐을 수도 있다.
  if (failed > 0) parts.push(`${failed}명에게는 보내지 못했습니다.`);
  if (stopReason) parts.push(stopReason);
  if (skippedNames.length > 0) {
    parts.push(`이름에 문자로 보낼 수 없는 글자가 있어 건너뛴 분: ${skippedNames.join(", ")} — [직원 관리]에서 이름을 고쳐 주세요.`);
  }
  const stoppedCount = notSent - skippedNames.length;
  if (stoppedCount > 0) parts.push(`보내지 않은 분 ${stoppedCount}명.`);
  if (samePhone > 0) parts.push(`번호가 같은 직원 ${samePhone}명은 한 번만 보냈습니다.`);
  if (unreachable > 0) parts.push(`${unreachable}명은 퇴사했거나 휴대폰 번호가 없어 빠졌습니다.`);
  // 일부만 나갔으면 다음 행동을 알려 준다 — 같은 화면에서 다시 누르면 **못 받은 분에게만** 간다.
  if ((failed > 0 || stoppedCount > 0) && (sent > 0 || duplicate > 0)) {
    parts.push("문제를 해결한 뒤 그대로 다시 누르면, 이미 받은 분은 건너뛰고 못 받은 분에게만 보냅니다.");
  }
  const message = parts.join(" ");

  // 하나도 새로 나가지 않았어도 "이미 보낸 분"만 있었다면 정상이다 — 빨간 실패로 보이면 다시 누르게 된다.
  if (sent === 0 && unknownCount === 0 && duplicate === 0) {
    return { error: message || "문자를 보내지 못했습니다.", failed, notSent };
  }
  return { ok: true, sent, duplicate, failed, unknown: unknownCount, notSent, message };
}
