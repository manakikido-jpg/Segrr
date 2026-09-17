import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: true,
  // PDF生成は headless Chromium を使うため、サーバー側でそのまま require させる
  // (バンドルに取り込むと実行ファイルの解決に失敗する)
  serverExternalPackages: ['playwright-core'],
  // フォントは実行時に fs で読むので、出力トレースに含める
  outputFileTracingIncludes: {
    '/api/**': ['./src/assets/fonts/**'],
  },
}

export default nextConfig
