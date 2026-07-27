"use server";
// 얼굴 등록/삭제 — 본인(직원)만. 얼굴인증 동의자에 한함.
// FaceId=본인 id, Group=본인 회사 id(회사별 격리). 얼굴 원본은 우리 DB에 저장 안 함(얼굴서버에만).
// 예외(확정 2026-07-11): 출퇴근 촬영 사진은 암호화해 90일 보관(동의 화면에 명시) — 관리자 재검토용.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { enrollFace, unenrollFace, recognizeFace, detectFaces, isFaceConfigured, type FaceRect } from "@/lib/face";
import { clockIn, clockOut } from "@/app/actions/attendance";
import { analyzeFace } from "@/lib/liveness";
import { faceBrightness } from "@/lib/quality";
import { saveClockPhoto, purgeExpiredPhotos, PHOTO_CONSENT_SINCE } from "@/lib/clock-photo";

type ActionResult = {
  ok: boolean;
  message: string;
  count?: number;
  // 등록 시 서버가 인식한 얼굴 위치(보낸 사진 좌표계) — 화면에 검출 영역 표시용
  faceRect?: { x: number; y: number; width: number; height: number };
  imageSize?: { width: number; height: number };
};

const MAX_ENROLL = 3; // 각도를 다르게 최대 3회까지 등록(인식 정확도 향상)

// [얼굴 크기 검사] 얼굴 폭이 화면 폭의 회사 기준(%) 미만이면 다시 찍게 한다.
// 멀리 든 사진(작은 얼굴)의 부정 사용을 막고 판독(라이브니스) 신뢰도를 높인다. 픽셀이 아닌 "비율"이라 카메라 해상도와 무관.
const FACE_TOO_SMALL_MSG = "얼굴이 작게 나왔습니다. 화면의 타원 안에 얼굴이 차도록 가까이 와서 다시 촬영해 주세요.";

async function getFaceMinPercent(companyId: string): Promise<number> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { faceMinPercent: true } });
  const v = company?.faceMinPercent ?? 30;
  return v >= 10 && v <= 50 ? v : 30; // 저장값이 손상돼도 안전한 범위로 (상한 50 — 가이드 타원과 모순되지 않는 범위)
}

function faceTooSmall(
  rect: FaceRect | undefined,
  imageSize: { width: number; height: number } | undefined,
  minPercent: number
): boolean {
  // 위치·크기 정보가 없으면 크기 검사를 건너뛴다(검사 불가로 출퇴근을 막지 않음 — 가용성 우선)
  if (!rect || !imageSize || !imageSize.width || !imageSize.height) {
    console.log("[face] 크기 검사 건너뜀 — 응답에 얼굴 위치/이미지 크기 없음(얼굴서버 응답 형식 확인 필요)");
    return false;
  }
  // 기준은 "사용자가 실제로 본 화면(4:3, 좌우 잘림)"의 폭 — 16:9 카메라(1280×720)는 전송 사진보다
  // 화면에 보이는 폭이 좁으므로, 전송 사진 폭으로 재면 타원 안내와 어긋난다(검수 지적).
  const visibleWidth = Math.min(imageSize.width, (imageSize.height * 4) / 3);
  return (rect.width / visibleWidth) * 100 < minPercent;
}

