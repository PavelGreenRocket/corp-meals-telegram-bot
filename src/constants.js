const USER_ROLES = {
  OWNER: "owner",
  BARISTA: "barista",
  CLIENT_VIEWER: "client_viewer"
};

const DOCUMENT_TYPES = {
  ACT: "act",
  RECONCILIATION: "reconciliation"
};

const DOCUMENT_STATUSES = {
  GENERATED: "generated",
  SENT: "sent",
  SIGNED: "signed"
};

const APP_SETTING_KEYS = {
  PERFORMER_DETAILS: "performer_details",
  CUSTOMER_DETAILS: "customer_details",
  DOCUMENT_SETTINGS: "document_settings",
  MONTHLY_DOCUMENT_REMINDER: "monthly_document_reminder"
};

const DAILY_LIMIT = 300;
const RAILSHIP_SHORT_NAME = "Railship";
const RAILSHIP_LEGAL_NAME = "ООО «Рейлшип Сервис»";

module.exports = {
  APP_SETTING_KEYS,
  DAILY_LIMIT,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  RAILSHIP_LEGAL_NAME,
  RAILSHIP_SHORT_NAME,
  USER_ROLES
};
