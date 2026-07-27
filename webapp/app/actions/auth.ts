"use server";
// 회원가입 / 로그인 / 로그아웃 서버 동작.
// 주의: 이 함수들은 화면 없이 직접 호출될 수도 있으므로, 입력값 검증을 항상 여기서 한다.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { isBlockedForCompany } from "@/lib/ip-block";
import { isValidBizRegNoFormat, formatBizRegNo, normalizeBizRegNo, verifyBizRegNo } from "@/lib/bizreg";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// 회사 회원가입 — 회사 + **회사 계정**(마스터 키)을 함께 만든다.
//
// 2026-07-27 사장님 결정으로 방식이 바뀌었다.
//  · [전]  가입한 사람이 곧 관리자 → 그 사람이 퇴사하면 회사에 아무도 들어갈 수 없었다.
//  · [후]  가입으로 만드는 것은 **사람이 아니라 회사 계정**이다. 실무 관리자는 가입 후 직원 중에서
//         지정한다(app/actions/owner.ts). 관리자가 전원 나가도 회사 계정이 남아 잠기지 않는다.
//  · 담당자 이름·연락처는 사람 계정이 아니라 **회사 정보**로 저장한다(Company.managerName/Phone).
export async function signup(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const bizRegNoRaw = String(formData.get("bizRegNo") ?? "").trim();
  const managerName = String(formData.get("managerName") ?? "").trim();
  const managerPhone = String(formData.get("managerPhone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const agreeTerms = formData.get("agreeTerms") != null;
  const agreePrivacy = formData.get("agreePrivacy") != null;

  if (!companyName || !bizRegNoRaw || !managerName || !managerPhone || !email || !password) {
    return { error: "모든 항목을 입력해주세요." };
  }
  if (password.length < 8) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }
  if (!email.includes("@") || email.length < 5) {
    return { error: "이메일 형식이 올바르지 않습니다." };
  }
  // 연락처는 숫자만 남겨 9~11자리인지만 본다(하이픈·공백 자유). 실제 소유 확인은 문자 인증 도입 시(2차).
  if (!/^\d{9,11}$/.test(managerPhone.replace(/[^0-9]/g, ""))) {
    return { error: "담당자 연락처를 올바르게 입력해주세요." };
  }
  // 동의는 법적 필수 — 체크하지 않으면 가입시키지 않는다(개인정보보호법 제15조·제22조).
  if (!agreeTerms || !agreePrivacy) {
    return { error: "이용약관과 개인정보 수집·이용에 동의해주세요." };
  }

  // 사업자등록번호: 먼저 계산으로 걸러내고(국세청에 물을 필요도 없는 가짜), 그다음 국세청에 묻는다.
  if (!isValidBizRegNoFormat(bizRegNoRaw)) {
    return { error: "사업자등록번호가 올바르지 않습니다. 10자리 숫자를 확인해주세요." };
  }
  const bizRegNo = formatBizRegNo(bizRegNoRaw);

  // 같은 사업자등록번호로 이미 가입한 회사가 있으면 막는다.
  //  · 한 회사가 둘로 쪼개져 근태 기록이 나뉘는 것이 장난 가입보다 큰 사고이기 때문.
  //  · 지점을 따로 쓰고 싶은 회사는 고객지원으로 처리한다(1차 범위 밖).
  //  · ⚠️ 하이픈 있는 값과 없는 값을 **둘 다** 본다. [회사정보] 화면에서 하이픈 없이 저장된 옛 값이
  //    있을 수 있어, 한 형태만 비교하면 중복 검사가 그냥 통과한다(검수 7).
  const dupCompany = await prisma.company.findFirst({
    where: { bizRegNo: { in: [bizRegNo, normalizeBizRegNo(bizRegNoRaw)] } },
    select: { id: true },
  });
  if (dupCompany) {
    return { error: "이미 가입된 사업자등록번호입니다. 회사 관리자에게 문의해주세요." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "이미 가입된 이메일입니다." };
  }

  // 국세청 확인. 🔴 확인하지 못하면(키 없음·장애·시간초과) **가입을 막지 않는다**(fail-open).
  //    확인된 건만 시각을 남기고, 나머지는 [회사정보]에 "확인 보류"로 뜬다.
  const check = await verifyBizRegNo(bizRegNo);
  if (check.state === "invalid" || check.state === "closed") {
    return { error: `사업자등록번호를 확인할 수 없습니다 — ${check.detail}` };
  }

  const now = new Date();
  // ⚠️ 회사와 회사 계정은 **반드시 함께** 만들어진다(트랜잭션).
  //    따로 만들면 계정 생성이 실패했을 때 **로그인할 수 없는 빈 회사**가 남고,
  //    그 회사가 사업자등록번호를 차지해 같은 회사가 다시는 가입할 수 없게 된다(검수 8).
  let user: { id: string; name: string };
  let companyId: string;
  try {
    const made = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: companyName,
          bizRegNo,
          bizRegNoVerifiedAt: check.state === "verified" ? now : null,
          managerName,
          managerPhone,
          companyEmail: email,
          termsAgreedAt: now,
        },
      });
      const u = await tx.user.create({
        data: {
          companyId: company.id,
          email,
          // 사람이 아니라는 것이 화면에서 바로 보이게 한다(직원 목록·집계에서는 제외된다).
          name: "회사 계정",
          phone: managerPhone,
          passwordHash: hashPassword(password),
          role: "admin", // 권한은 관리자와 동일 — 권한 검사 117군데를 건드리지 않기 위함
          isOwner: true, // 🔒 강등·퇴사·삭제 불가. 회사가 잠기지 않게 하는 유일한 장치
        },
        select: { id: true, name: true },
      });
      return { company, u };
    });
    user = made.u;
    companyId = made.company.id;
  } catch (e) {
    // 동시 가입으로 이메일·사업자번호가 겹치는 등 — 아무것도 남기지 않고 다시 시도하게 한다.
    console.warn("[signup] 회사 생성 실패:", e);
    return { error: "가입 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해주세요." };
  }
  const company = { id: companyId };

  await createSession(user.id);
  // 접속기록: 가입 직후 자동 로그인 1건(성공).
  {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({ companyId: company.id, userId: user.id, actorName: user.name, emailTried: email, kind: "login", result: "success", ip, userAgent });
  }
  // 가입 직후에는 회사 기본 설정(근무기준·위치)을 잡도록 온보딩으로 안내(건너뛰기 가능).
  redirect("/onboarding");
}

