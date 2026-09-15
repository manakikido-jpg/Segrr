import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// Prisma 7 はドライバアダプタ経由で接続する。
// 開発時のホットリロードでクライアントが増殖しないよう globalThis に保持する。
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL が設定されていません。.env.example を参照してください。')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
