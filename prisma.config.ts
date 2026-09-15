import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 以降、マイグレーション用の接続URLはスキーマではなくここに置く。
// アプリ実行時の接続は src/lib/db.ts のドライバアダプタが担当する。
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
