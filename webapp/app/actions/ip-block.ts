"use server";
// 차단 IP 관리 — 관리자만. 명단에 올린 IP는 로그인이 거부된다(접속/보안 5단계).
//
// 🛡️ 자기잠금 방어 2단계(방어 1은 lib/ip-block.ts의 "사내망 우선 통과"):
//    **지금 이 규칙을 추가하는 관리자 본인의 IP와 겹치면 저장을 거부한다.**
//    → 스스로 잠그는 규칙을 애초에 만들 수 없게 한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getClientIp, ipMatches } from "@/lib/ip";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

type Result = { error?: string; ok?: boolean };

// IP/대역 형식 검증 — 설정 화면(사내 네트워크)과 같은 규칙: 숫자·점·콜론(IPv6)만.
const IP_RE = /^[0-9a-fA-F.:]+$/;

// 차단 규칙 추가
export async function addBlockedIp(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  // 끝의 마침표는 정리("1.2.3." == "1.2.3") — ipMatches와 같은 취급.
  const pattern = String(formData.get("pattern") ?? "").trim().replace(/\.+$/, "");
  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const reason = reasonRaw ? reasonRaw.slice(0, 200) : null;

  if (!pattern) return { error: "차단할 IP를 입력해주세요." };
  if (!IP_RE.test(pattern)) {
    return { error: "IP는 숫자·점(.)·콜론(:)만 사용할 수 있어요. (예: 1.2.3.4 또는 1.2.3)" };
  }

  const h = await headers();
  const myIp = getClientIp(h);

  // 🛡️ 방어 2 — 내 현재 IP를 막는 규칙은 저장 거부(스스로 잠기는 사고 방지).
  if (myIp && ipMatches(myIp, pattern)) {
    return { error: `이 규칙은 지금 접속 중인 관리자 IP(${myIp})를 포함해 스스로 로그인이 막힙니다. 다른 값을 입력해주세요.` };
  }

  // 이미 같은 규칙이 있으면 중복 저장하지 않는다.
  const dup = await prisma.blockedIp.findFirst({ where: { companyId: me.companyId, pattern } });
  if (dup) return { error: "이미 차단 목록에 있는 IP입니다." };

  await prisma.blockedIp.create({
    data: { companyId: me.companyId, pattern, reason, createdBy: me.name },
  });

  // 감사로그 — 차단은 보안 정책 변경이라 누가 무엇을 막았는지 남긴다.
  await logAdminAction(me, "config", `ip_block_add:${pattern}`);
  revalidatePath("/security/blocked");
  return { ok: true };
}

// 차단 해제
export async function removeBlockedIp(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  // 회사 격리 — 반드시 내 회사 규칙만 지운다.
  const target = await prisma.blockedIp.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return;

  await prisma.blockedIp.delete({ where: { id: target.id } });
  await logAdminAction(me, "config", `ip_block_remove:${target.pattern}`);
  revalidatePath("/security/blocked");
}
