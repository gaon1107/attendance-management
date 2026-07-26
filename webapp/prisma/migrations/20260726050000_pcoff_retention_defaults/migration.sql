-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "officeLat" REAL,
    "officeLng" REAL,
    "officeRadiusM" INTEGER NOT NULL DEFAULT 200,
    "officeAddress" TEXT,
    "officeAddressDetail" TEXT,
    "officeIps" TEXT,
    "workStartTime" TEXT,
    "workEndTime" TEXT,
    "lateGraceMin" INTEGER NOT NULL DEFAULT 0,
    "standardWorkHours" REAL NOT NULL DEFAULT 8,
    "overtimeAlertOn" BOOLEAN NOT NULL DEFAULT true,
    "overtimeWarnHours" REAL NOT NULL DEFAULT 48,
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "outingReasons" TEXT,
    "breakCheckOn" BOOLEAN NOT NULL DEFAULT true,
    "breakMin4h" INTEGER NOT NULL DEFAULT 30,
    "breakMin8h" INTEGER NOT NULL DEFAULT 60,
    "holidayAutoOn" BOOLEAN NOT NULL DEFAULT true,
    "faceMinPercent" INTEGER NOT NULL DEFAULT 30,
    "faceMinBrightness" INTEGER NOT NULL DEFAULT 0,
    "livenessPercent" INTEGER NOT NULL DEFAULT 50,
    "securityCheckedAt" DATETIME,
    "alertNightOn" BOOLEAN NOT NULL DEFAULT true,
    "alertNightStart" INTEGER NOT NULL DEFAULT 22,
    "alertNightEnd" INTEGER NOT NULL DEFAULT 6,
    "alertFailOn" BOOLEAN NOT NULL DEFAULT true,
    "alertFailCount" INTEGER NOT NULL DEFAULT 5,
    "bizRegNo" TEXT,
    "corpRegNo" TEXT,
    "ceoName" TEXT,
    "bizType" TEXT,
    "bizItem" TEXT,
    "zipCode" TEXT,
    "address" TEXT,
    "addressDetail" TEXT,
    "companyPhone" TEXT,
    "companyFax" TEXT,
    "companyEmail" TEXT,
    "website" TEXT,
    "managerName" TEXT,
    "managerTitle" TEXT,
    "managerPhone" TEXT,
    "managerEmail" TEXT,
    "companyNote" TEXT,
    "logoName" TEXT,
    "shiftMode" INTEGER,
    "scheduleType" TEXT,
    "approvalMode" TEXT NOT NULL DEFAULT 'single',
    "approvalStepCount" INTEGER NOT NULL DEFAULT 1,
    "pcOffOn" BOOLEAN NOT NULL DEFAULT false,
    "pcOffMode" TEXT NOT NULL DEFAULT 'lock',
    "pcOffDelayMin" INTEGER NOT NULL DEFAULT 10,
    "pcOffNotifyMins" TEXT NOT NULL DEFAULT '10,5',
    "pcOffTempUseMin" INTEGER NOT NULL DEFAULT 30,
    "pcOffTempUsePerDay" INTEGER NOT NULL DEFAULT 2,
    "pcOffTempReasons" TEXT NOT NULL DEFAULT '긴급 장애 대응, 고객 요청 마감, 결재자 부재, 기타'
);
INSERT INTO "new_Company" ("address", "addressDetail", "alertFailCount", "alertFailOn", "alertNightEnd", "alertNightOn", "alertNightStart", "approvalMode", "approvalStepCount", "bizItem", "bizRegNo", "bizType", "breakCheckOn", "breakMin4h", "breakMin8h", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinBrightness", "faceMinPercent", "holidayAutoOn", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "outingReasons", "overtimeAlertOn", "overtimeWarnHours", "pcOffDelayMin", "pcOffMode", "pcOffNotifyMins", "pcOffOn", "pcOffTempUseMin", "pcOffTempUsePerDay", "scheduleType", "securityCheckedAt", "shiftMode", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode") SELECT "address", "addressDetail", "alertFailCount", "alertFailOn", "alertNightEnd", "alertNightOn", "alertNightStart", "approvalMode", "approvalStepCount", "bizItem", "bizRegNo", "bizType", "breakCheckOn", "breakMin4h", "breakMin8h", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinBrightness", "faceMinPercent", "holidayAutoOn", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "outingReasons", "overtimeAlertOn", "overtimeWarnHours", "pcOffDelayMin", "pcOffMode", "pcOffNotifyMins", "pcOffOn", "pcOffTempUseMin", "pcOffTempUsePerDay", "scheduleType", "securityCheckedAt", "shiftMode", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- 기존 회사도 노무사 권고 기본값으로 맞춘다.
--  · 대상: PC-OFF를 아직 켜지 않은 회사(pcOffOn=0)만. 이미 켜서 운영 중인 회사의 설정은 건드리지 않는다.
--  · 근거: 유예 30분→10분(무급 노동 구조화 방지), 일시사용 1회→2회(우회근무 유발 방지). 노무사 자료 최종부록 D-1.
--  · 위 RedefineTables는 기존 값을 그대로 복사하므로, 이 UPDATE가 없으면 권고값이 신규 회사에만 적용된다.
UPDATE "Company" SET "pcOffDelayMin" = 10 WHERE "pcOffOn" = 0 AND "pcOffDelayMin" = 30;
UPDATE "Company" SET "pcOffTempUsePerDay" = 2 WHERE "pcOffOn" = 0 AND "pcOffTempUsePerDay" = 1;
