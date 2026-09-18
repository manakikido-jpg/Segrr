import { z } from 'zod'

/**
 * 顧客の入力検証。クライアント(フォーム)とサーバー(Server Function)で同じものを使う。
 *
 * 項目はデザイン 画面04(顧客詳細)に合わせてある。要件定義書セクション5の失敗パターン7
 * (顧客管理の項目設計が甘く、後から必須項目を追加すると既存データの移行が必要になる)
 * を避けるため、請求に必要な項目は最初から入れておく。
 */

/** 全角英数字を半角に直す。登録番号を全角で入力されても受け付けるため。 */
export function toHalfWidth(value: string): string {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  )
}

/** 締日・支払日の選択肢。31は月末として扱う。 */
export const DAY_OPTIONS = [5, 10, 15, 20, 25, 31] as const
/** 支払月の選択肢。0=当月 / 1=翌月 / 2=翌々月 */
export const PAYMENT_MONTH_OPTIONS = [0, 1, 2] as const
/** 帳票の宛名に付ける敬称 */
export const HONORIFICS = ['御中', '様'] as const

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()

/**
 * 締日・支払日。選択肢に限定する。自由入力を許すと、B6の支払期限の算出で
 * 「0日締」のような不正な値が入り、後から直すには既存データの手修正が要る
 * (要件定義書セクション5・失敗パターン7)。
 */
const dayOfMonth = z
  .number()
  .int()
  .refine((v) => (DAY_OPTIONS as readonly number[]).includes(v), '締日・支払日の値が不正です')
  .nullable()

export const customerSchema = z.object({
  name: z.string().trim().min(1, '顧客名を入力してください').max(200, '顧客名が長すぎます'),
  contactName: optionalText(100),
  email: z
    .union([z.literal(''), z.email('メールアドレスの形式が正しくありません')])
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  phone: optionalText(30),
  postalCode: optionalText(10),
  address: optionalText(300),
  notes: optionalText(2000),

  // 適格請求書発行事業者の登録番号。取引先が免税事業者なら空欄のまま
  invoiceRegistrationNumber: z
    .string()
    // 全角で入力されても受け付ける
    .transform((v) => toHalfWidth(v.trim()).toUpperCase())
    .refine(
      (v) => v === '' || /^T\d{13}$/.test(v),
      '登録番号は T のあとに数字13桁で入力してください(例: T1234567890123)',
    )
    .transform((v) => (v === '' ? null : v))
    .nullable(),

  // 請求条件(例:「末日締 翌月末払」→ closingDay=31, paymentMonthOffset=1, paymentDay=31)
  closingDay: dayOfMonth,
  paymentMonthOffset: z
    .number()
    .int()
    .refine((v) => (PAYMENT_MONTH_OPTIONS as readonly number[]).includes(v), '支払月の値が不正です'),
  paymentDay: dayOfMonth,

  // この顧客への請求で源泉徴収を既定でONにするか(請求書ごとに上書きできる)
  withholdingDefault: z.boolean(),

  // 帳票の宛名に付ける敬称(デザイン: 「株式会社◯◯ 御中」)
  honorific: z.enum(HONORIFICS),
})

export type CustomerInput = z.infer<typeof customerSchema>

/** フォームの FormData から入力値を組み立てる。空文字は null に寄せる。 */
export function customerInputFromFormData(formData: FormData) {
  const text = (key: string) => String(formData.get(key) ?? '')
  const number = (key: string) => {
    const raw = text(key)
    return raw === '' ? null : Number(raw)
  }
  return customerSchema.safeParse({
    name: text('name'),
    contactName: text('contactName'),
    email: text('email'),
    phone: text('phone'),
    postalCode: text('postalCode'),
    address: text('address'),
    notes: text('notes'),
    invoiceRegistrationNumber: text('invoiceRegistrationNumber'),
    closingDay: number('closingDay'),
    paymentMonthOffset: Number(text('paymentMonthOffset') || '1'),
    paymentDay: number('paymentDay'),
    withholdingDefault: formData.get('withholdingDefault') === 'on',
    honorific: text('honorific') || '御中',
  })
}

/**
 * フォームの生の入力値(すべて文字列)。
 *
 * 検証に失敗したときに画面へ返して `defaultValue` に戻すために使う。
 * React は action の完了後に非制御フォームをリセットするため、値を返さないと
 * エラーのたびに入力内容が消えてしまう。
 */
export type CustomerFormValues = {
  name: string
  contactName: string
  email: string
  phone: string
  postalCode: string
  address: string
  notes: string
  invoiceRegistrationNumber: string
  closingDay: string
  paymentMonthOffset: string
  paymentDay: string
  withholdingDefault: boolean
  honorific: string
}

export const emptyCustomerFormValues: CustomerFormValues = {
  name: '', contactName: '', email: '', phone: '', postalCode: '', address: '', notes: '',
  invoiceRegistrationNumber: '', closingDay: '', paymentMonthOffset: '1', paymentDay: '',
  withholdingDefault: false, honorific: '御中',
}

/** 検証に失敗したときに画面へ返すため、生の入力値をそのまま取り出す。 */
export function formValuesFromFormData(formData: FormData): CustomerFormValues {
  const text = (key: string) => String(formData.get(key) ?? '')
  return {
    name: text('name'),
    contactName: text('contactName'),
    email: text('email'),
    phone: text('phone'),
    postalCode: text('postalCode'),
    address: text('address'),
    notes: text('notes'),
    invoiceRegistrationNumber: text('invoiceRegistrationNumber'),
    closingDay: text('closingDay'),
    paymentMonthOffset: text('paymentMonthOffset') || '1',
    paymentDay: text('paymentDay'),
    withholdingDefault: formData.get('withholdingDefault') === 'on',
    honorific: text('honorific') || '御中',
  }
}
