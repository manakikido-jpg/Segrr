import 'dotenv/config'
import { defineConfig } from 'prisma/config'

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
    // env() ヘルパーは未設定だと即座に例外を投げるため使わない。
    // postinstall の `prisma generate` は接続先を必要としないのに、
    // .env を作る前の `npm install` が失敗してしまう。
    // 接続が必要なコマンド(migrate / db seed)は、空文字のまま実行すれば
    // Prisma 側が接続エラーとして分かりやすく知らせてくれる。
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
})