// 내 얼굴 등록 — 웹캠으로 찍은 사진(FormData "image")을 얼굴서버에 등록한다.
export async function enrollMyFace(formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };
  // 🔒 회사 계정은 사람이 아니다 — 얼굴이 등록되면 [생체정보] 목록에 안 떠 파기할 수 없다(검수 2차 3).
  if (me.isOwner) return { ok: false, message: "회사 계정은 이 기능을 사용할 수 없습니다." };
  if (!isFaceConfigured()) return { ok: false, message: "얼굴서버 설정이 없습니다. 관리자에게 문의하세요." };
  // 얼굴인증을 선택하고 생체정보에 동의한 사람만 등록 가능(강제 아님·동의 우선)
  if (me.authMethod !== "face" || !me.faceConsentAt) {
    return { ok: false, message: "먼저 [인증방식]에서 얼굴인증 선택과 생체정보 동의가 필요합니다." };
  }
  // 최대 3회까지만 등록
  if (me.faceEnrollCount >= MAX_ENROLL) {
    return { ok: false, message: `이미 최대 ${MAX_ENROLL}회까지 등록되어 있습니다.`, count: me.faceEnrollCount };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "얼굴 사진이 없습니다. 다시 촬영해 주세요." };
  // 안전장치: 너무 큰 이미지 거부(서버액션 1MB 제한). 화면에서 이미 축소해 보냄.
  if (file.size > 900 * 1024) return { ok: false, message: "사진 용량이 너무 큽니다. 다시 시도해 주세요." };

  const buffer = Buffer.from(await file.arrayBuffer());

  // 등록 전에 얼굴 크기(비율) 확인 — 작은 얼굴로 등록되면 이후 인식이 계속 부정확해지므로 여기서 거른다.
  // 검출 자체가 실패하면(서버 오류 등) 검사를 건너뛰고 기존 등록 흐름에 맡긴다(등록 판정은 얼굴서버가 함).
  const det = await detectFaces(buffer);
  if (det.success && det.faces.length > 1) {
    // 어느 얼굴이 등록될지 알 수 없으므로(작은 얼굴이 등록되는 구멍 방지) 혼자 나오게 요청
    return { ok: false, message: "얼굴이 여러 개 감지되었습니다. 혼자 화면에 나오도록 다시 시도해 주세요." };
  }
  if (det.success && det.faces.length === 1 && faceTooSmall(det.faces[0], det.imageSize, await getFaceMinPercent(me.companyId))) {
    return { ok: false, message: FACE_TOO_SMALL_MSG };
  }

  const result = await enrollFace(buffer, me.id, me.companyId);
  if (!result.success) {
    return { ok: false, message: result.message || "얼굴 등록에 실패했습니다. 밝은 곳에서 정면으로 다시 시도해 주세요." };
  }

  const newCount = Math.min(MAX_ENROLL, me.faceEnrollCount + 1);
  await prisma.user.update({ where: { id: me.id }, data: { faceEnrolledAt: new Date(), faceEnrollCount: newCount } });
  revalidatePath("/face-enroll");
  revalidatePath("/attendance");
  return { ok: true, message: `${newCount}번째 얼굴 등록 완료`, count: newCount, faceRect: result.faceRect, imageSize: result.imageSize };
}

