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
function isPublishedHistoricalVariant(id, recorded, current) {
  return id === '003_operational_normalization' && current === canonical003 && published003.has(recorded);
}
module.exports = { isPublishedHistoricalVariant };
