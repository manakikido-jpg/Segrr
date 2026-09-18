import { NextResponse, type NextRequest } from 'next/server'

/**
 * 未ログインをログイン画面へ送る。**楽観的チェックのみ。**
 *
 * Next.js のガイドどおり、ここではセッションCookieの有無しか見ない。
 * proxy はプリフェッチを含む全リクエストで走るため、DBを引くと性能問題になる。
 * 本当の認可は src/server/auth/session.ts(requireOrganization など)で、
 * データに最も近いところで行う。Cookie を偽造されてもそこで止まる。
 */

// Auth.js v5 のセッションCookie。HTTPS では __Secure- が付く
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token']

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name))
  if (hasSession) return NextResponse.next()

  const loginUrl = new URL('/login', request.url)
  // ログイン後に元のページへ戻す
  const from = request.nextUrl.pathname + request.nextUrl.search
  if (from !== '/') loginUrl.searchParams.set('from', from)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    /*
     * 以下を除くすべてに適用する:
     *   /login          ログイン画面(ここで弾くとリダイレクトループになる)
     *   /api/auth/...   認証のコールバック
     *   /_next/...      ビルド成果物
     *   favicon など静的ファイル
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)',
  ],
}