// [본인확인 공통] 웹캠 사진을 얼굴서버에 물어 "본인 얼굴"인지 확인한다.
// 성공 조건: 인식된 FaceId == 로그인한 직원 id (다른 사람 얼굴로 출퇴근 방지)
async function verifyMyFace(
  me: { id: string; companyId: string; authMethod: string | null; faceEnrolledAt: Date | null },
  formData: FormData
): Promise<{ ok: boolean; message: string; buffers?: Buffer[]; faceRect?: FaceRect }> {
  if (!isFaceConfigured()) return { ok: false, message: "얼굴서버 설정이 없습니다. 관리자에게 문의하세요." };
  if (me.authMethod !== "face" || !me.faceEnrolledAt) {
    return { ok: false, message: "얼굴인증 선택과 얼굴 등록이 먼저 필요합니다." };
  }

  // 연속 3장(위조 판독용). 1장만 와도 호환 동작. 본인확인(recognize)은 첫 장으로 1회만 수행 — 얼굴서버 429(연속 detect 폭주) 회피.
  const received = formData.getAll("image").filter((f): f is File => f instanceof File && f.size > 0);
  if (received.length === 0) return { ok: false, message: "얼굴 사진이 없습니다. 다시 촬영해 주세요." };
  if (received.length > 3) return { ok: false, message: "사진은 최대 3장까지 처리합니다. 다시 시도해 주세요." };
  // 용량 초과 프레임은 버리고 정상 장으로 진행한다(가용성 우선 — 한 장이 커도 얼굴 출퇴근이 막히지 않게).
  // 전부 초과일 때만 안내. 판독은 남은 장으로 하고, 남은 장이 없으면 인증만 진행할 수 없다.
  const files = received.filter((f) => f.size <= 900 * 1024);
  if (files.length === 0) return { ok: false, message: "사진 용량이 너무 큽니다. 다시 시도해 주세요." };

  const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const result = await recognizeFace(buffers[0], me.companyId);
  if (!result.success) {
    return { ok: false, message: result.message || "얼굴을 확인하지 못했습니다. 다시 시도해 주세요." };
  }
  if (result.faceId !== me.id) {
    // 같은 회사의 다른 직원 얼굴로 인식된 경우
    return { ok: false, message: "본인 얼굴로 확인되지 않았습니다. 본인만 화면에 나오도록 다시 시도해 주세요." };
  }
  // 본인이 맞아도 얼굴이 기준(회사 설정 %)보다 작으면 다시 찍게 한다 — 멀리 든 사진 부정 차단 + 판독 신뢰도 확보
  if (faceTooSmall(result.faceRect, result.imageSize, await getFaceMinPercent(me.companyId))) {
    // 부정 시도 추적용 — 크기 미달 거절은 출퇴근·사진 기록이 안 남으므로 서버 로그에라도 남긴다(검수 지적)
    console.log(`[face] 크기 미달 거절 — 직원 ${me.id}, 얼굴 폭 ${result.faceRect ? Math.round((result.faceRect.width / Math.min(result.imageSize!.width, (result.imageSize!.height * 4) / 3)) * 100) : "?"}%`);
    return { ok: false, message: FACE_TOO_SMALL_MSG };
  }
  // 성공 시 사진(전 장)·얼굴 위치를 함께 반환 — 출퇴근 후처리(판독·사진 이력)에서 재사용
  return { ok: true, message: "본인 확인 완료", buffers, faceRect: result.faceRect };
}

// [위조 판독 — 모델별 차등 판정 기준] (D:\사진판독 실측·검증, 2026-07-11 이식)
// 두 판독 AI에 서로 다른 합격선을 둔다: 모델 A(V1SE)는 저조도에 약해 낮게, 모델 B(V2)는 실질 판별자라 높게.
//   진짜 얼굴: 모델 B ≥ 약 93% / 위조(오려낸 사진·화면): 모델 B ≤ 약 60% 로 크게 갈린다.
// 연속 3장이 모두 (모델A ≥ MODEL_A_THRESHOLD) 그리고 (모델B ≥ 모델B기준) 통과해야 "진짜(ok)", 아니면 "재검토(suspect)".
// ⚠️ 이 값들은 데모 카메라 실측값이다 — 근태 현장 카메라·조명에서 재확인 후 확정할 것(근태적용_가이드 8항).
const MODEL_A_THRESHOLD = 0.6; // 모델 A(V1SE) 최소 진짜확률 — 저조도 오탐 방지 위해 낮게 고정(코드 상수)
const MODEL_B_DEFAULT = 0.85; // 모델 B(V2) 기본 기준 — 설정값이 없거나 옛 저장값(70 미만)일 때의 안전 기본

// 모델 B(V2) 판정 기준값(0~1). 회사 설정 [설정 → 본인 확인 재검토 기준]이 우선.
// 설정 슬라이더는 이제 "모델 B 기준(%)"을 뜻한다. 옛 의미(평균 기준)로 저장된 낮은 값(예 50)을
//   모델 B 기준으로 그대로 쓰면 위조를 놓치므로, 70 미만/무효 값은 안전 기본(0.85)으로 올려 폴백한다(마이그레이션 없이 안전).
// ⚠️ 조회 실패가 예외로 번지면 판독이 끝난 사진·기록 저장까지 유실되므로(recordClockPhoto의 바깥 catch)
//    여기서는 절대 던지지 않고 예비값으로 폴백한다(검수 반영).
async function getModelBThreshold(companyId: string): Promise<number> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { livenessPercent: true } });
    const p = company?.livenessPercent;
    if (typeof p === "number" && Number.isFinite(p) && p >= 70 && p <= 95) return p / 100;
  } catch (e) {
    console.error("[liveness] 판정 기준값 조회 실패 — 예비값으로 판정 계속:", e);
  }
  const v = Number(process.env.LIVENESS_THRESHOLD);
  return Number.isFinite(v) && v >= 0.7 && v < 1 ? v : MODEL_B_DEFAULT;
}

