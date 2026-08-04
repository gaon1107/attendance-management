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

  // "이름(상세)" 분리 — **콜론 분리보다 먼저** 판정한다(검수 치명 1).
  //  소급 변경 감사기록은 상세에 시각이 들어간다: work_rules(출근 09:00→10:00, ...).
  //  콜론을 먼저 보면 "work_rules(출근 09"에서 잘려 라벨을 못 찾고 **화면·엑셀이 통째로 공란**이 된다.
  const par = meta.indexOf("(");
  if (par > 0 && meta.endsWith(")")) {
    const base = baseMetaLabel(meta.slice(0, par));
    const detail = meta.slice(par + 1, -1).trim();
    if (base && detail) return `${base} · ${detail}`;
    if (base) return base;
    return detail; // 라벨을 모르는 이름이어도 상세는 보여준다(빈칸보다 낫다)
  }

  // "이름:대상" 분리 — 첫 콜론만 기준(대상 이름에 콜론이 있어도 안전).
  const sep = meta.indexOf(":");
  if (sep > 0) {
    const base = baseMetaLabel(meta.slice(0, sep));
    const extra = meta.slice(sep + 1).trim();
    if (base && extra) return `${base} · 대상: ${extra}`;
    if (base) return base;
    return "";
  }
  return baseMetaLabel(meta);
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
    // 생체정보 파기 경로(actions/authmethod.ts)
    admin_revoke: "관리자 파기",
    self_withdraw: "본인 철회",
    switch_to_gps: "본인 GPS 전환",
  };
  return Object.hasOwn(map, meta) ? map[meta] : "";
}
