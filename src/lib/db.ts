import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let prismaInstance: PrismaClient | undefined;

function getOrCreatePrisma(): PrismaClient {
  if (prismaInstance) return prismaInstance;
  prismaInstance = globalForPrisma.prisma ?? new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL ?? "file:./db/custom.db",
      },
    },
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaInstance;
  return prismaInstance;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getOrCreatePrisma(), prop, receiver);
  },
});
