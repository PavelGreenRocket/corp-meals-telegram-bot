const fs = require("fs");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(content, fragment, message) {
  if (!content.includes(fragment)) {
    throw new Error(message);
  }
}

const userService = read("src/services/userService.js");
const mealService = read("src/services/mealService.js");
const botIndex = read("src/bot/index.js");

assertIncludes(
  userService,
  "AND NOT (company = 'RS' AND receives_meals = true)",
  "Railship self-service users must be excluded from financial reminders"
);

assertIncludes(
  userService,
  "Этот сотрудник уже привязан к другому пользователю",
  "One employee must not be linked to multiple active meal users through the service layer"
);

assertIncludes(
  mealService,
  "pg_advisory_xact_lock",
  "Daily meal limit must be serialized"
);

assertIncludes(
  botIndex,
  "OWNER_ONLY_CALLBACK_PREFIXES",
  "Administrative stale callbacks must be centrally protected"
);

assertIncludes(
  botIndex,
  "Привязка сотрудника задаётся администратором",
  "Self-service employee selection must stay disabled"
);

console.log("Security invariant checks passed.");
