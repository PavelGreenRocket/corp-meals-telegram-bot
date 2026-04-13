const pool = require("../db/pool");

async function listEmployees({ activeOnly = true, limit = 50, offset = 0 } = {}) {
  const filters = [];
  const values = [];

  if (activeOnly) {
    values.push(true);
    filters.push(`is_active = $${values.length}`);
  }

  values.push(limit);
  values.push(offset);

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `
      SELECT id, full_name, note, is_active, created_at, updated_at
      FROM employees
      ${whereClause}
      ORDER BY full_name ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );

  return rows;
}

async function listRecentEmployees(limit = 8) {
  const { rows } = await pool.query(
    `
      SELECT e.id, e.full_name, e.note, e.is_active, MAX(me.meal_date) AS last_meal_date
      FROM employees e
      JOIN meal_entries me ON me.employee_id = e.id
      WHERE e.is_active = true
      GROUP BY e.id, e.full_name, e.note, e.is_active
      ORDER BY MAX(me.meal_date) DESC, e.full_name ASC
      LIMIT $1
    `,
    [limit]
  );
  return rows;
}

async function getEmployeeById(employeeId) {
  const { rows } = await pool.query(
    `
      SELECT id, full_name, note, is_active, created_at, updated_at
      FROM employees
      WHERE id = $1
    `,
    [employeeId]
  );
  return rows[0] || null;
}

async function createEmployee({ fullName, note = null }) {
  const { rows } = await pool.query(
    `
      INSERT INTO employees (full_name, note, is_active, created_at, updated_at)
      VALUES ($1, $2, true, NOW(), NOW())
      RETURNING id, full_name, note, is_active, created_at, updated_at
    `,
    [String(fullName || "").trim(), note ? String(note).trim() : null]
  );
  return rows[0];
}

async function updateEmployee(employeeId, { fullName, note, isActive }) {
  const { rows } = await pool.query(
    `
      UPDATE employees
      SET full_name = $2,
          note = $3,
          is_active = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, full_name, note, is_active, created_at, updated_at
    `,
    [employeeId, String(fullName || "").trim(), note ? String(note).trim() : null, Boolean(isActive)]
  );
  return rows[0] || null;
}

async function toggleEmployeeActive(employeeId) {
  const { rows } = await pool.query(
    `
      UPDATE employees
      SET is_active = NOT is_active,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, full_name, note, is_active, created_at, updated_at
    `,
    [employeeId]
  );
  return rows[0] || null;
}

async function countEmployeeMeals(employeeId) {
  const { rows } = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM meal_entries
      WHERE employee_id = $1
    `,
    [employeeId]
  );
  return rows[0]?.total || 0;
}

async function deleteEmployee(employeeId) {
  const { rows } = await pool.query(
    `
      DELETE FROM employees
      WHERE id = $1
      RETURNING id, full_name, note, is_active, created_at, updated_at
    `,
    [employeeId]
  );
  return rows[0] || null;
}

module.exports = {
  countEmployeeMeals,
  createEmployee,
  deleteEmployee,
  getEmployeeById,
  listEmployees,
  listRecentEmployees,
  toggleEmployeeActive,
  updateEmployee
};
