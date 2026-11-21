// 회사별 비즈모아샷 문자 계정 — 읽기·상태 판정 (서버 전용).
//  · 저장·해제·시험 발송 창구는 app/actions/company-sms.ts, 화면은 app/settings/CompanySmsForm.tsx.
//  · 요금 규칙(2026-11-21 사장님 확정): 직원 문자는 이 회사 계정으로만 보낸다. 가온 계정으로 대신 보내지 않는다.
//  · 🔒 회사 격리: 모든 함수는 companyId 하나만 받고 그 회사 행만 읽는다. 다른 회사 계정으로 보낼 길이 없어야 한다.
import { prisma } from "@/lib/db";
import { decryptSmsPassword, hasSmsCryptoKey, isSmsEncrypted } from "@/lib/sms-crypto";
import { companySmsSendAvailable } from "@/lib/moashot-send-url";

/** 발송에 쓰는 계정(비밀번호는 평문 — 발송 직전에만 만들고 어디에도 남기지 않는다). */
export type CompanySmsAccount = { id: string; password: string; sender: string };

/** 화면에 보여 줄 상태. ⚠️ 비밀번호 값은 절대 담지 않는다 — "저장돼 있는가/쓸 수 있는가"만. */
export type CompanySmsAccountStatus = {
  smsId: string | null;
  sender: string | null;
  /** 비밀번호가 저장돼 있는가. */
  passwordSaved: boolean;
  /** 저장된 비밀번호를 지금 풀 수 있는가(키가 바뀌었거나 없으면 false). */
  passwordUsable: boolean;
  /** 서버에 암호화 키(SMS_CRED_KEY)가 있는가 — 없으면 새로 저장할 수 없다. */
  keyReady: boolean;
  /** 세 칸이 모두 있고 비밀번호를 쓸 수 있다 = 발송 가능. */
  connected: boolean;
  updatedAt: Date | null;
};

const ACCOUNT_SELECT = { smsId: true, smsPasswordEnc: true, smsSender: true, smsAccountUpdatedAt: true } as const;

export async function getCompanySmsAccountStatus(companyId: string): Promise<CompanySmsAccountStatus> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: ACCOUNT_SELECT });
  const passwordSaved = isSmsEncrypted(c?.smsPasswordEnc);
  // 풀 수 있는지만 본다. 푼 값은 바로 버린다(화면으로 나가지 않는다).
  const passwordUsable = passwordSaved && decryptSmsPassword(c?.smsPasswordEnc) !== null;
  const smsId = c?.smsId ?? null;
  const sender = c?.smsSender ?? null;
  return {
    smsId,
    sender,
    passwordSaved,
    passwordUsable,
    keyReady: hasSmsCryptoKey(),
    connected: !!smsId && !!sender && passwordUsable,
    updatedAt: c?.smsAccountUpdatedAt ?? null,
  };
}

/**
 * 이 회사가 **지금 회사 계정으로 문자를 보낼 수 있는가** — 직원 비밀번호 찾기·초대·임시비번 문자를 켤지 정하는 판정.
 *  · 세 칸이 모두 있고 저장된 비밀번호를 풀 수 있어야 true. 잔액·발신번호 사전등록 여부는 알 수 없다(보내 봐야 안다).
 *  · 🔒 화면에 "켜져 있다"를 보여 주는 곳과 서버에서 막는 곳이 **같은 판정**을 써야 한다(어긋나면 버튼은 있는데 거부).
 */
export async function companySmsReady(companyId: string): Promise<boolean> {
  // 서버에 발송 주소가 없으면(개발 PC·운영 설정 실수) 계정이 있어도 못 보낸다 → 버튼도 숨긴다(2단계 검수 L-4).
  if (!companySmsSendAvailable()) return false;
  return (await loadCompanySmsAccount(companyId)) !== null;
}

/** 발송용 계정을 꺼낸다. 연결 안 됨·비밀번호를 풀 수 없음이면 null(= 보내지 않는다). */
export async function loadCompanySmsAccount(companyId: string): Promise<CompanySmsAccount | null> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: ACCOUNT_SELECT });
  if (!c?.smsId || !c.smsSender || !c.smsPasswordEnc) return null;
  const password = decryptSmsPassword(c.smsPasswordEnc);
  if (password === null) return null;
  return { id: c.smsId, password, sender: c.smsSender };
}
