// Database helpers for the auth service (PostgreSQL)
// Matches the team's Tables.sql: people live in "customers" and "staff_users".
// Install first: npm install pg
// Set the connection before starting, for example (PowerShell):
//   $env:DATABASE_URL="postgres://USER:PASSWORD@localhost:5432/brightloop"
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Find a person by email: looks in customers first, then staff_users.
// Returns { id, email, passwordHash, role, kind } or null.
// kind is "customer" or "staff" (it tells us which table the person is in).
async function findByEmail(email) {
  const e = String(email).toLowerCase();

  let result = await pool.query(
    `SELECT id, email, password_hash AS "passwordHash", role
     FROM customers WHERE email = $1`,
    [e]
  );
  if (result.rows[0]) return { ...result.rows[0], kind: "customer" };

  result = await pool.query(
    `SELECT id, email, password_hash AS "passwordHash", role
     FROM staff_users WHERE email = $1`,
    [e]
  );
  if (result.rows[0]) return { ...result.rows[0], kind: "staff" };

  return null;
}

// Add a new customer (the password must already be hashed).
async function createCustomer(email, passwordHash) {
  const result = await pool.query(
    `INSERT INTO customers (email, password_hash, role)
     VALUES ($1, $2, 'customer')
     RETURNING id, email, role`,
    [email.toLowerCase(), passwordHash]
  );
  return result.rows[0];
}

// Add a new staff member. role must be 'admin' or 'sales'.
async function createStaff(email, passwordHash, role) {
  const result = await pool.query(
    `INSERT INTO staff_users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, email, role`,
    [email.toLowerCase(), passwordHash, role]
  );
  return result.rows[0];
}

// Change a person's password in whichever table they are in.
async function updatePassword(user, passwordHash) {
  const table = user.kind === "staff" ? "staff_users" : "customers";
  await pool.query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [
    passwordHash,
    user.id,
  ]);
}

module.exports = { findByEmail, createCustomer, createStaff, updatePassword };
