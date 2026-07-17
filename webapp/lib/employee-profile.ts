// [직원 인적정보 파싱·검증] 선택 항목(전화번호·직급·사번·입사일) 폼값 → 저장값 정규화.
// 초대 가입(acceptInvite)과 관리자 수정(updateEmployeeProfile)에서 공용으로 쓴다.
// 전부 선택 항목이라 비어 있으면 null로 저장한다(빈 칸으로 저장 = 값 삭제).
// 잘못된 입력은 조용히 자르거나 굴리지 않고(무결성 우선) 안내 에러로 되돌린다.

import { prisma } from "@/lib/db";

export type ProfileInput = {
  phone: string | null;
  position: string | null;
  employeeNo: string | null;
  hireDate: Date | null;
};

export type ProfileParse = { ok: true; profile: ProfileInput } | { ok: false; error: string };

const MAX_LEN = 60; // 각 문자 항목 길이 상한(과도한 입력 방지)

// 문자 항목: 앞뒤 공백 제거 후 비면 null. 상한 초과면 (무통보 절단 대신) 에러.
// 길이는 코드포인트 기준(Array.from)으로 세어 이모지·서러게이트 페어가 경계에서 깨지지 않게 한다.
function text(v: FormDataEntryValue | null, label: string): { value: string | null } | { error: string } {
  const s = String(v ?? "").trim();
  if (!s) return { value: null };
  if (Array.from(s).length > MAX_LEN) return { error: `${label}은(는) ${MAX_LEN}자 이내로 입력해 주세요.` };
  return { value: s };
}

// 날짜 항목: "YYYY-MM-DD"(input type=date)만 허용. 로컬 자정 Date로 만들되,
// new Date는 2024-02-30 같은 없는 날짜를 3/1로 굴리므로 구성요소가 그대로인지 재검해 무효일을 거부한다.
function date(v: FormDataEntryValue | null): { value: Date | null } | { error: string } {
  const s = String(v ?? "").trim();
  if (!s) return { value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { error: "입사일 형식이 올바르지 않습니다(YYYY-MM-DD)." };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(y, mo - 1, da); // 로컬 자정 (표시·폼복원 ymdInput과 동일 로컬 기준)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
    return { error: "실제로 존재하지 않는 날짜입니다. 입사일을 다시 확인해 주세요." };
  }
  return { value: d };
}

export function parseProfile(fd: FormData): ProfileParse {
  const phone = text(fd.get("phone"), "전화번호");
  if ("error" in phone) return { ok: false, error: phone.error };
  const position = text(fd.get("position"), "직급/직책");
  if ("error" in position) return { ok: false, error: position.error };
  const employeeNo = text(fd.get("employeeNo"), "사번");
  if ("error" in employeeNo) return { ok: false, error: employeeNo.error };
  const hireDate = date(fd.get("hireDate"));
  if ("error" in hireDate) return { ok: false, error: hireDate.error };

  return {
    ok: true,
    profile: {
      phone: phone.value,
      position: position.value,
      employeeNo: employeeNo.value,
      hireDate: hireDate.value,
    },
  };
}

// [사번 중복검사] 같은 회사에 같은 사번을 쓰는 "다른 활성 직원"이 있는지 확인한다.
//  · 초대가입·관리자수정 두 저장 경로가 같은 규칙을 쓰도록 공용화(email 중복검사와 같은 앱단 방식).
//  · employeeNo=null(미입력)이면 중복 대상이 아니므로 검사하지 않는다(여러 명 미입력 허용).
//  · deactivatedAt=null(활성)만 대상 → 퇴사자 사번은 신입이 재사용 가능(과거 기록은 그대로 보존).
//  · exceptUserId: 본인 제외(관리자 수정 시 자기 사번 유지한 채 다른 항목만 고쳐도 자기충돌 오탐 방지).
//  ※ 앱단 검사라 이론상 동시제출 경쟁(TOCTOU)은 완벽 차단이 아니다(관리자 1명·간헐 가입이라 실사용 위험 극소).
export async function employeeNoTaken(
  companyId: string,
  employeeNo: string | null,
  exceptUserId?: string
): Promise<boolean> {
  if (!employeeNo) return false; // 미입력은 중복검사 대상 아님
  const dup = await prisma.user.findFirst({
    where: {
      companyId,
      employeeNo,
      deactivatedAt: null,
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
    },
    select: { id: true },
  });
  return !!dup;
}
