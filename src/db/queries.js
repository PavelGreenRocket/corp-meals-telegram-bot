module.exports = {
  clients: {
    listActive:
      "SELECT id, short_name, legal_name, inn, kpp, is_active, created_at FROM clients WHERE is_active = true ORDER BY short_name",
    listAll:
      "SELECT id, short_name, legal_name, inn, kpp, is_active, created_at FROM clients ORDER BY short_name",
    byId:
      "SELECT id, short_name, legal_name, inn, kpp, is_active, created_at FROM clients WHERE id = $1",
    create:
      "INSERT INTO clients (short_name, legal_name, inn, kpp) VALUES ($1, $2, $3, $4) RETURNING id, short_name, legal_name, inn, kpp, is_active, created_at"
  },
  operations: {
    create:
      "INSERT INTO food_operations (client_id, operation_type, operation_date, amount, persons_count, comment) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    byClient:
      "SELECT id, client_id, operation_type, operation_date, amount, persons_count, comment, created_at FROM food_operations WHERE client_id = $1 ORDER BY operation_date DESC, id DESC LIMIT $2",
    byClientPeriod:
      "SELECT id, client_id, operation_type, operation_date, amount, persons_count, comment, created_at FROM food_operations WHERE client_id = $1 AND operation_date BETWEEN $2 AND $3 ORDER BY operation_date ASC, id ASC"
  }
};
