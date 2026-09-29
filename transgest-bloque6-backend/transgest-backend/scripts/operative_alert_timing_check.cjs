const assert = require('node:assert/strict');
const { madridClock, scheduledTimeMinutes, scheduleReached, elapsedDaysSince } = require('../src/services/operativeAlertTiming');

const now = new Date('2026-09-29T10:00:00Z'); // 12:00 Europe/Madrid
assert.deepEqual(madridClock(now), { date: '2026-09-29', minutes: 720 });
assert.equal(scheduledTimeMinutes('08:00', '08:00-13:00'), 780);
assert.equal(scheduleReached('2026-09-29', '08:00', '08:00-13:00', now), false);
assert.equal(scheduleReached('2026-09-29', '11:30', '', now), true);
assert.equal(scheduleReached('2026-09-29', '', '', now), true, 'sin hora: recordatorio en la fecha');
assert.equal(scheduleReached('2026-09-30', '', '', now), false);
assert.equal(scheduleReached('2026-09-28', '23:59', '', now), true);
assert.equal(scheduleReached('', '', '', now), false);
assert.equal(elapsedDaysSince('2026-09-26T10:00:01Z', 3, now), false);
assert.equal(elapsedDaysSince('2026-09-26T10:00:00Z', 3, now), true);
assert.equal(elapsedDaysSince(null, 3, now), false, 'sin entrega real no se anticipa el POD');
assert.deepEqual(madridClock(new Date('2026-03-29T01:30:00Z')), { date: '2026-03-29', minutes: 210 });
assert.deepEqual(madridClock(new Date('2026-10-25T01:30:00Z')), { date: '2026-10-25', minutes: 150 });
console.log('PASS AvIm horarios, ventanas, entrega real y cambios de hora Europe/Madrid');
