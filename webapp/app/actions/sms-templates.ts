"use server";
// 문자 템플릿 — 저장(새로 만들기·수정) / 삭제. 메시지 관리 3-2a (2026-11-22).
//  · 화면: app/messages/sms/templates/ ([메시지 관리 → 문자 관리 → 템플릿 관리] 탭).
//  · 권한: **관리자 전원**([설정 → 문자·알림톡]과 같은 기준 — 2026-11-21 사장님 결정).
//  · 회사 격리: 모든 조회·수정·삭제를 me.companyId로 묶는다. id만 믿고 고치면 **남의 회사 템플릿을 고칠 수 있다.**
//  · 1차 검사(이름 길이·본문 길이·확실한 금지 글자)는 lib/sms-templates.ts를 화면과 함께 쓴다.
//  · 🔴 **최종 판정은 여기서 공용 모듈로 한다**(2026-11-22 검수 중간 1).
//    브라우저에는 EUC-KR 변환기가 없어 화면 검사는 느슨하다. 그래서 저장 직전에 @newgaon/moashot의
//    findUnsupportedChars(진짜 깨지는 글자)·getEuckrByteLength(진짜 바이트)로 다시 본다.
//    발송 모듈(sendSms)은 길이만 보고 깨지는 글자를 걸러 주지 않는다 — **여기서 막지 않으면 깨진 문자가
//    그대로 나가고 요금까지 나간다.**
//  · 맥·아이폰에서 복사한 분해형 한글은 저장 전에 NFC로 합쳐 둔다(안 하면 화면엔 멀쩡한데 문자가 깨진다).
//  · 여기서는 문자를 **보내지 않는다**. 발송은 3-2b에서 따로 만든다.
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { findUnsupportedChars, getEuckrByteLength } from "@newgaon/moashot";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { checkTemplate, normalizeTemplateText, TEMPLATE_MAX_PER_COMPANY, SMS_LONG_MAX_BYTES } from "@/lib/sms-templates";

export type TemplateFormState = { error?: string; ok?: boolean; message?: string };

/** 이름이 겹칠 때 보여 줄 문구 — 미리 확인할 때와 DB가 막을 때가 같은 말을 해야 한다. */
const DUP_NAME = "같은 이름의 템플릿이 이미 있습니다. 다른 이름을 써 주세요.";

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return null;
  return me;
}

/**
 * 공용 모듈로 보는 **최종 판정** — 실제로 문자를 보낼 때와 같은 기준(EUC-KR)이다.
 *  · 화면 검사를 통과해도 여기서 걸릴 수 있다(분해형 한글·드문 기호 등).
 *  · 모듈이 없거나 오류가 나면 **저장을 막는다** — 검사를 못 한 채로 통과시키면 깨진 문자가 나간다.
 */
function finalTextCheck(body: string): string | null {
  try {
    const bad = findUnsupportedChars(body);
    if (bad.length) {
      return `문자로 보낼 수 없는 글자가 있습니다: ${bad.join(" ")} (받는 분 휴대폰에서 깨집니다)`;
    }
    const bytes = getEuckrByteLength(body);
    if (bytes > SMS_LONG_MAX_BYTES) {
      return `문구가 너무 깁니다(${bytes}/${SMS_LONG_MAX_BYTES}바이트). 줄여 주세요.`;
    }
    return null;
  } catch (e) {
    console.error("[sms-templates] 글자 검사 실패:", e);
    return "문구를 검사하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/**
 * 저장 — `id`가 오면 수정, 없으면 새로 만들기.
 *  · 같은 회사 안에서 이름이 겹치면 막는다(목록에서 어느 것인지 구분이 안 된다).
 *  · 개수 상한은 **새로 만들 때만** 본다(상한을 낮춰도 이미 있는 것을 고치지 못하게 되면 안 된다).
 */
export async function saveSmsTemplate(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  const me = await requireAdmin();
  if (!me) return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "").trim();
  // NFC로 합친 뒤 저장한다 — 맥·아이폰에서 복사한 분해형 한글이 문자에서 깨지는 것을 막는다(검수 중간 1).
  const name = normalizeTemplateText(String(formData.get("name") ?? "")).trim();
  const body = normalizeTemplateText(String(formData.get("body") ?? "")).trim();

  const check = checkTemplate(name, body);
  if (!check.ok) return { error: check.error };

  // 공용 모듈(EUC-KR)로 최종 판정 — 화면·1차 검사가 놓친 글자를 여기서 잡는다.
  const finalError = finalTextCheck(body);
  if (finalError) return { error: finalError };

  // 이름 중복 검사 — 수정 중인 자기 자신은 뺀다.
  const dup = await prisma.smsTemplate.findFirst({
    where: { companyId: me.companyId, name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (dup) return { error: DUP_NAME };

  if (id) {
    try {
      // 🔒 회사 격리 — where에 companyId를 함께 넣는다. id만으로 고치면 남의 회사 것을 고칠 수 있다.
      const r = await prisma.smsTemplate.updateMany({
        where: { id, companyId: me.companyId },
        data: { name, body },
      });
      if (r.count === 0) return { error: "템플릿을 찾을 수 없습니다. 목록을 새로고침해 주세요." };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: DUP_NAME };
      throw e;
    }
    revalidatePath("/messages/sms/templates");
    return { ok: true, message: "수정했습니다." };
  }

  const count = await prisma.smsTemplate.count({ where: { companyId: me.companyId } });
  if (count >= TEMPLATE_MAX_PER_COMPANY) {
    return { error: `템플릿은 ${TEMPLATE_MAX_PER_COMPANY}개까지 만들 수 있습니다. 쓰지 않는 것을 지운 뒤 다시 시도해 주세요.` };
  }

  try {
    await prisma.smsTemplate.create({ data: { companyId: me.companyId, name, body } });
  } catch (e) {
    // 🔴 [검수 중간 5] 위 "읽어 보고 → 만든다"만으로는 **동시에 두 번** 저장할 때 같은 이름이 둘 생긴다.
    //    DB의 @@unique([companyId, name])가 최종 방어선이고, 그때 오는 오류가 P2002다.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: DUP_NAME };
    throw e;
  }
  revalidatePath("/messages/sms/templates");
  return { ok: true, message: "저장했습니다." };
}

/** 삭제 — 되돌릴 수 없다(화면에서 한 번 확인받는다). */
export async function deleteSmsTemplate(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  const me = await requireAdmin();
  if (!me) return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "삭제할 템플릿을 찾을 수 없습니다." };

  // 🔒 회사 격리 — deleteMany + companyId. delete({ where: { id } })는 남의 회사 것도 지운다.
  const r = await prisma.smsTemplate.deleteMany({ where: { id, companyId: me.companyId } });
  if (r.count === 0) return { error: "템플릿을 찾을 수 없습니다. 목록을 새로고침해 주세요." };

  revalidatePath("/messages/sms/templates");
  return { ok: true, message: "삭제했습니다." };
}
