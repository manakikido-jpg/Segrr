-- Segrr: Prisma標準マイグレーション適用後に追加で流すSQL
-- 対象: 金額・消費税・テナント整合性をDBレベルで担保する
-- 適用方法: `prisma migrate dev --create-only` で空のマイグレーションを作り、
--           その migration.sql に本ファイルの内容を貼って `prisma migrate dev` で適用する。
--           (`db execute` での個別適用はマイグレーション履歴に残らないため使わない)
--
-- 設計方針:
--   生成列(GENERATED ALWAYS AS)は使わない。Prismaの差分検出から見えず、
--   NOT NULL の有無でドリフトが出続けるうえ、Prisma Client の型上は書き込み可能な
--   フィールドとして生成されてしまうため。代わりに BEFORE トリガーで値を上書きする。
--   Prismaから見れば通常のカラムなのでドリフトは発生しない。
--
-- アプリ側の規約:
--   本ファイルがDBで算出するカラムは、サービス層の create/update で決して渡さないこと。
--   一覧は prisma/schema.prisma 冒頭のコメントを参照。

-- ─────────────────────────────
-- 0. 入力値の下限・上限
-- ─────────────────────────────
-- Int(INTEGER)の上限は約21.4億。quantity * unitPrice がこれを超えると
-- 乗算時点でオーバーフロー例外になるため、単価側で手前に線を引いておく。
-- 単価のマイナスを許すのは値引き行のため(デザイン仕様: 値引きは単価をマイナスで入力し、
-- 同じ税率の課税対象から差し引く)。ただし税率別の小計がマイナスになると消費税額も
-- マイナスになって意味をなさないため、小計側をセクション3で検査する。

ALTER TABLE "QuoteItem"
  ADD CONSTRAINT "QuoteItem_quantity_positive"  CHECK ("quantity" > 0),
  ADD CONSTRAINT "QuoteItem_unitPrice_range"    CHECK ("unitPrice" BETWEEN -1000000000 AND 1000000000),
  ADD CONSTRAINT "QuoteItem_taxRate_allowed"    CHECK ("taxRate" IN (8, 10));

ALTER TABLE "ContractItem"
  ADD CONSTRAINT "ContractItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "ContractItem_unitPrice_range"    CHECK ("unitPrice" BETWEEN -1000000000 AND 1000000000),
  ADD CONSTRAINT "ContractItem_taxRate_allowed"   CHECK ("taxRate" IN (8, 10));

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "InvoiceItem_unitPrice_range"    CHECK ("unitPrice" BETWEEN -1000000000 AND 1000000000),
  ADD CONSTRAINT "InvoiceItem_taxRate_allowed"   CHECK ("taxRate" IN (8, 10));

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_invoiceRegNo_format"
    CHECK ("invoiceRegistrationNumber" IS NULL
           OR "invoiceRegistrationNumber" ~ '^T[0-9]{13}$');

-- ─────────────────────────────
-- 1. 明細行の amount を quantity * unitPrice で上書きする
-- ─────────────────────────────

CREATE OR REPLACE FUNCTION segrr_set_item_amount() RETURNS TRIGGER AS $$
BEGIN
  NEW."amount" := NEW."quantity" * NEW."unitPrice";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quote_item_amount ON "QuoteItem";
CREATE TRIGGER trg_quote_item_amount
  BEFORE INSERT OR UPDATE ON "QuoteItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_set_item_amount();

DROP TRIGGER IF EXISTS trg_contract_item_amount ON "ContractItem";
CREATE TRIGGER trg_contract_item_amount
  BEFORE INSERT OR UPDATE ON "ContractItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_set_item_amount();

DROP TRIGGER IF EXISTS trg_invoice_item_amount ON "InvoiceItem";
CREATE TRIGGER trg_invoice_item_amount
  BEFORE INSERT OR UPDATE ON "InvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_set_item_amount();

-- ─────────────────────────────
-- 2. 端数処理ヘルパ
-- ─────────────────────────────
-- 適格請求書では端数処理は「1書類につき、税率ごとに1回」。
-- 明細行ごとに丸めると税額がずれるため、必ず税率別の小計に対して1回だけ適用する。

