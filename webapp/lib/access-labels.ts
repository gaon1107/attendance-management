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

// 실패 사유(meta) → 사람이 읽을 설명(로그인 실패 분석용). 알 수 없으면 빈 문자열.
export function accessMetaLabel(meta: string | null | undefined): string {
  if (!meta) return "";
  const map: Record<string, string> = {
    deactivated: "비활성(퇴사) 계정",
    locked: "잠금 상태",
    bad_credentials: "비밀번호 불일치",
  };
  return map[meta] ?? "";
}
