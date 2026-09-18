import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 以降、マイグレーション用の接続URLはスキーマではなくここに置く。
// アプリ実行時の接続は src/lib/db.ts のドライバアダプタが担当する。
//
// マイグレーションは DIRECT_DATABASE_URL があればそちらを使う。
// Neon や Supabase の接続プール(PgBouncer)経由だと、Prisma が使う
// セッションレベルのアドバイザリロックが効かず、マイグレーションが
// 失敗したり中途半端に適用されたりするため。
//   DATABASE_URL        アプリの実行時(プール経由でよい)
//   DIRECT_DATABASE_URL マイグレーション用(プールを通さない接続)
// 未設定なら DATABASE_URL をそのまま使う(ローカルのPostgreSQLなど)。
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ? env('DIRECT_DATABASE_URL') : env('DATABASE_URL'),
  },
})
