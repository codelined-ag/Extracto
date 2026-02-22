import { PrismaClient } from '@prisma/client'

const datasourceUrl = process.env.DATABASE_URL ?? "file:./db/custom.db";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
