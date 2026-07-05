// DB 연결 (Prisma). 개발 중 서버가 자주 재시작돼도 연결이 중복 생성되지 않도록 하나만 유지한다.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