CREATE OR REPLACE FUNCTION segrr_round(v NUMERIC, mode "TaxRounding")
RETURNS INTEGER AS $$
BEGIN
  RETURN (CASE mode
            WHEN 'FLOOR' THEN floor(v)
            WHEN 'CEIL'  THEN ceil(v)
            ELSE round(v)
          END)::INTEGER;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 源泉徴収税額(消費税を区分記載しているため税抜額を対象にする)
--   税抜額 <= 1,000,000 : 税抜額 * 10.21%
--   税抜額 >  1,000,000 : (税抜額 - 1,000,000) * 20.42% + 102,100
-- いずれも円未満切り捨て。
CREATE OR REPLACE FUNCTION segrr_withholding_tax(base INTEGER)
RETURNS INTEGER AS $$
BEGIN
  IF base IS NULL OR base <= 0 THEN
    RETURN 0;
  ELSIF base <= 1000000 THEN
    RETURN floor(base * 0.1021)::INTEGER;
  ELSE
    RETURN (floor((base - 1000000) * 0.2042) + 102100)::INTEGER;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─────────────────────────────
-- 3. 明細の変更で親書類の合計を再計算する
-- ─────────────────────────────
-- 親の合計をアプリ管理値のままにすると、金額0で書類を作ってから明細を足すことで
-- 契約超過チェックを素通りできてしまう。合計は必ずDB側で明細から導出する。
-- (親が既に削除されている場合=カスケード削除時は、ルックアップがNULLになるので何もしない)

CREATE OR REPLACE FUNCTION segrr_recalc_quote_totals() RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT := CASE TG_OP WHEN 'DELETE' THEN OLD."quoteId" ELSE NEW."quoteId" END;
  mode "TaxRounding";
  s10 INTEGER; s8 INTEGER; t10 INTEGER; t8 INTEGER;
BEGIN
  SELECT o."taxRounding" INTO mode
    FROM "Quote" q JOIN "Organization" o ON o.id = q."organizationId"
   WHERE q.id = target_id;
  IF mode IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM("amount") FILTER (WHERE "taxRate" = 10), 0),
         COALESCE(SUM("amount") FILTER (WHERE "taxRate" = 8), 0)
    INTO s10, s8
    FROM "QuoteItem" WHERE "quoteId" = target_id;

  -- 値引き行で税率別の小計がマイナスに振り切れていないか検査する
  IF s10 < 0 OR s8 < 0 THEN
    RAISE EXCEPTION
      '値引きが大きすぎます。税率別の小計はマイナスにできません(10%%対象: %円 / 8%%対象: %円)。見積ID: %',
      s10, s8, target_id;
  END IF;

  t10 := segrr_round(s10 * 0.10, mode);
  t8  := segrr_round(s8  * 0.08, mode);

  UPDATE "Quote" SET
      "updatedAt"   = now(),
      "subtotal10"  = s10, "tax10" = t10,
      "subtotal8"   = s8,  "tax8"  = t8,
      "subtotal"    = s10 + s8,
      "taxAmount"   = t10 + t8,
      "totalAmount" = s10 + s8 + t10 + t8
   WHERE id = target_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quote_recalc ON "QuoteItem";
CREATE TRIGGER trg_quote_recalc
  AFTER INSERT OR UPDATE OR DELETE ON "QuoteItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_recalc_quote_totals();

CREATE OR REPLACE FUNCTION segrr_recalc_contract_totals() RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT := CASE TG_OP WHEN 'DELETE' THEN OLD."contractId" ELSE NEW."contractId" END;
  mode "TaxRounding";
  s10 INTEGER; s8 INTEGER; t10 INTEGER; t8 INTEGER;
BEGIN
  SELECT o."taxRounding" INTO mode
    FROM "Contract" c JOIN "Organization" o ON o.id = c."organizationId"
   WHERE c.id = target_id;
  IF mode IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM("amount") FILTER (WHERE "taxRate" = 10), 0),
         COALESCE(SUM("amount") FILTER (WHERE "taxRate" = 8), 0)
    INTO s10, s8
    FROM "ContractItem" WHERE "contractId" = target_id;

  -- 値引き行で税率別の小計がマイナスに振り切れていないか検査する
  IF s10 < 0 OR s8 < 0 THEN
    RAISE EXCEPTION
      '値引きが大きすぎます。税率別の小計はマイナスにできません(10%%対象: %円 / 8%%対象: %円)。契約ID: %',
      s10, s8, target_id;
  END IF;

  t10 := segrr_round(s10 * 0.10, mode);
  t8  := segrr_round(s8  * 0.08, mode);

  UPDATE "Contract" SET
      "updatedAt"   = now(),
      "subtotal10"  = s10, "tax10" = t10,
      "subtotal8"   = s8,  "tax8"  = t8,
      "subtotal"    = s10 + s8,
      "taxAmount"   = t10 + t8,
      "totalAmount" = s10 + s8 + t10 + t8
   WHERE id = target_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contract_recalc ON "ContractItem";
