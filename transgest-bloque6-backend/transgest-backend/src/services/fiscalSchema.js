const fs = require('fs');
const path = require('path');

async function ensureFiscalDeliverySchema(client) {
  const migration = path.join(__dirname, '../../scripts/migrations/022_fiscal_accounting_delivery.sql');
  await client.query(fs.readFileSync(migration, 'utf8'));
}

module.exports = { ensureFiscalDeliverySchema };
