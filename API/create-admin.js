// Creates a staff login from the command line (use it for the first admin).
// Usage: npm run create-admin -- admin@brightloop.com "Strong#Pass1" admin
import "dotenv/config";
import bcrypt from "bcrypt";
import pg from "pg";

const [, , email, password, role = "admin"] = process.argv;
if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password> [admin|sales]');
  process.exit(1);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 12);

const result = await db.query(
  `INSERT INTO staff_users (email, password_hash, role)
   VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
  [email.trim().toLowerCase(), hash, role]
);

console.log(result.rowCount ? `Created ${role} user ${email}` : `${email} already exists`);
await db.end();
