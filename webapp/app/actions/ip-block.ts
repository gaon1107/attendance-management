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

// IPv4(또는 대역) 형식 검증 — 옥텟 1~4개, 각 0~255.
//  · "1.2.3.4"=한 대, "1.2.3"=1.2.3.* 대역, "1.2"=1.2.*.* …
//  ⚠️ 예전엔 /^[0-9a-fA-F.:]+$/ 라서 "abc"·"1" 같은 값이 통과했다. "1" 한 글자가 1.0.0.0/8(1600만 대)을
//     막아버리는 오타 사고를 막기 위해 구조를 검증한다(검수 지적).
function parseIpv4Pattern(s: string): { octets: number[] } | null {
  if (!/^\d{1,3}(\.\d{1,3}){0,3}$/.test(s)) return null;
  const octets = s.split(".").map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return { octets };
}

// IPv6는 형식이 다양해 대역 판정을 지원하지 않는다(ipMatches는 '.' 경계만 인정) → 정확히 일치할 때만 차단됨.
function looksLikeIpv6(s: string): boolean {
  return s.includes(":");
}

// 차단 규칙 추가
export async function addBlockedIp(_prev: Result, formData: FormData): Promise<Result> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  // 끝의 마침표는 정리("1.2.3." == "1.2.3") — ipMatches와 같은 취급.
  // IPv6는 대소문자 표기가 흔들려도 같은 주소이므로 소문자로 통일해 저장한다(2001:DB8 == 2001:db8).
  const raw = String(formData.get("pattern") ?? "").trim().replace(/\.+$/, "");
  const pattern = looksLikeIpv6(raw) ? raw.toLowerCase() : raw;
  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const reason = reasonRaw ? reasonRaw.slice(0, 200) : null;

  if (!pattern) return { error: "차단할 IP를 입력해주세요." };

  const v4 = parseIpv4Pattern(pattern);
  if (!v4 && !looksLikeIpv6(pattern)) {
    return { error: "IP 형식이 올바르지 않습니다. (예: 1.2.3.4 = 한 대, 1.2.3 = 1.2.3.* 대역)" };
  }

  const h = await headers();
  const myIp = getClientIp(h);

  // 🛡️ 방어 2 — 내 현재 IP를 막는 규칙은 저장 거부(스스로 잠기는 사고 방지).
  //    ⚠️ IP를 못 읽으면 방어가 통째로 꺼지므로, 그때는 아예 저장하지 않는다(나중에 프록시를 붙이면
  //       무검증으로 쌓인 규칙이 한꺼번에 살아나는 사고를 막는다 — 검수 지적).
  if (!myIp) {
    return { error: "지금 접속 IP를 확인할 수 없어 안전을 위해 차단 규칙을 저장하지 않습니다. 관리자에게 문의하세요." };
  }
  if (ipMatches(myIp, pattern)) {
    return { error: `이 규칙은 지금 접속 중인 관리자 IP(${myIp})를 포함해 스스로 로그인이 막힙니다. 다른 값을 입력해주세요.` };
  }

  // 🛡️ 방어 2-b — 사내망(허용 IP)이 등록돼 있지 않으면 **대역 차단을 금지**한다.
  //    사내망 미등록이면 "사내망 우선 통과"(방어 1)가 없어, 관리자가 집에서 사무실 대역을 막으면
  //    다음 날 사무실 전원이 잠긴다. 이 경우 정확한 IP 한 대만 허용한다(검수 지적).
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { officeIps: true } });
  const hasOfficeIps = Boolean(company?.officeIps && company.officeIps.trim());
  const isRange = v4 ? v4.octets.length < 4 : false;
  if (isRange && !hasOfficeIps) {
    return {
      error:
        "사내 네트워크(허용 IP)가 등록되지 않아 대역 차단은 막아 두었습니다. 사무실 전체가 잠길 수 있습니다. " +
        "[설정 → 사내 네트워크]에 회사 IP를 먼저 등록하거나, 정확한 IP 한 대(예: 1.2.3.4)만 입력해주세요.",
    };
  }

  // 🛡️ 방어 2-c — 이 관리자가 최근 성공적으로 로그인한 IP를 막는 규칙도 거부한다.
  //    방어 2는 "지금 이 순간의 IP" 1개만 보므로, 집·회사를 오가면 다음 접속 때 잠길 수 있다.
  const recentLogins = await prisma.accessEvent.findMany({
    where: { companyId: me.companyId, userId: me.id, kind: "login", result: "success", ip: { not: null } },
    select: { ip: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const hit = recentLogins.find((e) => e.ip && ipMatches(e.ip, pattern));
  if (hit) {
    return { error: `이 규칙은 관리자님이 최근 접속했던 IP(${hit.ip})를 포함합니다. 다음에 그곳에서 로그인이 막힐 수 있어 저장하지 않았습니다.` };
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
