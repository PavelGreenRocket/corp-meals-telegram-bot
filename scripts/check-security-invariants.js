const fs = require("fs");

function assertIncludes(filePath, fragment, message) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.includes(fragment)) {
    throw new Error(`${message}: ${filePath}`);
  }
}

assertIncludes(
  "src/services/userService.js",
  "AND NOT (company = 'RS' AND receives_meals = true)",
  "Railship self-service users must be excluded from financial reminders"
);

assertIncludes(
  "src/services/mealService.js",
  "pg_advisory_xact_lock",
  "Daily meal limit must be serialized"
);

assertIncludes(
  "src/bot/index.js",
  "OWNER_ONLY_CALLBACK_PREFIXES",
  "Administrative stale callbacks must be centrally protected"
);

assertIncludes(
  "src/bot/index.js",
  "Привязка сотрудника задаётся администратором",
  "Self-service employee selection must stay disabled"
);

console.log("Security invariant checks passed.");
