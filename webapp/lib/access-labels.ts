// 접속 이벤트 표시용 한글 라벨 (순수 모듈 — prisma·서버 의존성 없음. 화면·엑셀 어디서든 재사용).
import type { AccessKind } from "@/lib/access-log";

// 동작 종류 → 한글 라벨
export function accessKindLabel(kind: string): string {
  const map: Record<AccessKind, string> = {
    login: "로그인",
    login_fail: "로그인 실패",
    logout: "로그아웃",
    clock_in: "출근",
    clock_out: "퇴근",
    config: "설정 변경",
    purge: "생체정보 파기",
    data_view: "데이터 조회",
    blocked: "접속 차단",
    public_request: "비로그인 요청",
  };
  return map[kind as AccessKind] ?? kind;
}

// 결과 → 한글 라벨
export function accessResultLabel(result: string): string {
  if (result === "success") return "성공";
  if (result === "fail") return "실패";
  if (result === "blocked") return "차단";
  return result;
}

// 부가정보(meta) → 사람이 읽을 설명. 알 수 없으면 빈 문자열.
//  · 로그인 실패 사유 + 출퇴근 근무형태 + 관리자 동작 대상을 함께 다룬다.
//  · "이름:대상" 형식도 지원한다(예: "admin_revoke:박성헌" → "관리자 파기 · 대상: 박성헌").
//    관리자 파기는 "누구의" 생체정보를 지웠는지가 감사의 핵심이라 대상을 함께 남긴다.
export function accessMetaLabel(meta: string | null | undefined): string {
  if (!meta) return "";

  // meta는 세 조각까지 담는다: `이름[:대상][ (상세)]`
  //   예) "work_rules(출근 09:00→10:00)" · "clock_photo:홍길동 (a1b2c3)" · "ip_block_add:1.2.3.4"
  //
  //  ⚠️ **끝의 괄호를 먼저 떼고, 남은 앞부분에 콜론 분리를 적용한다.** 순서가 중요하다:
  //   · 콜론을 먼저 보면 "work_rules(출근 09"에서 잘려 라벨을 못 찾고 화면·엑셀이 **공란**이 된다.
  //   · 괄호만 보고 끝내면 "clock_photo:홍길동 (a1b2c3)"이 **"a1b2c3"**만 남아 누구 사진을 봤는지 사라진다.
  //   둘 다 실제로 겪은 실수라 여기 적어 둔다.
  let head = meta;
  let detail = "";
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(meta);
  if (m) {
    head = m[1];
    detail = m[2].trim();
  }

  // "이름:대상" 분리 — 첫 콜론만 기준(대상 이름에 콜론이 있어도 안전).
  const sep = head.indexOf(":");
  const base = baseMetaLabel(sep > 0 ? head.slice(0, sep) : head);
  const target = sep > 0 ? head.slice(sep + 1).trim() : "";

  const parts: string[] = [];
  if (base) parts.push(base);
  if (target) parts.push(`대상: ${target}`);
  if (detail) parts.push(detail);
  // 이름을 모르면(사전에 없는 값) 상세라도 보여준다 — 빈칸보다 낫다.
  if (!base && !target) return detail;
  return parts.join(" · ");
}