// 밝기 게이트 기준(얼굴 영역 평균 밝기 0~255). 회사 설정 [설정 → 얼굴 인식 기준 크기] 카드의 "밝기 기준"에서 정한다.
// 0 = 꺼짐. 조회 실패가 판독·사진 저장을 막지 않도록 여기서는 절대 던지지 않고 0(꺼짐)으로 폴백한다.
async function getMinBrightness(companyId: string): Promise<number> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { faceMinBrightness: true } });
    const b = company?.faceMinBrightness;
    if (typeof b === "number" && Number.isFinite(b) && b >= 0 && b <= 255) return b;
  } catch (e) {
    console.error("[liveness] 밝기 기준 조회 실패 — 꺼짐으로 판정 계속:", e);
  }
  return 0;
}

// ※ PHOTO_CONSENT_SINCE(사진 보관 동의 기준일)는 lib/clock-photo.ts로 이동 — 재동의 배너와 공유(2026-07-11).
// "방금 처리된 출퇴근"으로 인정하는 시간창. 이보다 오래된 기록에는 사진을 붙이지 않는다
// (예: 어제 퇴근을 안 찍은 열린 기록, 출근 없이 누른 퇴근 → 엉뚱한 날짜에 증거가 붙는 것 방지).
const RECENT_CLOCK_MS = 2 * 60 * 1000;