// 로그인 무차별 대입(비번 찍기) 방어 기준
const MAX_FAILED = 5; // 연속 5회 실패하면
const LOCK_MINUTES = 10; // 10분간 잠금

// 로그인 — 이메일/비밀번호 확인 후 세션 발급.
export async function login(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력해주세요." };
  }

  // 접속기록용 IP·기기(이메일이 입력된 이후부터 남긴다).
  const { ip, userAgent } = readClientMeta(await headers());

  const user = await prisma.user.findUnique({ where: { email } });

  // [차단 IP] 관리자가 명단에 올린 IP는 로그인을 거부한다(접속/보안 5단계).
  //  · 회사별 정책이라 **사용자를 찾은 뒤**(=회사를 안 뒤)에야 검사할 수 있다.
  //    → 존재하지 않는 이메일로 두드리는 공격은 회사를 특정할 수 없어 대상이 아니다(기존 5회 실패 잠금이 담당).
  //  · 🛡️ 사내망(officeIps)은 무엇을 넣든 통과 = 관리자 자기잠금 방지(lib/ip-block.ts).
  //  · 무엇이 막혔는지 알려주지 않는다 — 공격자에게 "이 IP는 차단됨" 정보를 주지 않기 위해 기존과 같은 모호한 문구.
  if (user && (await isBlockedForCompany(user.companyId, ip))) {
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "blocked", result: "blocked", ip, userAgent });
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 퇴사(비활성화)된 계정은 로그인 불가.
  if (user?.deactivatedAt) {
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "deactivated" });
    return { error: "이 계정은 비활성화되었습니다. 관리자에게 문의하세요." };
  }

  // 계정이 잠겨 있으면(연속 실패로 잠금) 비번이 맞아도 잠금 해제 시각까지 거부.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "locked" });
    return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${mins}분 뒤에 다시 시도해주세요.` };
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    // 실패 시: 실제 계정이면 실패 횟수를 올리고, 한도 도달하면 잠근다.
    if (user) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
            : { failedLoginCount: failed },
      });
    }
    // 접속기록: 실패 1건. 존재하지 않는 이메일이면 소속 회사를 알 수 없어 companyId=null(회사별 화면엔 안 보임).
    await recordAccess({ companyId: user?.companyId ?? null, userId: user?.id ?? null, actorName: user?.name ?? null, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "bad_credentials" });
    // 보안: 이메일/비번 중 무엇이 틀렸는지 구분해 알려주지 않는다.
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 성공 시: 실패 기록·잠금 초기화.
  if (user.failedLoginCount !== 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  await createSession(user.id);
  // 접속기록: 로그인 성공 1건.
  await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login", result: "success", ip, userAgent });
  // 임시 비밀번호로 로그인했으면 먼저 새 비밀번호를 정하도록 강제한다.
  if (user.mustChangePassword) redirect("/change-password");
  // 관리자는 대시보드로, 직원은 본인 출퇴근 화면으로
  redirect(user.role === "admin" ? "/dashboard" : "/attendance");
}

// 로그아웃
export async function logout(): Promise<void> {
  // 접속기록: 누가 로그아웃했는지 남기려면 세션 파기 전에 조회한다.
  const me = await getCurrentUser();
  if (me) {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({ companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email, kind: "logout", result: "success", ip, userAgent });
  }
  await destroySession();
  redirect("/");
}
