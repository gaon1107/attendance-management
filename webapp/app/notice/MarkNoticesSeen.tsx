"use client";
// 공지 화면(또는 그 달 공지가 있는 캘린더)을 열면 "모두 읽음" 처리 → 직원 홈의 "새 알림" 배지를 지운다.
// active=false면 실행하지 않는다(예: 캘린더에서 이번 달에 안 읽은 공지가 없을 때 → 배지를 지우지 않음).
import { useEffect } from "react";
import { markNoticesSeen } from "@/app/actions/notice";

export function MarkNoticesSeen({ active = true }: { active?: boolean }) {
  useEffect(() => {
    if (active) markNoticesSeen();
  }, [active]);
  return null;
}
