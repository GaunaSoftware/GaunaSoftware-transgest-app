DELETE FROM accounting.accounting_role_permissions
 WHERE permission_id IN (
   SELECT id FROM accounting.accounting_permissions
    WHERE code IN ('banks.read', 'banks.write')
 );

DELETE FROM accounting.accounting_permissions
 WHERE code IN ('banks.read', 'banks.write');

DROP INDEX IF EXISTS accounting.idx_bank_transactions_status;
DROP INDEX IF EXISTS accounting.idx_bank_transactions_company_date;
DROP INDEX IF EXISTS accounting.idx_accounting_bank_accounts_company;

DROP TABLE IF EXISTS accounting.bank_transactions;
DROP TABLE IF EXISTS accounting.accounting_bank_accounts;
