const pool = require("../db/pool");
const { APP_SETTING_KEYS } = require("../constants");

async function getSetting(key) {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
  return rows[0]?.value || null;
}

async function saveSetting(key, value) {
  const payload = JSON.stringify(value);
  const { rows } = await pool.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING value
    `,
    [key, payload]
  );

  return rows[0]?.value || value;
}

async function getPerformerDetails() {
  return getSetting(APP_SETTING_KEYS.PERFORMER_DETAILS);
}

async function getCustomerDetails() {
  return getSetting(APP_SETTING_KEYS.CUSTOMER_DETAILS);
}

async function getDocumentSettings() {
  return getSetting(APP_SETTING_KEYS.DOCUMENT_SETTINGS);
}

async function updatePerformerDetails(value) {
  return saveSetting(APP_SETTING_KEYS.PERFORMER_DETAILS, value);
}

async function updateCustomerDetails(value) {
  return saveSetting(APP_SETTING_KEYS.CUSTOMER_DETAILS, value);
}

module.exports = {
  getCustomerDetails,
  getDocumentSettings,
  getPerformerDetails,
  getSetting,
  saveSetting,
  updateCustomerDetails,
  updatePerformerDetails
};
