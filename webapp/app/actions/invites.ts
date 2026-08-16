"use server";
// 직원 초대 — 관리자가 초대 링크를 만들고(createInvite), 직원이 그 링크로 스스로 가입한다(acceptInvite).
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/password";
import { PASSWORD_MAX_LEN } from "@/lib/login-policy";
import { getCurrentUser, createSession } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { parseProfile, employeeNoTaken } from "@/lib/employee-profile";
import { randomBytes } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// 초대 선점 경쟁에서 진 경우(다른 사람이 먼저 그 링크로 가입) — 트랜잭션을 되돌리려고 던지는 신호.
class InviteTakenError extends Error {}

// 관리자: 초대 링크 생성. 7일간 유효한 1회용 토큰을 만든다.
export async function createInvite(): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const token = randomBytes(24).toString("hex");
  await prisma.invite.create({
    data: {
      companyId: me.companyId,
      token,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
  });
  revalidatePath("/employees");
}

// 관리자: 아직 안 쓴 초대 링크 취소(삭제).
export async function cancelInvite(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  // 회사 격리 — 내 회사 초대만 취소 가능
  const inv = await prisma.invite.findFirst({ where: { id, companyId: me.companyId } });
  if (!inv) return;
  await prisma.invite.delete({ where: { id: inv.id } });
  revalidatePath("/employees");
}

// 직원(비로그인): 초대 링크로 본인 계정 생성. 이름·이메일·비밀번호를 직접 정한다.
export async function acceptInvite(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !email || !password) return { error: "모든 항목을 입력해주세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };
  // 🔴 상한이 없으면 **로그인할 수 없는 계정**이 만들어진다 — 로그인은 200자에서 막기 때문이다.
  //    그 계정은 근태 기록만 남긴 채 본인이 다시는 못 들어온다.
  //  · 이유는 DoS가 아니다(검수 경미 4). 아래 scrypt는 유효한 1회용 토큰을 통과해야만 닿으므로
  //    거대한 입력을 반복해서 밀어 넣을 수 없다. **오직 "못 들어가는 계정"을 막기 위한 것**이다.
  //  · 숫자를 여기 직접 적지 않는다 — 창구마다 기준이 갈리지 않게 login-policy 한 곳만 본다.
  if (password.length > PASSWORD_MAX_LEN) return { error: `비밀번호는 ${PASSWORD_MAX_LEN}자 이하로 입력해주세요.` };

  // 초대 유효성 검증(존재·미사용·미만료)
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return { error: "유효하지 않거나 만료된 초대입니다. 관리자에게 새 링크를 요청해주세요." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "이미 가입된 이메일입니다. 다른 이메일을 쓰거나 로그인해주세요." };

  // 인적정보(선택) — 직원이 채운 것만 저장(빈 항목은 null). 관리자가 나중에 상세에서 고칠 수 있다.
  const parsed = parseProfile(formData);
  if (!parsed.ok) return { error: parsed.error };
  const profile = parsed.profile;
  // 사번 중복검사 — 초대한 회사에 같은 사번을 쓰는 활성 직원이 이미 있으면 가입 거부(email 검사와 같은 방식).
  if (await employeeNoTaken(invite.companyId, profile.employeeNo)) {
    return { error: "이미 같은 사번을 쓰는 직원이 있습니다. 관리자에게 확인해 주세요." };
  }

  // 🔒 "1회용"을 DB에서 원자적으로 보장한다(검수 M-1).
  //  · 예전 순서(계정 생성 → 사용 표시)는 두 사람이 같은 링크를 동시에 열면 **둘 다 통과**해
  //    계정이 2개 만들어졌다. 위 findUnique 검사는 조회 시점의 사진일 뿐이라 경합을 못 막는다.
  //  · 이제 `usedAt: null` 조건을 **쓰기에 함께 걸어** 먼저 도착한 한 명만 선점한다(count=0이면 진 것).
  //  · 선점과 계정 생성을 한 트랜잭션에 묶어, 계정 생성이 실패하면(예: 그 찰나에 같은 이메일이
  //    가입되면 P2002) 선점도 함께 되돌아간다 → **링크가 헛되이 소모되지 않는다.**
  // ⚠️ 비밀번호 해시는 **트랜잭션 밖에서** 미리 만든다(검수 중간 4).
  //    scryptSync는 수십~수백 ms 동안 서버 전체를 멈추는 동기 연산이다. 트랜잭션 안에서 하면
  //    SQLite 쓰기 잠금을 쥔 채로 멈춰 다른 직원의 출퇴근 기록까지 밀린다.
  const passwordHash = hashPassword(password);

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw new InviteTakenError();
      return tx.user.create({
        data: {
          companyId: invite.companyId, // 초대한 회사 소속으로
          email,
          name,
          passwordHash,
          role: "employee",
          phone: profile.phone,
          employeeNo: profile.employeeNo,
          hireDate: profile.hireDate,
        },
      });
    });
  } catch (e) {
    if (e instanceof InviteTakenError) {
      // 선점에 실패한 이유는 둘 중 하나 — 사유를 뒤바꿔 말하지 않도록 실제 상태를 다시 본다(검수 경미 7).
      const now = await prisma.invite.findUnique({ where: { id: invite.id }, select: { usedAt: true } });
      return {
        error: now?.usedAt
          ? "이미 사용된 초대입니다. 관리자에게 새 링크를 요청해주세요."
          : "만료된 초대입니다. 관리자에게 새 링크를 요청해주세요.",
      };
    }
    // 이메일 중복(P2002) 등 — 트랜잭션이 되돌아가 초대는 그대로 살아 있다.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // 위 findUnique 검사 뒤 그 찰나에 같은 이메일이 가입된 경우 — 스스로 해결할 수 있게 정확히 알린다(검수 경미 8).
      return { error: "이미 가입된 이메일입니다. 다른 이메일을 쓰거나 로그인해주세요." };
    }
    console.error("[acceptInvite] 가입 실패", e);
    return { error: "가입 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해주세요." };
  }

  await createSession(user.id);
  // 접속기록: 초대 가입 직후 자동 로그인 1건(성공).
  {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login", result: "success", ip, userAgent });
  }
  redirect("/auth-method"); // 가입 직후 출퇴근 인증방식 선택 화면으로
}
