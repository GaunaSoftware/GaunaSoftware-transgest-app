function madridClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function scheduledTimeMinutes(hour, window) {
  // La ventana vence al final; una cita única vence a la hora indicada.
  const value = String(window || hour || '').trim();
  const matches = [...value.matchAll(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?=\D|$)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return Number(last[1]) * 60 + Number(last[2]);
}

function scheduleReached(date, hour, window, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const clock = madridClock(now);
  if (date !== clock.date) return date < clock.date;
  const minutes = scheduledTimeMinutes(hour, window);
  return minutes === null || clock.minutes >= minutes;
}

function elapsedDaysSince(value, days, now = new Date()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= days * 86400000;
}

module.exports = { madridClock, scheduledTimeMinutes, scheduleReached, elapsedDaysSince };
