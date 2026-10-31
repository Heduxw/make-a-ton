// Database helpers for the auth service (PostgreSQL)
// Install first: npm install pg
// Set the connection before starting, for example (PowerShell):
//   $env:DATABASE_URL="postgres://USER:PASSWORD@localhost:5432/DBNAME"
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Find a user by email. Returns null if there is none.
async function findByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, password_hash AS "passwordHash", role
     FROM users WHERE email = $1`,
    [String(email).toLowerCase()]
  );
  return result.rows[0] || null;
}

// Add a new user (the password must already be hashed).
async function createUser(email, passwordHash, role) {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, email, role`,
    [email.toLowerCase(), passwordHash, role]
  );
  return result.rows[0];
}

// Change a user's password (the new password must already be hashed).
async function updatePassword(email, passwordHash) {
  await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [
    passwordHash,
    email.toLowerCase(),
  ]);
}

// Password reset tokens
async function saveResetToken(token, email, expiresAt) {
  await pool.query(
    "INSERT INTO reset_tokens (token, email, expires_at) VALUES ($1, $2, $3)",
    [token, email, expiresAt]
  );
}

async function getResetToken(token) {
  const result = await pool.query(
    `SELECT email, expires_at AS "expiresAt" FROM reset_tokens WHERE token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

async function deleteResetToken(token) {
  await pool.query("DELETE FROM reset_tokens WHERE token = $1", [token]);
}

module.exports = {
  findByEmail,
  createUser,
  updatePassword,
  saveResetToken,
  getResetToken,
  deleteResetToken,
};
