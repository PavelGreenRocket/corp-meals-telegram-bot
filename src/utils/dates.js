const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(customParseFormat);

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

function getMonthRange(month, year) {
  const start = dayjs(`${year}-${String(month).padStart(2, "0")}-01`);
  return {
    startDate: start.format("YYYY-MM-DD"),
    endDate: start.endOf("month").format("YYYY-MM-DD")
  };
}

function formatDateRu(date) {
  return dayjs(date).format("DD.MM.YYYY");
}

function monthNameRu(month) {
  return MONTH_NAMES[month - 1] || "";
}

module.exports = {
  parseDateInput,
  normalizeMonthYearInput,
  getMonthRange,
  formatDateRu,
  monthNameRu
};