CREATE TRIGGER trg_contract_recalc
  AFTER INSERT OR UPDATE OR DELETE ON "ContractItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_recalc_contract_totals();

CREATE OR REPLACE FUNCTION segrr_recalc_invoice_totals() RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT := CASE TG_OP WHEN 'DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END;
  mode "TaxRounding";
  s10 INTEGER; s8 INTEGER; t10 INTEGER; t8 INTEGER;
BEGIN
  SELECT o."taxRounding" INTO mode
    FROM "Invoice" i JOIN "Organization" o ON o.id = i."organizationId"
   WHERE i.id = target_id;
  IF mode IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM("amount") FILTER (WHERE "taxRate" = 10), 0),
         COALESCE(SUM("amount") FILTER (WHERE "taxRate" = 8), 0)
    INTO s10, s8
    FROM "InvoiceItem" WHERE "invoiceId" = target_id;

  IF s10 < 0 OR s8 < 0 THEN
    RAISE EXCEPTION
      '値引きが大きすぎます。税率別の小計はマイナスにできません(10%%対象: %円 / 8%%対象: %円)。請求ID: %',
      s10, s8, target_id;
  END IF;

  t10 := segrr_round(s10 * 0.10, mode);
  t8  := segrr_round(s8  * 0.08, mode);

  -- この UPDATE が Invoice 側の BEFORE UPDATE トリガー(源泉徴収の再計算と
  -- 契約超過チェック)を発火させる。防御線はここで閉じる。
  UPDATE "Invoice" SET
      "updatedAt"   = now(),
      "subtotal10"  = s10, "tax10" = t10,
      "subtotal8"   = s8,  "tax8"  = t8,
      "subtotal"    = s10 + s8,
      "taxAmount"   = t10 + t8,
      "totalAmount" = s10 + s8 + t10 + t8
   WHERE id = target_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_recalc ON "InvoiceItem";
CREATE TRIGGER trg_invoice_recalc
  AFTER INSERT OR UPDATE OR DELETE ON "InvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_recalc_invoice_totals();

-- ─────────────────────────────
-- 4. 請求書: 源泉徴収の算出 + テナント整合性 + 「請求済み合計 ≦ 契約金額」
-- ─────────────────────────────
-- 比較は税抜(subtotal)で行う。税込で比較すると、分割請求のたびに税率別の端数処理が
-- 走るため、請求書の税込合計と契約の税込合計が数円ずれて誤判定する。

CREATE OR REPLACE FUNCTION segrr_check_invoice() RETURNS TRIGGER AS $$
DECLARE
  contract_subtotal INTEGER;
  contract_org      TEXT;
  contract_project  TEXT;
  invoiced_subtotal INTEGER;
