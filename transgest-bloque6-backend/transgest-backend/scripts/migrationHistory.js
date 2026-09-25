// 003 was edited in released commits before migrations became immutable.
// Keep the original SQL and recorded checksums; 018 converges these known versions.
// Never accept an unknown checksum or a newly edited canonical file.
const canonical003 = '3e40fa76cccb251472f7ac364174f77771d6819982b0d772fc39318b925bea90';
const published003 = new Set([
  'aaf9bf431bd53e3339943b629b3dd4d740231ab92318724d10b0b2e9a6a5330e', // 9c6f02c
  '643db13fa2f7b4634c68003cbd66545af19d2c3ee08012ca31a9e6c8f36a03f8', // 501e8a8
  'ca5c77b11d30acf3a379e8be611cc794492b0eca30b5d92ddc6c632f7ca58d12', // 3cc8d14
  '046a56f955e70ee7d83b9be4deaa863084a2049fbe9cbcbc0e0b67b962c535e7', // 3afea48
]);
// La primera versión de claves de importación se aplicó en el ensayo aislado.
// Producción rechazó su índice único por duplicados históricos y revirtió la
// transacción. La variante de ensayo conserva sus índices más restrictivos.
const canonicalImportTenantKeys = '2caa107bc18bd22896fcc973ac3e57b48525dcb265824b8b0e561a6232fa3621';
const stagingImportTenantKeys = 'a86bf4dfbe7990f5e3c5a96386b3ccae09e98b1e09da99d31021d4b0c09fa8d2';
function isPublishedHistoricalVariant(id, recorded, current) {
  return (id === '003_operational_normalization' && current === canonical003 && published003.has(recorded)) ||
    (id === '20260924_import_tenant_keys' && current === canonicalImportTenantKeys && recorded === stagingImportTenantKeys);
}
module.exports = { isPublishedHistoricalVariant };