// meta의 "이름" 부분 → 한글 라벨
function baseMetaLabel(meta: string): string {
  const map: Record<string, string> = {
    // 로그인 실패 사유
    deactivated: "비활성(퇴사) 계정",
    locked: "잠금 상태",
    bad_credentials: "비밀번호 불일치",
    // 출퇴근 근무형태(actions/attendance.ts가 meta에 넣는 값)
    office: "사무실",
    home: "재택",
    field: "외근",
    // 관리자 설정 변경 대상(actions/settings.ts가 meta에 넣는 값 — 값이 아니라 "어느 설정"인지만)
    office_location: "사업장 위치",
    office_network: "사내 네트워크 허용 IP",
    face_rule: "얼굴 인식 기준",
    liveness_rule: "본인 확인 재검토 기준",
    work_rules: "근무제·기준시간",
    // 공휴일·회사휴무일 — 지난 날짜를 건드리면 그날의 결근·지각 판정이 다시 쓰인다(소급 변경).
    //  ⚠️ 이 두 키는 예전부터 액션이 기록해 왔는데 map에 없어 화면이 계속 공란이었다(검수 치명 1에서 함께 발견).
    holiday_auto: "법정공휴일 자동반영",
    holiday_sync: "공휴일 데이터 갱신",
    company_holiday_add: "회사 휴무일 등록",
    company_holiday_del: "회사 휴무일 해제",
    // 생체정보 동의 개시(actions/authmethod.ts) — 수집 시작 시점. 파기와 짝을 이루는 감사 기록.
    biometric_consent: "생체정보 동의",
    biometric_reconsent: "생체정보 재동의",
    // 차단 IP 관리(actions/ip-block.ts) — "이름:대상" 형식으로 어떤 IP인지 함께 남긴다
    ip_block_add: "차단 IP 추가",
    ip_block_remove: "차단 IP 해제",
    // 이상접속 알림(6단계) — 감지 기준 변경 + "확인함" 처리
    alert_rules: "이상접속 감지 기준",
    security_checked: "이상접속 확인",
    // PC-OFF(근무시간 외 PC 잠금) — actions/pcoff.ts. 노무 분쟁 소지가 큰 기능이라 "무엇을 바꿨나"가 남아야 한다.
    pcoff_rule: "PC-OFF 잠금 규칙",
    pcoff_exempt: "PC-OFF 잠금 예외자",
    pcoff_device_revoke: "PC 연결 해제",
    pcoff_pair_code_admin: "PC 연결코드 대신 발급",
    pcoff_admin_pair_connected: "관리자 발급 코드로 PC 연결",
    // 생체정보 열람(app/api/clock-photo) — "clock_photo:직원이름" 형식으로 누구 사진을 봤는지 남긴다
    clock_photo: "출퇴근 사진 열람",
    // 비로그인 창구(actions/auth.ts·password-reset.ts) — 남용 감지용
    signup: "회원가입 시도",
    signup_blocked: "회원가입 시도 차단(과다 요청)",
    reset_request: "비밀번호 재설정 요청",
    reset_request_blocked: "재설정 요청 차단(과다 요청)",
    // 비밀번호 찾기 문자 인증(lib/reset-code.ts·actions/password-reset.ts)
    //  ⚠️ 액션에 새 meta를 넣으면 **반드시 여기도 함께 넣는다.** 빠뜨리면 [보안]-[접속기록] 화면과
    //     엑셀에서 "무슨 일인지" 칸이 빈칸으로 나온다(같은 실수가 두 번 났다).
    reset_code_sent: "비밀번호 찾기 인증번호 발송",
    reset_code_wrong: "인증번호 오입력",
    reset_code_blocked: "인증번호 요청 차단(과다 요청)",
    reset_code_verify_blocked: "인증번호 확인 차단(과다 요청)",
    password_reset_by_sms_code: "본인 비밀번호 재설정(문자 인증)",
    // 운영자(본사) 본인 계정 변경 — /operator/account. (2026-11-20 추가)
    //  🔴 이 세 줄이 없으면 [운영자 접속 기록]에서 **"무슨 일인지"가 공란("—")**으로 나온다.
    //     그러면 비밀번호를 찍어 본 시도가 로그인 문에서 난 실패와 구분되지 않아, 월 1회 기록을
    //     훑어보는 운영 점검이 가장 중요한 두 사건에서 작동하지 않는다(검수 치명 2).
    operator_password_change: "운영자 본인 비밀번호 변경",
    operator_password_change_denied: "운영자 비밀번호 변경 실패(현재 비밀번호 오류)",
    operator_name_change: "운영자 본인 이름 변경",
    // 서버 명령(scripts/create-operator.mjs --email)으로 로그인 아이디를 바꾼 사건.
    operator_email_change: "운영자 아이디(이메일) 변경",
    // 회사 계정(마스터 열쇠)의 복구 기준이 바뀌는 사건 — 가장 무겁게 봐야 할 기록이다.
    owner_recovery_phone_change: "회사 계정 복구용 연락처 변경",
    //  · 실패는 성공과 **다른 이름**을 쓴다. 같으면 접속기록에서 실패 시도까지 "변경 5건"처럼 읽혀
    //    진짜 변경이 몇 번이었는지 알 수 없다.
    owner_recovery_phone_denied: "회사 계정 복구용 연락처 변경 실패(비밀번호 오류)",
    //  · 통지 문자가 못 나갔다는 뜻 = **"몰래 바뀌면 즉시 안다"는 탐지 장치가 그날 꺼졌다**는 뜻이다.
    //    화면에는 이미 "발송 요청했습니다"가 나간 뒤라, 이 기록이 유일한 흔적이다.
    owner_recovery_notice_failed: "회사 계정 연락처 변경 통지 발송 실패",
    // 본인 비밀번호 변경(actions/account.ts changePassword) — 로그인과 같은 5회 잠금이 걸려 있다.
    //  · 실패는 kind="login_fail"로 남긴다 — [이상접속]·[차단 후보]가 그 종류만 세기 때문(재검수 M-3).
    password_change: "본인 비밀번호 변경",
    password_change_denied: "본인 비밀번호 변경 실패(현재 비밀번호 오류)",
    // ── 아래 5건은 액션이 기록하는데 사전에 없어 **화면·엑셀에서 공란**이던 것들(2026-08-16 전수 대조) ──
    temp_password_expired: "임시 비밀번호 기한 만료",
    password_reset: "관리자 비밀번호 재설정",
    employee_add: "직원 추가",
    deactivate_employee: "직원 비활성화(퇴사)",
    outing_reasons: "외출 사유 목록 변경",
    login_ip_throttled: "로그인 시도 차단(같은 IP 과다 실패)",
    // 생체정보 파기 경로(actions/authmethod.ts)
    admin_revoke: "관리자 파기",
    self_withdraw: "본인 철회",
    switch_to_gps: "본인 GPS 전환",
    // 2026-11-19 운영 준비 5단계 — 퇴사 처리 때 자동 파기(actions/employees.ts), 재동의 전 남은 얼굴 정리(actions/authmethod.ts)
    deactivate_biometric: "퇴사 자동 파기",
    consent_leftover_cleanup: "재동의 전 남은 얼굴 삭제",
    // 운영자(본사) 기록 — app/actions/operator.ts(로그인)·operator-companies.ts(회원사 변경)·운영자 회사 상세 열람.
    //  고객사 화면에는 나오지 않고(companyId=null) /operator/access 에서만 본다. 2026-11-18 운영 준비 3단계.
    operator_login: "운영자 로그인",
    operator_logout: "운영자 로그아웃",
    operator_bad_credentials: "운영자 비밀번호 불일치",
    operator_inactive: "꺼진 운영자 계정",
    operator_locked: "운영자 계정 잠금 상태",
    operator_company_view: "회원사 상세 열람",
    operator_company_list: "회원사 목록 열람",
    operator_trial_set: "무료 이용 기간 변경",
    operator_demo_on: "시험용 회사로 표시",
    operator_demo_off: "시험용 표시 해제",
  };
  return Object.hasOwn(map, meta) ? map[meta] : "";
}
