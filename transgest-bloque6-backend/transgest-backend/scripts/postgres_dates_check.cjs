const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const parsers = require('../src/services/postgresTypes');
if (process.env.AUDIT_DATE_CHILD === '1') {
  for (const date of ['2020-01-15','2026-03-29','2026-10-25','2026-07-01']) {
    const parsed = parsers.getTypeParser(1082, 'text')(date);
    assert.equal(parsed, date);
    assert.equal(JSON.parse(JSON.stringify({ date: parsed })).date, date);
  }
  assert.equal(parsers.getTypeParser(1184,'text')('2026-03-29 03:30:00+02').toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(parsers.getTypeParser(1184,'text')('2026-10-25 02:30:00+01').toISOString(), '2026-10-25T01:30:00.000Z');
} else {
  for (const TZ of ['Europe/Madrid','UTC','America/Los_Angeles']) {
    execFileSync(process.execPath,[__filename],{env:{...process.env,TZ,AUDIT_DATE_CHILD:'1'},stdio:'pipe',windowsHide:true});
  }
  console.log('SQL DATE preserved across timezones and DST; timestamp instants unchanged.');
}
