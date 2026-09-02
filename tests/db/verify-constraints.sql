-- Segrr: docs/db-constraints.sql のDBレベル検証
--
-- タスクA2の完了条件はこのスクリプトが全項目 PASS することで判定する。
-- ユニットテストのモックでは検証できないため、必ず実DBに対して実行すること。
--
-- 実行方法:
--   createdb segrr_test
--   npx prisma migrate deploy   # schema.prisma + db-constraints.sql のマイグレーション
--   psql -d segrr_test -f tests/db/verify-constraints.sql
--
-- 期待結果: ✓ PASS が32件、✗ FAIL が0件。
-- 空のDBに対して実行すること(テストデータを固定IDで投入するため)。

SET client_min_messages TO NOTICE;

CREATE OR REPLACE FUNCTION t_fail(label TEXT, stmt TEXT) RETURNS VOID AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE WARNING '✗ FAIL  % — 弾かれるべき操作が通ってしまいました', label;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✓ PASS  % — 拒否: %', label, left(SQLERRM, 70);
  END;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION t_ok(label TEXT, stmt TEXT) RETURNS VOID AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE NOTICE '✓ PASS  % — 正常に実行', label;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '✗ FAIL  % — 通るべき操作が拒否されました: %', label, SQLERRM;
  END;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION t_eq(label TEXT, actual BIGINT, expected BIGINT) RETURNS VOID AS $$
BEGIN
  IF actual IS NOT DISTINCT FROM expected THEN
    RAISE NOTICE '✓ PASS  % = %', label, actual;
  ELSE
    RAISE WARNING '✗ FAIL  % : 期待 % / 実際 %', label, expected, actual;
  END IF;
END $$ LANGUAGE plpgsql;

-- ── 土台 ──────────────────────────────
INSERT INTO "Organization"(id,name) VALUES ('org1','本人事業'),('org2','別の組織');
INSERT INTO "Customer"(id,"organizationId",name) VALUES ('cus1','org1','株式会社テスト');
INSERT INTO "Project"(id,"organizationId","customerId",name) VALUES ('prj1','org1','cus1','サイト制作');

-- ── ① 明細の amount 自動算出 + ② 税率ごとに1回だけ端数処理 ──
INSERT INTO "Quote"(id,"organizationId","projectId",number) VALUES ('qt1','org1','prj1','Q-2026-0001');
INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice","taxRate") VALUES
  ('qi1','qt1','デザイン費',2,500,10),      -- 10%: 1000
  ('qi2','qt1','資料(軽減税率)',1,333,8),   -- 8%: 333
  ('qi3','qt1','資料(軽減税率)',1,333,8),
  ('qi4','qt1','資料(軽減税率)',1,333,8);
DO $$ BEGIN
  PERFORM t_eq('① QuoteItem.amount (2 x 500)', (SELECT amount FROM "QuoteItem" WHERE id='qi1'), 1000);
  PERFORM t_eq('② subtotal10',  (SELECT "subtotal10"  FROM "Quote" WHERE id='qt1'), 1000);
  PERFORM t_eq('② tax10  (1000 x 10%)', (SELECT "tax10" FROM "Quote" WHERE id='qt1'), 100);
  PERFORM t_eq('② subtotal8',   (SELECT "subtotal8"   FROM "Quote" WHERE id='qt1'), 999);
  -- 明細ごとに丸めると floor(26.64)x3 = 78 になる。書類単位で1回なら floor(79.92) = 79
  PERFORM t_eq('② tax8 (999 x 8% を書類単位で切り捨て)', (SELECT "tax8" FROM "Quote" WHERE id='qt1'), 79);
  PERFORM t_eq('② totalAmount', (SELECT "totalAmount" FROM "Quote" WHERE id='qt1'), 2178);
END $$;

-- ── ⑤ 契約に変換した見積は編集不可 ──
INSERT INTO "Contract"(id,"organizationId","projectId","sourceQuoteId",number)
  VALUES ('ct1','org1','prj1','qt1','C-2026-0001');
INSERT INTO "ContractItem"(id,"contractId",name,quantity,"unitPrice","taxRate")
  VALUES ('ci1','ct1','デザイン費',1,1000000,10);
DO $$ BEGIN
  PERFORM t_eq('   Contract.subtotal (継承後)', (SELECT subtotal FROM "Contract" WHERE id='ct1'), 1000000);
  PERFORM t_fail('⑤ 変換済み見積の明細を更新', $q$UPDATE "QuoteItem" SET "unitPrice"=9999 WHERE id='qi1'$q$);
  PERFORM t_fail('⑤ 変換済み見積に明細を追加', $q$INSERT INTO "QuoteItem"(id,"quoteId",name,"unitPrice") VALUES('qiX','qt1','追加',1)$q$);
  PERFORM t_fail('⑤ 変換済み見積の明細を削除', $q$DELETE FROM "QuoteItem" WHERE id='qi2'$q$);
END $$;

-- ── ③ 金額0で請求書を作ってから明細を足しても超過が弾かれる ──
INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"sequenceNo")
  VALUES ('iv1','org1','prj1','ct1','I-2026-0001',1);
INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice","taxRate")
  VALUES ('ii1','iv1','着手金',1,600000,10);
