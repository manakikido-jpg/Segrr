import { rmSync } from 'node:fs'

/**
 * next dev が残した古いルート型を消す。
 *
 * `.next/dev/types` と `.next/types` の両方が tsconfig の include に入っているため、
 * dev 側が古いままだと、後から追加したページが「存在しないルート」として
 * 型エラーになる(typedRoutes 有効時)。typecheck の前に必ず消す。
 */
rmSync('.next/dev/types', { recursive: true, force: true })
