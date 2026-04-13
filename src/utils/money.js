function parseAmount(input) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input > 0 ? Number(input.toFixed(2)) : null;
  }

  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.replace(/\s+/g, "").replace(",", ".");
  const value = Number(normalized);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Number(value.toFixed(2));
}

function formatAmount(amount) {
  const value = Number(amount || 0);
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

const HUNDREDS = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот"
];

const TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто"
];

const TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать"
];

const UNITS = {
  male: ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
  female: ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
};

const ORDERS = [
  ["рубль", "рубля", "рублей", "male"],
  ["тысяча", "тысячи", "тысяч", "female"],
  ["миллион", "миллиона", "миллионов", "male"],
  ["миллиард", "миллиарда", "миллиардов", "male"]
];

function pluralize(number, forms) {
  const normalized = Math.abs(Number(number)) % 100;
  const last = normalized % 10;

  if (normalized > 10 && normalized < 20) {
    return forms[2];
  }

  if (last > 1 && last < 5) {
    return forms[1];
  }

  if (last === 1) {
    return forms[0];
  }

  return forms[2];
}

function chunkToWords(chunk, gender) {
  const value = Number(chunk);
  if (!value) {
    return "";
  }

  const hundreds = Math.floor(value / 100);
  const tensUnits = value % 100;
  const tens = Math.floor(tensUnits / 10);
  const units = tensUnits % 10;
  const words = [];

  if (hundreds) {
    words.push(HUNDREDS[hundreds]);
  }

  if (tensUnits >= 10 && tensUnits < 20) {
    words.push(TEENS[tensUnits - 10]);
  } else {
    if (tens) {
      words.push(TENS[tens]);
    }
    if (units) {
      words.push(UNITS[gender][units]);
    }
  }

  return words.join(" ");
}

function amountToWords(amount) {
  const value = Number(amount || 0);
  const rubles = Math.floor(value);
  const kopeks = String(Math.round((value - rubles) * 100)).padStart(2, "0");

  if (rubles === 0) {
    return `Ноль рублей ${kopeks} копеек`;
  }

  const chunks = [];
  let remainder = rubles;
  let orderIndex = 0;

  while (remainder > 0) {
    chunks.push(remainder % 1000);
    remainder = Math.floor(remainder / 1000);
  }

  const parts = [];

  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (!chunk) {
      continue;
    }

    const order = ORDERS[index];
    const words = chunkToWords(chunk, order[3]);
    const label = pluralize(chunk, order);

    parts.push(words, label);
  }

  const phrase = `${parts.join(" ")} ${kopeks} копеек`.trim();
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

module.exports = {
  amountToWords,
  parseAmount,
  formatAmount
};