// [출퇴근 후처리 — 조용한 표시] 촬영 사진 저장 + 위조 판독 기록. (확정 2026-07-11: 전건 저장·90일 파기)
// ⚠️ 출퇴근 처리(clockIn/clockOut)가 이미 끝난 뒤, 응답 전송 후(after)에 호출된다. 여기서 무슨 일이 나도
//    출퇴근 결과를 바꾸지 않는다 — 실패는 서버 로그만 남기고 삼킨다(가용성 우선).
async function recordClockPhoto(
  me: { id: string; companyId: string; faceConsentAt: Date | null },
  kind: "in" | "out",
  buffers: Buffer[],
  faceRect?: FaceRect
): Promise<void> {
  try {
    // 사진 보관이 포함된 동의(개정판)를 한 직원만 저장
    if (!me.faceConsentAt || me.faceConsentAt < PHOTO_CONSENT_SINCE) {
      console.log(`[liveness] 사진 미저장 — 직원 ${me.id}의 동의가 사진 보관 문구 반영(2026-07-11) 이전`);
      return;
    }

    // 방금 처리된 출퇴근 기록 찾기 — 출근=열려있는 기록, 퇴근=가장 최근 닫힌 기록
    const attendance =
      kind === "in"
        ? await prisma.attendance.findFirst({ where: { userId: me.id, clockOut: null }, orderBy: { clockIn: "desc" } })
        : await prisma.attendance.findFirst({ where: { userId: me.id, clockOut: { not: null } }, orderBy: { clockOut: "desc" } });
    if (!attendance) return; // 기록이 없으면(중복 클릭 등) 남길 곳이 없음
    // 방금(2분 이내) 생긴 기록이 아니면 저장하지 않는다 — clockIn/clockOut이 중복 클릭 등으로
    // 아무것도 안 했을 때, 사진이 과거 기록에 잘못 붙는 것 방지(증거 무결성 우선)
    const stampedAt = kind === "in" ? attendance.clockIn : attendance.clockOut;
    if (!stampedAt || Date.now() - stampedAt.getTime() > RECENT_CLOCK_MS) {
      console.log(`[liveness] 사진 미저장 — 방금 처리된 ${kind === "in" ? "출근" : "퇴근"} 기록을 찾지 못함(직원 ${me.id})`);
      return;
    }

    // 위조 판독(모델별 차등 · 연속 3장 전 장 통과) — 얼굴 위치가 없거나 판독 실패면 "error"(사진만 보관, 출퇴근 무관)
    // 판정은 관리자 화면의 "재검토" 배지에만 쓰인다 — 출퇴근 자체는 이미 처리됨(절대 막지 않음).
    let status = "error";
    let score: number | null = null;
    const first = buffers[0];
    // 위조 판독은 얼굴 영역을 잘라내 봐야 하므로 얼굴 위치가 필수다.
    // 본인 확인(recognize) 응답에 얼굴 위치가 없으면(형식 차이 등) detect API로 위치를 따로 확보해 판독을 진행한다.
    // ⚠️ 이게 없으면 위조 사진이 "판독 실패(error)"로 빠져 위조 표시가 안 뜬다(원인 수정 2026-07-12).
    let rect = faceRect;
    if (!rect) {
      console.log(`[liveness] recognize 응답에 얼굴 위치(FaceRect) 없음 — detect로 보완 시도(직원 ${me.id})`);
      try {
        const det = await detectFaces(first);
        if (det.success && det.faces.length === 1) {
          rect = det.faces[0];
          console.log(`[liveness] detect로 얼굴 위치 확보 — 판독 진행(직원 ${me.id})`);
        } else {
          console.log(`[liveness] detect 얼굴 ${det.success ? det.faces.length + "개" : "실패"} — 판독 보류(직원 ${me.id})`);
        }
      } catch (e) {
        console.error("[liveness] detect 보완 실패:", e);
      }
    }
    if (rect) {
      // ① 동일 사진 반복 — 실제 웹캠은 장마다 미세하게 달라진다. 바이트 동일 반복은 정지영상 주입·가상카메라 신호 → 재검토.
      let identical = false;
      for (let i = 1; i < buffers.length && !identical; i++) {
        for (let j = 0; j < i; j++) {
          if (buffers[i].equals(buffers[j])) { identical = true; break; }
        }
      }

      if (identical) {
        status = "suspect";
        console.log(`[liveness] 동일 사진 반복 감지 — 직원 ${me.id}(정지영상/가상카메라 의심), 재검토 표시`);
        const lv0 = await analyzeFace(first, rect); // 표시용 점수만
        if (lv0.ok && typeof lv0.realScore === "number") score = lv0.realScore;
      } else {
        // ② 밝기 게이트 — 너무 어두우면 판독 보류(저조도 진짜 얼굴 오탐 방지). 회사 설정값이 0이면 건너뜀.
        const minBright = await getMinBrightness(me.companyId);
        let tooDark = false;
        if (minBright > 0) {
          const b = await faceBrightness(first, rect);
          if (b.ok && b.mean < minBright) tooDark = true;
        }
        if (tooDark) {
          status = "error"; // 저조도 — 신뢰할 수 없어 재검토 배지 대신 판독 보류(사진만 보관)
          console.log(`[liveness] 저조도 판독 보류 — 직원 ${me.id}(더 밝은 곳 권장)`);
        } else {
          // ③ 장별 판독 + 모델별 차등 판정 — 모든 장이 (모델A ≥ 상수) 그리고 (모델B ≥ 회사기준) 통과해야 진짜(ok)
          const thB = await getModelBThreshold(me.companyId);
          const scores: number[] = [];
          let allPass = true;
          let analyzeFailed = false;
          for (const buf of buffers) {
            const lv = await analyzeFace(buf, rect);
            if (!lv.ok || !lv.models || typeof lv.realScore !== "number") { analyzeFailed = true; break; }
            const v1se = lv.models.find((m) => m.name === "V1SE")?.realProb ?? 0;
            const v2 = lv.models.find((m) => m.name === "V2")?.realProb ?? 0;
            scores.push(lv.realScore);
            if (!(v1se >= MODEL_A_THRESHOLD && v2 >= thB)) allPass = false;
          }
          if (analyzeFailed) {
            status = "error";
          } else {
            score = Math.min(...scores); // 표시용 — 가장 약한 장의 진짜확률(판정 여유를 보여줌)
            status = allPass ? "ok" : "suspect";
          }
        }
      }
    } else {
      // recognize·detect 모두 얼굴 위치를 얻지 못함 — 판독 보류(사진만 보관, error)
      console.error(`[liveness] 얼굴 위치를 얻지 못해 판독을 건너뜀(직원 ${me.id}) — 사진만 보관`);
    }

    const fileName = await saveClockPhoto(first);
    await prisma.clockPhoto.create({
      data: {
        attendanceId: attendance.id,
        companyId: me.companyId,
        userId: me.id,
        kind,
        livenessStatus: status,
        livenessScore: score,
        fileName,
      },
    });

    await purgeExpiredPhotos(); // 하루 1회만 실제 동작(90일 지난 사진 파기)
  } catch (e) {
    console.error("[liveness] 출퇴근 사진 기록 실패(출퇴근은 정상 처리됨):", e);
  }
}

