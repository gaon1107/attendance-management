// 공개 사이트 정보 — 검색엔진·AI 검색 노출용(2026-11-23 사장님 "추천대로 진행").
//  sitemap.xml · 홈 메타데이터(제목·공유 미리보기·구조화 정보) · /llms.txt 가 이 한 곳을 본다.
//  ⚠️ app/robots.txt 는 고정 파일이라(다음 웹마스터도구 확인 줄) 주소를 직접 적었다 — 도메인을 바꾸면 거기도 함께 고칠 것.
//  ⚠️ 도메인을 바꾸면 여기만 고친다. 비밀값이 아니다(누구나 보는 공개 주소).
import { TRIAL_DAYS } from "@/lib/trial";

export const SITE_URL = "https://attend.newgaon.com";
/** 검색 결과·공유 미리보기에 보이는 제품 이름. 약관·방침이 쓰는 이름("가온 근태관리")과 같아야 한다. */
export const SITE_NAME = "가온 근태관리";
/** 검색 결과 설명 — 홈 화면에 실제로 있는 내용만(표시광고 — 홈 화면 문구 근거 주석 참조). */
export const SITE_DESCRIPTION =
  `중소기업 사무직을 위한 웹 근태관리 서비스. 외출을 뺀 정직한 실근무시간, 직원이 고르는 얼굴인증·GPS 출퇴근, 주 52시간 관리와 근로시간 기록 3년 보존. ${TRIAL_DAYS}일 무료 체험.`;
/** 검색엔진에 알릴 공개 페이지(로그인 없이 내용이 보이는 곳만). */
export const PUBLIC_PATHS = ["/", "/terms", "/privacy"] as const;
