const pool = require("../db/pool");
const queries = require("../db/queries");

async function listClients(onlyActive = true) {
  const sql = onlyActive ? queries.clients.listActive : queries.clients.listAll;
  const { rows } = await pool.query(sql);
  return rows;
}

async function getClientById(clientId) {
  const { rows } = await pool.query(queries.clients.byId, [clientId]);
  return rows[0] || null;
}

async function createClient({ shortName, legalName, inn, kpp }) {
  const { rows } = await pool.query(queries.clients.create, [
    shortName.trim(),
    legalName.trim(),
    inn.trim(),
    kpp ? kpp.trim() : null
  ]);
  return rows[0];
}

async function getClientCard(clientId) {
  const client = await getClientById(clientId);
  if (!client) {
    return null;
  }

  const totalsQuery = `
    SELECT
      COALESCE(SUM(CASE WHEN operation_type = 'advance' THEN amount ELSE 0 END), 0) AS total_paid,
      COALESCE(SUM(CASE WHEN operation_type = 'meal' THEN amount ELSE 0 END), 0) AS total_charged
    FROM food_operations
    WHERE client_id = $1
  `;

  const { rows } = await pool.query(totalsQuery, [clientId]);
  const totalPaid = Number(rows[0].total_paid || 0);
  const totalCharged = Number(rows[0].total_charged || 0);

  return {
    ...client,
    totalPaid,
    totalCharged,
    balance: Number((totalPaid - totalCharged).toFixed(2))
  };
}

module.exports = {
  listClients,
  getClientById,
  createClient,
  getClientCard
};
