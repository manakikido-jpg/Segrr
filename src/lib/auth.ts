import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'
import { resolveSignIn } from '@/server/auth/invitation'

/**
 * 認証の設定。**Googleログイン + 招待制**。
 *
 * パスワード認証は作らない。ハッシュ化・総当たり対策・2段階認証・再発行フローを
 * 自前で実装するのが最も穴の出やすい領域のため(要件定義書セクション5・失敗パターン15)。
 *
 * Google 側で認証が通っても、このアプリに入れるかは別の判断。
 * 判定は src/server/auth/invitation.ts に置いてある(実DBに対してテストするため)。
 *
 * **Membership はここでは作らない。** Auth.js は signIn コールバックを
 * adapter.createUser より前に呼ぶため、この時点では User レコードが存在しない。
 * Membership の用意は src/server/auth/session.ts の遅延承諾で行う。
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [Google],

  // アダプタを渡すと既定でこの方式になるが、明示しておく。
  // 将来アダプタを外した拍子に JWT に化けると、Membership を剥奪しても
  // トークンが期限まで有効なままになる
  session: { strategy: 'database' },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    /**
     * ログインしてよいかを判定する。
     *
     * false を返すと Auth.js は一律 `AccessDenied` にしてしまい、理由を画面に出せない。
     * 文字列を返すとそのURLへリダイレクトされるので、理由をクエリに載せる
     * (デザイン 画面01 の「招待外アカウント拒否」状態)。
     */
    async signIn({ user, profile, account }) {
      if (account?.provider !== 'google') return '/login?error=unsupported-provider'

      const decision = await resolveSignIn({
        // 2回目以降は user が DB のユーザーになるため、Google 側でメールを
        // 変更していると古い値になる。判定には profile を優先する
        email: profile?.email ?? user.email,
        emailVerified: profile?.email_verified as boolean | undefined,
      })

      return decision.allowed ? true : `/login?error=${decision.reason}`
    },

    /** セッションには userId だけを載せる。組織とロールはリクエストごとにDBから引く。 */
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
})