DO $$ BEGIN
  PERFORM t_eq('   1枚目の請求(税抜)', (SELECT subtotal FROM "Invoice" WHERE id='iv1'), 600000);
  PERFORM t_ok('③ 2枚目を金額0で作成(この時点では合法)',
    $q$INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"sequenceNo")
       VALUES ('iv2','org1','prj1','ct1','I-2026-0002',2)$q$);
  PERFORM t_fail('③ 2枚目に明細を追加して契約超過(600000+600000 > 1000000)',
    $q$INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice","taxRate")
       VALUES ('ii2','iv2','中間金',1,600000,10)$q$);
  PERFORM t_ok('③ 残額ちょうど(400000)なら通る',
    $q$INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice","taxRate")
       VALUES ('ii3','iv2','残金',1,400000,10)$q$);
  PERFORM t_eq('   請求済み合計(税抜)',
    (SELECT SUM(subtotal) FROM "Invoice" WHERE "contractId"='ct1' AND status<>'CANCELLED'), 1000000);
END $$;

-- ── ④ 契約金額の減額を弾く ──
DO $$ BEGIN
  PERFORM t_fail('④ 発行済み請求合計より契約金額を下げる',
    $q$UPDATE "Contract" SET subtotal=500000 WHERE id='ct1'$q$);
  PERFORM t_fail('   請求書が存在する契約の明細を編集',
    $q$UPDATE "ContractItem" SET "unitPrice"=500000 WHERE id='ci1'$q$);
END $$;

-- ── ⑥ DRAFT以外は物理削除できない ──
DO $$ BEGIN
  PERFORM t_ok('   請求書を送付済みにする', $q$UPDATE "Invoice" SET status='SENT' WHERE id='iv1'$q$);
  PERFORM t_fail('⑥ 送付済み請求書を削除', $q$DELETE FROM "Invoice" WHERE id='iv1'$q$);
  PERFORM t_fail('⑥ 契約に変換済みの見積を削除', $q$DELETE FROM "Quote" WHERE id='qt1'$q$);
END $$;

-- ── テナント整合性 ──
DO $$ BEGIN
  PERFORM t_fail('⑦ 別組織の請求書を org1 の契約にぶら下げる',
    $q$INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"sequenceNo")
       VALUES ('ivX','org2','prj1','ct1','I-2026-9999',9)$q$);
END $$;

-- ── 源泉徴収 ──
INSERT INTO "Project"(id,"organizationId","customerId",name) VALUES ('prj2','org1','cus1','原稿執筆');
INSERT INTO "Contract"(id,"organizationId","projectId",number) VALUES ('ct2','org1','prj2','C-2026-0002');
INSERT INTO "ContractItem"(id,"contractId",name,quantity,"unitPrice") VALUES ('ci2','ct2','原稿料',1,2000000);
INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"withholdingApplied")
  VALUES ('iv3','org1','prj2','ct2','I-2026-0003',true);
INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice") VALUES ('ii4','iv3','原稿料',1,1000000);
DO $$ BEGIN
  PERFORM t_eq('⑧ 源泉徴収(税抜100万 x 10.21%)', (SELECT "withholdingTax" FROM "Invoice" WHERE id='iv3'), 102100);
  PERFORM t_eq('⑧ 差引請求額(1,100,000 - 102,100)', (SELECT "paymentAmount" FROM "Invoice" WHERE id='iv3'), 997900);
  PERFORM t_ok('   100万超に増額', $q$UPDATE "InvoiceItem" SET "unitPrice"=2000000 WHERE id='ii4'$q$);
  PERFORM t_eq('⑧ 源泉徴収(税抜200万: 100万超部分 20.42% + 102,100)',
    (SELECT "withholdingTax" FROM "Invoice" WHERE id='iv3'), 306300);
  PERFORM t_ok('   源泉徴収を対象外に戻す', $q$UPDATE "Invoice" SET "withholdingApplied"=false WHERE id='iv3'$q$);
  PERFORM t_eq('⑧ 対象外なら0', (SELECT "withholdingTax" FROM "Invoice" WHERE id='iv3'), 0);
END $$;

-- ── 入力値チェックとカスケード削除 ──
INSERT INTO "Quote"(id,"organizationId","projectId",number) VALUES ('qt2','org1','prj1','Q-2026-0002');
INSERT INTO "QuoteItem"(id,"quoteId",name,"unitPrice") VALUES ('qi9','qt2','下書き明細',100);
DO $$ BEGIN
  PERFORM t_fail('⑨ 税率5%の明細',      $q$INSERT INTO "QuoteItem"(id,"quoteId",name,"unitPrice","taxRate") VALUES('qiY','qt2','x',1,5)$q$);
  PERFORM t_fail('⑨ 数量0の明細',        $q$INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice") VALUES('qiZ','qt2','x',0,1)$q$);
  PERFORM t_fail('⑨ 不正な登録番号',      $q$UPDATE "Organization" SET "invoiceRegistrationNumber"='12345' WHERE id='org1'$q$);
  PERFORM t_ok('⑨ 正しい登録番号',        $q$UPDATE "Organization" SET "invoiceRegistrationNumber"='T1234567890123' WHERE id='org1'$q$);
  PERFORM t_ok('⑩ 下書き見積は明細ごと削除できる(カスケード)', $q$DELETE FROM "Quote" WHERE id='qt2'$q$);
END $$;
