"use client";
// 공지 화면을 열면 자동으로 "모두 읽음" 처리 → 직원 홈의 "새 알림" 배지를 지운다.
import { useEffect } from "react";
import { markNoticesSeen } from "@/app/actions/notice";

export function MarkNoticesSeen() {
  useEffect(() => {
    markNoticesSeen();
  }, []);
  return null;
}
