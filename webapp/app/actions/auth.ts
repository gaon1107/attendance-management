"use server";
// 회원가입 / 로그인 / 로그아웃 서버 동작.
// 주의: 이 함수들은 화면 없이 직접 호출될 수도 있으므로, 입력값 검증을 항상 여기서 한다.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/session";
import * as POLICY from "@/lib/login-policy";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { isBlockedForCompany } from "@/lib/ip-block";
import { loginAllowedForIp, publicActionAllowedForIp, recordThrottleHit, THROTTLED_META, SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_MIN } from "@/lib/login-throttle";
import { isValidBizRegNoFormat, formatBizRegNo, normalizeBizRegNo, verifyBizRegNo } from "@/lib/bizreg";
import { publicDoorAllows } from "@/lib/public-door";
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
  // 🔴 상한이 없으면 **로그인할 수 없는 계정**이 만들어진다 — 로그인은 200자에서 막기 때문이다.
  //    가입 직후엔 세션이 있어 [계정 설정]에서 고칠 수 있지만, 세션이 끊기면 되돌릴 길이 없다
  //    (회사 계정은 재설정 경로 두 개에서 모두 제외되므로 결과가 "회사 영구 잠금"이다).
  //    부수적으로 scrypt(수십 ms 동안 서버 전체를 멈추는 동기 연산)에 거대한 입력이 가는 것도 막지만,
  //    거긴 IP 제한·사업자번호 확인을 지나야 닿으므로 **주된 이유는 "못 들어가는 계정" 쪽**이다.
  //  ⚠️ 아래 IP 제한보다 **먼저** 본다 — 길이 오타 한 번에 가입 시도 횟수가 깎이면 안 된다.
  if (password.length > POLICY.PASSWORD_MAX_LEN) {
    return { error: `비밀번호는 ${POLICY.PASSWORD_MAX_LEN}자 이하로 입력해주세요.` };
  }
  if (!email.includes("@") || email.length < 5) {
    return { error: "이메일 형식이 올바르지 않습니다." };
  }
  // 🔴 비밀번호와 **같은 이유**의 상한이다(검수 치명 1). 로그인은 254자를 넘으면 거부하므로,
  //    여기서 막지 않으면 그 순간 **로그인할 수 없는 회사 계정**이 만들어진다 — 그리고 그 계정이
  //    사업자등록번호를 선점해 같은 회사가 다시는 가입하지 못한다(= 회사 영구 잠금).
  //    실수로 긴 글을 붙여넣는 것만으로도 일어난다.
  if (email.length > POLICY.EMAIL_MAX_LEN) {
    return { error: `이메일은 ${POLICY.EMAIL_MAX_LEN}자 이하로 입력해주세요.` };
  }
  // 연락처는 숫자만 남겨 9~11자리인지만 본다(하이픈·공백 자유). 실제 소유 확인은 문자 인증 도입 시(2차).
  if (!/^\d{9,11}$/.test(managerPhone.replace(/[^0-9]/g, ""))) {
    return { error: "담당자 연락처를 올바르게 입력해주세요." };
  }
  // 동의는 법적 필수 — 체크하지 않으면 가입시키지 않는다(개인정보보호법 제15조·제22조).
  if (!agreeTerms || !agreePrivacy) {
    return { error: "이용약관과 개인정보 수집·이용에 동의해주세요." };
  }

  // 🔴 [검수 C-1] 이 문 전체의 분당 상한. 아래 IP 제한은 `TRUST_PROXY=1`이 아니면 무동작이라,
  //    그 상태에서는 이 창구 하나로 ①scrypt(40ms 서버 정지) ②국세청 조회 쿼터 ③DB 조회·기록을
  //    무제한 태울 수 있다. 형식 검증을 모두 통과한 뒤·DB에 닿기 전에 센다.
  //    (로그인과 **다른 예산**을 쓴다 — 가입이 막혀도 직원들의 로그인은 열려 있어야 한다)
  if (!publicDoorAllows("signup")) {
    return { error: "지금 가입 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요." };
  }

  // 🔴 [검수 M-19] 가입은 로그인 없이 누구나 부를 수 있다 — 같은 IP에서 쏟아지는 시도를 막는다.
  //    막지 않으면 **국세청 사업자번호 조회 쿼터**를 태워 정상 가입까지 "확인 보류"로 떨어뜨릴 수 있다.
  //    ⚠️ 형식 검증(위)을 통과한 뒤에 센다 — 오타 한 번에 횟수가 깎이지 않게.
  //    ⚠️ 차단된 요청은 **기록하지 않는다**(검수 치명 3) — 막혀도 계속 쓰면 그 자체가 DB를 채우는 통로가 된다.
  //    ⚠️ IP를 모르면(TRUST_PROXY 미설정) 제한에 쓸 수 없으므로 기록도 하지 않는다.
  const signupClient = readClientMeta(await headers());
  if (!(await publicActionAllowedForIp(signupClient.ip, "signup", SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_MIN))) {
    // 거부 사실은 1분에 1건만 남긴다(감사 흔적은 남기되 적재 공격은 막는다 — 검수 2차 중간 4).
    await recordThrottleHit({ ip: signupClient.ip, kind: "public_request", meta: "signup_blocked", emailTried: email, userAgent: signupClient.userAgent });
    return { error: "가입 시도가 너무 잦습니다. 잠시 후 다시 시도해주세요." };
  }
  // 시도 자체를 남긴다(성공·실패 무관) — 이 기록이 곧 위 제한의 근거가 된다.
  if (signupClient.ip) {
    await recordAccess({ companyId: null, userId: null, emailTried: email.slice(0, 254), kind: "public_request", result: "success", ip: signupClient.ip, userAgent: signupClient.userAgent, meta: "signup" });
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
  // 비밀번호 해시는 **트랜잭션 밖에서** 미리 만든다 — 무거운 계산을 트랜잭션 안에서 돌리면
  // 그동안 DB 쓰기 잠금을 잡고 있게 된다(검수 2차 16).
  // ※ C-1로 비동기가 되어 서버가 멈추지는 않지만, **잠금을 오래 쥐는 문제는 그대로**라 위치는 유지한다.
  const passwordHash = await hashPassword(password);
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
          passwordHash,
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

// 로그인 무차별 대입(비번 찍기) 방어 — **규칙 전체가 lib/login-policy.ts에 있다.**
//  · 숫자(5회/10분)뿐 아니라 **판정 함수까지** 거기 것을 쓴다(검수 N-2). 예전에는 숫자만 가져오고
//    "실패하면 어떻게 되는가"는 이 파일이 직접 계산해서, 같은 것을 쓴다던 lib 쪽 함수와 규칙이
//    어긋나 있었다(잠글 때 횟수를 0으로 되돌리는지 여부가 달랐다).
//  · 비밀번호를 확인하는 다른 창구(계정 설정의 복구용 연락처 변경 등)도 같은 함수를 쓴다.

// 존재하지 않는 이메일에도 해시 비교를 한 번 돌리기 위한 더미 값(검수 M-17).
//  · 없는 계정이면 즉시 반환하던 예전 코드는 **응답 시간만으로 계정 존재를 알 수 있었다**(있으면 느리고 없으면 빠름).
//  · 이 값으로는 아무도 로그인할 수 없다.
//  · ⚠️ 예전에는 이 자리(파일이 읽히는 순간=서버 시작 시)에서 바로 만들었는데, C-1로 해시가 비동기가 되면서
//    **여기서는 만들 수 없다**(파일 맨 위에서는 기다릴 수 없다). 그래서 **처음 필요할 때 한 번** 만들고
//    그 뒤로는 재사용한다 — 서버 수명 동안 계산은 여전히 딱 1회다.
//  · 계산 결과가 아니라 **약속(Promise)을 담아 둔다.** 그래야 서버가 켜지자마자 동시에 여러 요청이
//    들어와도 계산이 여러 번 돌지 않는다(첫 요청이 만든 하나를 모두가 함께 기다린다).
//  · ⚠️ **실패하면 담아 둔 것을 비운다**(검수 2026-08-30 중간 2). 안 비우면 실패한 약속이 영원히 남아,
//    그 뒤로 **없는 이메일로 로그인할 때만 오류가 나고 있는 이메일은 정상 동작**한다
//    → 응답 종류만 보고 계정 존재를 100% 알아낼 수 있다(M-17이 없앤 계정 열거가 되살아난다).
//    서버를 재시작하기 전까지 스스로 낫지 않으므로 반드시 비운다.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("no-such-account-placeholder").catch((e) => {
      dummyHashPromise = null; // 다음 요청이 다시 시도한다
      throw e;
    });
  }
  return dummyHashPromise;
}

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
  // 길이 상한(검수 2차 치명 2·중간 3) — 없으면 ①본문 크기만큼 긴 문자열이 접속기록에 2년 보관되고
  // ②그 값으로도 scrypt가 돌아 서버가 멈춘다. 정상 입력은 절대 넘지 않는 값이다.
  if (email.length > POLICY.EMAIL_MAX_LEN || password.length > POLICY.PASSWORD_MAX_LEN) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 🔴 [검수 C-1] 이 문 전체의 분당 상한 — **서버가 죽는 것을 막는 최후의 안전판**이다.
  //    아래 IP 제한(loginAllowedForIp)은 `TRUST_PROXY=1`이 아니면 아무 일도 하지 않고,
  //    계정 5회 잠금은 "계정 하나"만 지킨다. 그래서 **인증 없이** 이 문에 요청을 쏟으면
  //    요청 1건마다 scrypt 1회(약 40ms 서버 전체 정지)가 돌아 직원들이 출퇴근을 찍지 못한다.
  //    ⚠️ 위치가 중요하다 — **DB 조회와 비밀번호 대조보다 앞**에 둬야 둘 다 아낀다.
  //       형식 오류(위 두 검사)보다는 뒤에 둔다: 오타 한 번에 분당 예산이 깎이면 안 된다.
  //    ⚠️ 거부 사실을 DB(접속기록)에 남기지 않는다 — 미인증 요청이 DB에 쓰게 하는 순간
  //       그 기록 자체가 새로운 공격 통로가 된다(login-throttle.ts 검수 치명 3과 같은 이유).
  //       대신 lib/public-door.ts가 서버 로그에 1분 1줄로 남긴다.
  //    ⚠️ 문구는 **모든 사람에게 동일**하다. 계정이 있든 없든 같은 응답이라 정보가 새지 않는다.
  if (!publicDoorAllows("login")) {
    return { error: "지금 로그인 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요." };
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

  // 🔴 [검수 M-17] IP 단위 시도 제한 — 계정 단위 5회 잠금만으로는 **계정을 바꿔가며 두드리는 공격**을 못 막는다.
  //    같은 IP에서 최근 10분간 실패가 임계치를 넘으면 잠시 거부한다. 사내망(officeIps)은 면제.
  //    ⚠️ 판정만 먼저 하고 **차단은 비밀번호를 확인한 뒤에** 한다(검수 치명 1) —
  //       비밀번호가 맞은 사람은 어떤 경우에도 막지 않는다. 사무실이 한 공인 IP를 함께 쓰는 구조에서
  //       "옆자리 직원이 여러 번 틀려서 나까지 출근을 못 찍는" 사고를 절대 만들지 않기 위함이다.
  const ipThrottled = !(await loginAllowedForIp(ip, user?.companyId ?? null));

  // 🔴 [검수 M-17] **비밀번호를 먼저 확인한다.**
  //    예전엔 퇴사·잠금 안내를 비밀번호 확인 전에 돌려줘, 아무 비번이나 넣어도 "이 계정은 비활성화되었습니다"라는
  //    응답으로 **그 이메일이 실재하는지** 알 수 있었다(계정 목록 수집 → 표적 공격).
  //    이제 비번이 맞은 사람에게만 진짜 이유를 알려준다 — 정상 사용자는 안내를 그대로 받고, 공격자는 아무것도 못 얻는다.
  //    ⚠️ 없는 이메일일 때도 해시 비교를 한 번 돌린다 — 응답 시간 차이로 존재를 알아내는 것을 막는다.
  //    ⚠️ 제한에 걸렸는데 **없는 계정**이면 해시를 돌리지 않고 바로 거부한다(검수 치명 2) —
  //       scrypt는 1회 약 40ms 동안 서버 전체를 멈추므로, 이미 제한 중인 IP에까지 그 값을 태우면
  //       제한이 CPU를 한 푼도 아껴주지 못한다(그 자체가 서비스 마비 통로).
  //       이미 거부 중인 IP에 응답이 빨라지는 것은 정보 노출이 아니다.
  if (ipThrottled && !user) {
    await recordThrottleHit({ ip, kind: "login_fail", meta: THROTTLED_META, emailTried: email, userAgent });
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // ⚠️ `await`를 빼면 약속(Promise)이 그대로 담기는데, 약속은 언제나 "참"이라 아래 `!passwordOk`가
  //    **항상 거짓**이 되어 비밀번호가 틀려도 로그인이 통과한다. tsc도 lint도 이 실수를 못 잡는다.
  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : (await verifyPassword(password, await dummyHash()), false);

  if (!user || !passwordOk) {
    // 실패 시: 실제 계정이면 실패 횟수를 올리고, 한도 도달하면 잠근다.
    //  ⚠️ **이미 잠긴 계정은 더 올리지 않는다**(검수 중간 2) — 예전엔 잠긴 계정에 계속 두드리면
    //     5회마다 잠금이 새로 10분씩 갱신돼 그 직원이 영영 못 들어오는 사고가 났다.
    //  ⚠️ IP 제한에 걸린 시도도 **똑같이 센다**(검수 2차 치명 1) — 예전엔 여기서 건너뛰었는데,
    //     그러면 공격자가 쓰레기 이메일 50건으로 스스로 제한을 켜 놓고 표적 계정을 무제한으로
    //     두드릴 수 있었다(계정 5회 잠금이 통째로 꺼짐). 이 저장소의 유일한 대입 방어를 지켜야 한다.
    //  ⚠️ 잠금 여부 판정을 **코드가 아니라 DB가** 하게 맡긴다(재검수 치명 1).
    //     여기서 쓰는 `user`는 위(185행)에서 읽은 사진이고, 그 뒤 비밀번호 대조(scrypt, 수십 ms)가 끼어 있다.
    //     그 사이에 다른 요청이 5회째를 채워 잠갔다면, 코드가 "안 잠겼다"고 믿고 쓴 값이
    //     **방금 걸린 잠금을 지운다.** 조건을 where에 넣으면 그 창이 닫힌다.
    if (user) await POLICY.recordFail(prisma, user);
    // 접속기록: 실패 1건. 존재하지 않는 이메일이면 소속 회사를 알 수 없어 companyId=null(회사별 화면엔 안 보임).
    //  · 제한에 걸린 시도는 **1분에 1건만** 남긴다 — 무제한 적재로 진짜 기록을 밀어내지 않게(검수 2차 중간 2).
    //    같은 kind(login_fail)로 남기므로 [이상접속]·[차단 후보] 감시에도 그대로 잡힌다.
    if (ipThrottled) {
      await recordThrottleHit({ ip, kind: "login_fail", meta: THROTTLED_META, companyId: user?.companyId ?? null, userId: user?.id ?? null, actorName: user?.name ?? null, emailTried: email, userAgent });
    } else {
      await recordAccess({ companyId: user?.companyId ?? null, userId: user?.id ?? null, actorName: user?.name ?? null, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "bad_credentials" });
    }
    // 보안: 이메일/비번 중 무엇이 틀렸는지 구분해 알려주지 않는다.
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // ── 여기부터는 **비밀번호가 맞은 사람**이다. 이제야 진짜 이유를 알려줘도 정보가 새지 않는다(검수 M-17). ──

  // 퇴사(비활성화)된 계정은 로그인 불가.
  if (user.deactivatedAt) {
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "deactivated" });
    return { error: "이 계정은 비활성화되었습니다. 관리자에게 문의하세요." };
  }

  // 계정이 잠겨 있으면(연속 실패로 잠금) 비번이 맞아도 잠금 해제 시각까지 거부.
  //  · 남은 시간 계산도 lib/login-policy.ts 것을 쓴다 — 창구마다 "약 N분"이 다르게 나오지 않게(검수 N-2).
  const lockMins = POLICY.lockRemainMinutes(user.lockedUntil);
  if (lockMins !== null) {
    const mins = lockMins;
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "locked" });
    return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${mins}분 뒤에 다시 시도해주세요.` };
  }

  // 🔒 임시 비밀번호 만료 검사(검수 H-4).
  //   문자로 받은 임시 비밀번호를 며칠 뒤에도 계속 쓸 수 있으면, 문자 유출이 곧 계정 탈취가 된다.
  //   만료됐으면 로그인시키지 않고 다시 재설정을 요청하도록 안내한다.
  if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login_fail", result: "fail", ip, userAgent, meta: "temp_password_expired" });
    return { error: "임시 비밀번호의 사용 기한(48시간)이 지났습니다. 비밀번호 재설정을 다시 요청해주세요." };
  }

  // 성공 시: 실패 기록·잠금 초기화(이것도 lib/login-policy.ts 창구를 쓴다 — 검수 N-2).
  //  ⚠️ 이 쓰기에도 "지금 잠겨 있지 않을 때만" 조건이 걸려 있다 — 실패 쪽만 원자적으로 고치면
  //     성공 쪽이 같은 모양으로 잠금을 지운다(재재검수 중간 4).
  if (user.failedLoginCount !== 0 || user.lockedUntil) {
    await POLICY.recordSuccess(prisma, user.id);
  }

  // 역할을 이미 손에 들고 있으므로 넘겨준다 — createSession이 같은 행을 다시 읽지 않게(검수 중간 8).
  await createSession(user.id, { role: user.role, isOwner: user.isOwner });
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
  // allowMustChange: 임시 비밀번호 상태에서도 로그아웃(강제 변경 화면의 유일한 출구)은 되어야 한다(9-C).
  const me = await getCurrentUser({ allowMustChange: true });
  if (me) {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({ companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email, kind: "logout", result: "success", ip, userAgent });
  }
  await destroySession();
  redirect("/");
}