// [얼굴로 출근] 본인 확인 성공 시에만 기존 출근 처리(위치판정·중복방지 그대로)를 실행한다.
export async function faceClockIn(formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };
  // 🔒 회사 계정은 사람이 아니다 — 얼굴이 등록되면 [생체정보] 목록에 안 떠 파기할 수 없다(검수 2차 3).
  if (me.isOwner) return { ok: false, message: "회사 계정은 이 기능을 사용할 수 없습니다." };

  const verified = await verifyMyFace(me, formData);
  if (!verified.ok) return { ok: false, message: verified.message };

  const rawMode = String(formData.get("mode") ?? "office");
  const mode = rawMode === "home" || rawMode === "field" ? rawMode : "office";
  // 좌표는 "보냈을 때만" 사용. (없는 값을 Number()로 바꾸면 0이 되어 엉뚱한 좌표(0,0)로 판정되는 것 방지)
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw === null ? NaN : Number(latRaw);
  const lng = lngRaw === null ? NaN : Number(lngRaw);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  await clockIn(mode, hasCoords ? lat : undefined, hasCoords ? lng : undefined);
  // 후처리(조용한 표시): 사진 저장 + 위조 판독 — 응답을 보낸 뒤(after) 실행해 화면을 붙잡지 않는다.
  const buffers = verified.buffers;
  if (buffers?.length) after(() => recordClockPhoto(me, "in", buffers, verified.faceRect));
  return { ok: true, message: "얼굴 확인 완료! 출근 처리되었습니다." };
}

// [얼굴로 퇴근] 본인 확인 성공 시에만 기존 퇴근 처리(외출 자동복귀 포함)를 실행한다.
export async function faceClockOut(formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };
  // 🔒 회사 계정은 사람이 아니다 — 얼굴이 등록되면 [생체정보] 목록에 안 떠 파기할 수 없다(검수 2차 3).
  if (me.isOwner) return { ok: false, message: "회사 계정은 이 기능을 사용할 수 없습니다." };

  const verified = await verifyMyFace(me, formData);
  if (!verified.ok) return { ok: false, message: verified.message };

  await clockOut();
  // 후처리(조용한 표시): 사진 저장 + 위조 판독 — 응답을 보낸 뒤(after) 실행해 화면을 붙잡지 않는다.
  const buffers = verified.buffers;
  if (buffers?.length) after(() => recordClockPhoto(me, "out", buffers, verified.faceRect));
  return { ok: true, message: "얼굴 확인 완료! 퇴근 처리되었습니다." };
}

// 내 얼굴 등록 삭제 — 얼굴서버에서 지우고 표시도 해제. (다시 등록 가능)
export async function deleteMyFace(): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };
  // 🔒 회사 계정은 사람이 아니다 — 얼굴이 등록되면 [생체정보] 목록에 안 떠 파기할 수 없다(검수 2차 3).
  if (me.isOwner) return { ok: false, message: "회사 계정은 이 기능을 사용할 수 없습니다." };
  if (me.faceEnrolledAt) {
    await unenrollFace(me.id, me.companyId).catch(() => null); // 서버 삭제 실패해도 우리 표시는 해제(재시도 가능)
  }
  await prisma.user.update({ where: { id: me.id }, data: { faceEnrolledAt: null, faceEnrollCount: 0 } });
  revalidatePath("/face-enroll");
  revalidatePath("/attendance");
  return { ok: true, message: "얼굴 등록이 삭제되었습니다." };
}
