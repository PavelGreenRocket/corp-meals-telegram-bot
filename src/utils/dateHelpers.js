const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const config = require("../config");

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь"
];

function parseDateInput(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  const formats = ["DD.MM.YYYY", "YYYY-MM-DD"];

  for (const format of formats) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) {
      return parsed.format("YYYY-MM-DD");
    }
  }

  return null;
}

function normalizeMonthYearInput(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const cleaned = input.trim().replace("/", ".");
  const match = cleaned.match(/^(\d{1,2})\.(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const year = Number(match[2]);

  if (month < 1 || month > 12 || year < 2000) {
    return null;
  }

  return { month, year };
}

function parsePeriodInput(input) {
  if (!input || typeof input !== "string") {
    return null;
  }

  const parts = input.trim().split(/\s*-\s*/);
  if (parts.length !== 2) {
    return null;
  }

  const startDate = parseDateInput(parts[0]);
  const endDate = parseDateInput(parts[1]);

  if (!startDate || !endDate) {
    return null;
  }

  return normalizePeriod(startDate, endDate);
}

function normalizePeriod(startDate, endDate) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
    return null;
  }

  return {
    startDate: start.format("YYYY-MM-DD"),
    endDate: end.format("YYYY-MM-DD")
  };
}

function getMonthRange(month, year) {
  const start = dayjs(`${year}-${String(month).padStart(2, "0")}-01`);
  return {
    startDate: start.format("YYYY-MM-DD"),
    endDate: start.endOf("month").format("YYYY-MM-DD")
  };
}

function isFullMonthPeriod(startDate, endDate) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  if (!start.isValid() || !end.isValid()) {
    return false;
  }

  const { startDate: monthStart, endDate: monthEnd } = getMonthRange(start.month() + 1, start.year());
  return start.format("YYYY-MM-DD") === monthStart && end.format("YYYY-MM-DD") === monthEnd;
}

function formatDateRu(date) {
  return dayjs(date).format("DD.MM.YYYY");
}

function formatDateShort(date) {
  return dayjs(date).format("DD.MM.YY");
}

function monthNameRu(month) {
  return MONTH_NAMES[month - 1] || "";
}

function monthYearLabel(month, year) {
  return `${monthNameRu(month)} ${year} г.`;
}

function todayIso() {
  return dayjs().tz(config.appTimeZone).format("YYYY-MM-DD");
}

function yesterdayIso() {
  return dayjs().tz(config.appTimeZone).subtract(1, "day").format("YYYY-MM-DD");
}

function startOfCurrentMonth() {
  return dayjs().tz(config.appTimeZone).startOf("month").format("YYYY-MM-DD");
}

function endOfCurrentMonth() {
  return dayjs().tz(config.appTimeZone).endOf("month").format("YYYY-MM-DD");
}

function getCurrentDateParts() {
  const current = dayjs().tz(config.appTimeZone);
  return {
    day: current.date(),
    isoDate: current.format("YYYY-MM-DD"),
    month: current.month() + 1,
    year: current.year()
  };
}

function getPreviousMonthParts() {
  const previous = dayjs().tz(config.appTimeZone).subtract(1, "month");
  return {
    month: previous.month() + 1,
    year: previous.year()
  };
}

module.exports = {
  endOfCurrentMonth,
  formatDateRu,
  formatDateShort,
  getCurrentDateParts,
  getMonthRange,
  getPreviousMonthParts,
  isFullMonthPeriod,
  monthNameRu,
  monthYearLabel,
  normalizeMonthYearInput,
  normalizePeriod,
  parseDateInput,
  parsePeriodInput,
  startOfCurrentMonth,
  todayIso,
  yesterdayIso
};
