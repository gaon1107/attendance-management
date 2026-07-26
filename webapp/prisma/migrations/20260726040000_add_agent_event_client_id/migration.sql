-- AlterTable
ALTER TABLE "AgentEvent" ADD COLUMN "clientEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_deviceId_clientEventId_key" ON "AgentEvent"("deviceId", "clientEventId");

