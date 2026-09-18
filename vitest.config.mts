import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 20_000,
    // DB突き合わせテスト(tests/unit/tax-db.test.ts)が DATABASE_URL を読めるようにする
    setupFiles: ['dotenv/config'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // server-only は読み込まれると例外を投げる。サービス層の保護は本番に残しつつ、
      // テストからは空モジュールに差し替える
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
})