BEGIN
  -- 源泉徴収の算出(対象外なら0)
  IF NEW."withholdingApplied" THEN
    NEW."withholdingTax" := segrr_withholding_tax(NEW."subtotal");
  ELSE
    NEW."withholdingTax" := 0;
  END IF;
  NEW."paymentAmount" := NEW."totalAmount" - NEW."withholdingTax";

  -- 契約行をロックして直列化する。
  -- FOR UPDATE ではなく FOR NO KEY UPDATE を使うのは、Invoice→Contract の外部キー検査が
  -- 取る KEY SHARE ロックと競合させないため(デッドロック回避)。
  SELECT c."subtotal", c."organizationId", c."projectId"
    INTO contract_subtotal, contract_org, contract_project
    FROM "Contract" c
   WHERE c.id = NEW."contractId"
     FOR NO KEY UPDATE;

  IF contract_subtotal IS NULL THEN
    RAISE EXCEPTION '契約が見つかりません。契約ID: %', NEW."contractId";
  END IF;

  -- テナント整合性: 請求書と契約・案件が同じ組織を指していること
  IF contract_org <> NEW."organizationId" THEN
    RAISE EXCEPTION 'テナント不整合: 請求書(%)と契約(%)の組織が一致しません',
      NEW."organizationId", contract_org;
  END IF;
  IF contract_project <> NEW."projectId" THEN
    RAISE EXCEPTION '案件不整合: 請求書の案件(%)が契約の案件(%)と一致しません',
      NEW."projectId", contract_project;
  END IF;

  IF NEW."status" = 'CANCELLED' THEN
    RETURN NEW; -- キャンセル済みは合計に含めないのでチェック不要
  END IF;

  SELECT COALESCE(SUM("subtotal"), 0) INTO invoiced_subtotal
    FROM "Invoice"
   WHERE "contractId" = NEW."contractId"
     AND "status" <> 'CANCELLED'
     AND id <> NEW.id;

  IF (invoiced_subtotal + NEW."subtotal") > contract_subtotal THEN
    RAISE EXCEPTION
      '請求合計(税抜 %円)が契約金額(税抜 %円)を超えています。契約ID: %',
      (invoiced_subtotal + NEW."subtotal"), contract_subtotal, NEW."contractId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_invoice ON "Invoice";
CREATE TRIGGER trg_check_invoice
  BEFORE INSERT OR UPDATE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION segrr_check_invoice();

-- ─────────────────────────────
-- 5. 契約金額の減額を検査する
-- ─────────────────────────────
-- Invoice 側だけを守っても、請求書発行後に契約金額を下げれば超過状態を作れてしまう。

CREATE OR REPLACE FUNCTION segrr_check_contract_decrease() RETURNS TRIGGER AS $$
DECLARE
  invoiced_subtotal INTEGER;
BEGIN
  IF NEW."subtotal" >= OLD."subtotal" THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("subtotal"), 0) INTO invoiced_subtotal
    FROM "Invoice"
   WHERE "contractId" = NEW.id AND "status" <> 'CANCELLED';

  IF invoiced_subtotal > NEW."subtotal" THEN
    RAISE EXCEPTION
      '契約金額(税抜 %円)を発行済みの請求合計(税抜 %円)より小さくできません。契約ID: %',
      NEW."subtotal", invoiced_subtotal, NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_contract_decrease ON "Contract";
CREATE TRIGGER trg_check_contract_decrease
  BEFORE UPDATE ON "Contract"
  FOR EACH ROW EXECUTE FUNCTION segrr_check_contract_decrease();

-- ─────────────────────────────
-- 6. 変換後の元書類を固定する(データ継承の前提)
-- ─────────────────────────────
-- 見積の明細をコピーして契約を作る方式のため、元の見積を後から編集できると
-- 「PDFに出した見積」と「DB上の見積」が食い違う。契約に変換された時点で凍結する。

CREATE OR REPLACE FUNCTION segrr_guard_quote_items() RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT := CASE TG_OP WHEN 'DELETE' THEN OLD."quoteId" ELSE NEW."quoteId" END;
  quote_status "QuoteStatus";
  contract_count INTEGER;
BEGIN
  SELECT status INTO quote_status FROM "Quote" WHERE id = target_id;
  IF quote_status IS NULL THEN -- 見積ごと削除中(カスケード)
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT COUNT(*) INTO contract_count FROM "Contract" WHERE "sourceQuoteId" = target_id;

  IF contract_count > 0 OR quote_status = 'ACCEPTED' THEN
    RAISE EXCEPTION
      '契約に変換済みの見積は編集できません。修正する場合は新しい見積を作成してください。見積ID: %',
      target_id;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_quote_items ON "QuoteItem";
CREATE TRIGGER trg_guard_quote_items
  BEFORE INSERT OR UPDATE OR DELETE ON "QuoteItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_guard_quote_items();

CREATE OR REPLACE FUNCTION segrr_guard_contract_items() RETURNS TRIGGER AS $$
DECLARE
  target_id TEXT := CASE TG_OP WHEN 'DELETE' THEN OLD."contractId" ELSE NEW."contractId" END;
  contract_status "ContractStatus";
  invoice_count INTEGER;
