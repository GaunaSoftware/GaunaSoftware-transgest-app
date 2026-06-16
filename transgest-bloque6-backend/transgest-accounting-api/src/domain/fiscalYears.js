function parseIsoDate(value, fieldName) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const err = new Error(`${fieldName} debe tener formato YYYY-MM-DD`);
    err.status = 400;
    throw err;
  }
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    const err = new Error(`${fieldName} no es una fecha valida`);
    err.status = 400;
    throw err;
  }
  return date;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function endOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function normalizeFiscalYearInput(input = {}) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const startDate = parseIsoDate(input.start_date || `${currentYear}-01-01`, "start_date");
  const endDate = parseIsoDate(input.end_date || `${startDate.getUTCFullYear()}-12-31`, "end_date");
  if (startDate > endDate) {
    const err = new Error("start_date debe ser anterior o igual a end_date");
    err.status = 400;
    throw err;
  }
  const yearLabel = String(input.year_label || startDate.getUTCFullYear()).trim();
  if (!yearLabel || yearLabel.length > 20) {
    const err = new Error("year_label es obligatorio y no puede superar 20 caracteres");
    err.status = 400;
    throw err;
  }
  return {
    year_label: yearLabel,
    start_date: formatIsoDate(startDate),
    end_date: formatIsoDate(endDate),
  };
}

function buildMonthlyPeriods(startDateValue, endDateValue) {
  const startDate = parseIsoDate(startDateValue, "start_date");
  const endDate = parseIsoDate(endDateValue, "end_date");
  const periods = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  let periodNumber = 1;

  while (cursor <= endDate) {
    const monthStart = cursor < startDate ? startDate : cursor;
    const naturalMonthEnd = endOfUtcMonth(cursor);
    const monthEnd = naturalMonthEnd > endDate ? endDate : naturalMonthEnd;
    if (monthStart <= monthEnd) {
      const label = monthStart.toLocaleString("es-ES", { month: "long", timeZone: "UTC" });
      periods.push({
        period_number: periodNumber,
        name: `${label.charAt(0).toUpperCase()}${label.slice(1)} ${monthStart.getUTCFullYear()}`,
        start_date: formatIsoDate(monthStart),
        end_date: formatIsoDate(monthEnd),
      });
      periodNumber += 1;
    }
    cursor = addUtcMonths(cursor, 1);
  }
  return periods;
}

module.exports = {
  buildMonthlyPeriods,
  normalizeFiscalYearInput,
};
