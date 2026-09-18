import 'dotenv/config'
import { spawnSync } from 'node:child_process'

/**
 * docs/db-constraints.sql の検証を実DBに対して流す。
 *   npm run db:verify
 *
 * psql に接続文字列を渡すだけだが、シェルによって環境変数の展開方法が違う
 * (Unix は $VAR、Windows の cmd は %VAR%)ため、Node から起動して差を吸収する。
 * 空のデータベースに対して実行すること(テストデータを固定IDで投入するため)。
 */
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL が設定されていません。.env を確認してください。')
  process.exit(1)
}

const result = spawnSync('psql', [url, '-f', 'tests/db/verify-constraints.sql'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error('psql を実行できませんでした。PostgreSQL のクライアントツールが必要です。')
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