BEGIN
  SELECT status INTO contract_status FROM "Contract" WHERE id = target_id;
  IF contract_status IS NULL THEN -- 契約ごと削除中(カスケード)
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT COUNT(*) INTO invoice_count
    FROM "Invoice" WHERE "contractId" = target_id AND status <> 'CANCELLED';

  IF invoice_count > 0 OR contract_status = 'SIGNED' THEN
    RAISE EXCEPTION
      '締結済み、または請求書が発行されている契約は編集できません。契約ID: %', target_id;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_contract_items ON "ContractItem";
CREATE TRIGGER trg_guard_contract_items
  BEFORE INSERT OR UPDATE OR DELETE ON "ContractItem"
  FOR EACH ROW EXECUTE FUNCTION segrr_guard_contract_items();

-- ─────────────────────────────
-- 7. 書類の物理削除を DRAFT に限定する
-- ─────────────────────────────
-- 送付済み・発行済みの書類は監査の観点から削除せず CANCELLED で残す。

CREATE OR REPLACE FUNCTION segrr_guard_document_delete() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status"::TEXT <> 'DRAFT' THEN
    RAISE EXCEPTION
      '下書き以外の書類は削除できません。キャンセル(CANCELLED)に変更してください。ID: %', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 見積は「下書きであること」に加えて「契約に変換されていないこと」も条件にする。
-- Contract.sourceQuoteId には onDelete: Restrict を指定してあるが、参照アクションの
-- 指定漏れ(Prismaのオプショナルリレーションは既定が SetNull)で継承元が黙って
-- 失われる事故を防ぐため、DB側にも独立した防御を置く。
CREATE OR REPLACE FUNCTION segrr_guard_quote_delete() RETURNS TRIGGER AS $$
DECLARE
  contract_count INTEGER;
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION
      '下書き以外の見積は削除できません。ID: %', OLD.id;
  END IF;

  SELECT COUNT(*) INTO contract_count FROM "Contract" WHERE "sourceQuoteId" = OLD.id;
  IF contract_count > 0 THEN
    RAISE EXCEPTION
      '契約に変換済みの見積は削除できません(契約 %件が参照しています)。見積ID: %',
      contract_count, OLD.id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_quote_delete ON "Quote";
CREATE TRIGGER trg_guard_quote_delete
  BEFORE DELETE ON "Quote" FOR EACH ROW EXECUTE FUNCTION segrr_guard_quote_delete();

DROP TRIGGER IF EXISTS trg_guard_contract_delete ON "Contract";
CREATE TRIGGER trg_guard_contract_delete
  BEFORE DELETE ON "Contract" FOR EACH ROW EXECUTE FUNCTION segrr_guard_document_delete();

DROP TRIGGER IF EXISTS trg_guard_invoice_delete ON "Invoice";
CREATE TRIGGER trg_guard_invoice_delete
  BEFORE DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION segrr_guard_document_delete();

-- ─────────────────────────────
-- 注意点
-- ─────────────────────────────
-- ・アプリ層(server/services/invoice-service.ts)でも同じチェックを行うこと。
--   理由: DBトリガーはUIに分かりやすいエラーメッセージを返せないため、
--   ユーザー向けのバリデーションはアプリ層、最終防衛線としてDBトリガー、の二重構成にする。
-- ・トリガーが算出するカラムはサービス層の create/update で渡さないこと。
--   渡しても上書きされるが、TS側の計算結果と食い違ったまま気づかない事故のもとになる。
-- ・TS側にも同じ税額・源泉徴収の計算式を置き、UIのプレビューに使う。
--   両者が一致することを tests/unit で固定すること(端数処理のずれは目視では見つからない)。
-- ・明細行の親ID(quoteId / contractId / invoiceId)の付け替えはサービス層で禁止する。
--   付け替えを許すと、移動元の親の合計が再計算されずに取り残される。
-- ・トリガーのテストは tests/unit ではなく実DBに対して行うこと(A2の完了条件)。
-- ・Prismaの参照アクション(onDelete)の既定値に依存しないこと。必須リレーションは Restrict、
--   オプショナルなリレーションは SetNull が既定になるため、後者は schema.prisma 側で
--   明示する必要がある(Contract.sourceQuote が該当)。
