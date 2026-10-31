// Brightloop API: one file, same endpoints and responses as before.
import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------
// 1. SETUP
// ---------------------------------------------------------------

// Stop immediately, with a clear message, if a required setting is missing
for (const name of ["DATABASE_URL", "JWT_SECRET"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Add it to your .env file and restart.`);
    process.exit(1);
  }
}

// Read DATE columns as plain text ("2026-11-01") to avoid timezone shifts
pg.types.setTypeParser(1082, (value) => value);

// Connection pool to PostgreSQL
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors());           // allow the website (a different origin) to call us
app.use(express.json());   // turn JSON request bodies into req.body

// Serve the website (web/index.html, admin.html, sales.html) from this same server.
// Open http://localhost:3000 instead of double-clicking the HTML files.
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(here, "web")));

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

// ---------------------------------------------------------------
// 2. HELPERS
// ---------------------------------------------------------------

// Stop the current request and send this status and message
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

// Run several queries as one unit: all succeed, or none do
async function transaction(work) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Step 1 of access control: is there a valid login token?
// On success, req.user becomes { id, email, role }.
function requireLogin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please log in again" });
  }
}

// Step 2 of access control: does the user have one of these roles?
// Always place it after requireLogin.
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden" });

// Read ?limit= and ?offset= safely (max 200 rows per page)
function page(req) {
  return {
    limit: Math.min(Number(req.query.limit) || 50, 200),
    offset: Math.max(Number(req.query.offset) || 0, 0),
  };
}

// Read the :id from the URL and make sure it's a positive whole number
function idFrom(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) fail(400, "Invalid id");
  return id;
}

// ---------------------------------------------------------------
// 3. INPUT RULES (what a valid request body looks like)
// ---------------------------------------------------------------

const passwordRule = z
  .string()
  .min(9, "Password must be more than 8 characters")
  .regex(/[A-Z]/, "Needs an uppercase letter")
  .regex(/[a-z]/, "Needs a lowercase letter")
  .regex(/[^A-Za-z0-9]/, "Needs a special character");

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

const staffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordRule,
  role: z.enum(["admin", "sales"]),
});

const customerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordRule,
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(150),
  type: z.string().trim().min(1).max(50),
  salesPrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative(),
  notes: z.string().optional(),
});

const planSchema = z.object({
  productId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  price: z.number().nonnegative(),
  billingPeriod: z.enum(["daily", "weekly", "monthly", "yearly"]),
  minQuantity: z.number().int().min(1).default(1),
  availableFrom: z.string().date().optional(),
  availableTo: z.string().date().optional(),
});

const subscriptionSchema = z.object({
  customerId: z.number().int().positive(),
  planId: z.number().int().positive(),
  quantity: z.number().int().min(1).default(1),
  startDate: z.string().date(),
  expiryDate: z.string().date().optional(),
});

const paySchema = z.object({
  paidOn: z.string().date().optional(),
});

// ---------------------------------------------------------------
// 4. ROUTES
// Each route lists who may use it, right in the line that defines it.
// ---------------------------------------------------------------

app.get("/health", (req, res) => res.json({ status: "ok" }));

// ---- Login and staff ----

// Anyone can try to log in
app.post("/auth/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const { rows } = await db.query(
    "SELECT id, email, password_hash, role FROM staff_users WHERE email = $1",
    [email]
  );
  const user = rows[0];
  const passwordOk = user && (await bcrypt.compare(password, user.password_hash));

  // Same message whether the email or the password is wrong
  if (!passwordOk) fail(401, "Invalid email or password");

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  res.json({ token, role: user.role, email: user.email });
});

// Only admins create staff
app.post("/auth/staff", requireLogin, allow("admin"), async (req, res) => {
  const d = staffSchema.parse(req.body);
  const hash = await bcrypt.hash(d.password, BCRYPT_ROUNDS);

  const { rows } = await db.query(
    `INSERT INTO staff_users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, email, role`,
    [d.email, hash, d.role]
  );
  res.status(201).json(rows[0]);
});

// ---- Customers ----

app.get("/customers", requireLogin, allow("admin", "sales"), async (req, res) => {
  const { limit, offset } = page(req);
  const { rows } = await db.query(
    `SELECT id, email, has_paid, created_at
       FROM customers ORDER BY id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
});

app.post("/customers", requireLogin, allow("admin", "sales"), async (req, res) => {
  const d = customerSchema.parse(req.body);
  const hash = await bcrypt.hash(d.password, BCRYPT_ROUNDS);

  const { rows } = await db.query(
    `INSERT INTO customers (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, has_paid, created_at`,
    [d.email, hash]
  );
  res.status(201).json(rows[0]);
});

// ---- Products (only admins create them) ----

app.get("/products", requireLogin, allow("admin", "sales"), async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, name, type, sales_price, cost_price, active FROM products ORDER BY id"
  );
  res.json(rows);
});

app.post("/products", requireLogin, allow("admin"), async (req, res) => {
  const d = productSchema.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO products (name, type, sales_price, cost_price, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [d.name, d.type, d.salesPrice, d.costPrice, d.notes ?? null]
  );
  res.status(201).json(rows[0]);
});

// ---- Plans (only admins create them) ----

app.get("/plans", requireLogin, allow("admin", "sales"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT pl.id, pl.product_id, pr.name AS product_name, pl.name,
            pl.price, pl.billing_period, pl.min_quantity
       FROM plans pl
       JOIN products pr ON pr.id = pl.product_id
      ORDER BY pl.id`
  );
  res.json(rows);
});

app.post("/plans", requireLogin, allow("admin"), async (req, res) => {
  const d = planSchema.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO plans (product_id, name, price, billing_period,
                        min_quantity, available_from, available_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [d.productId, d.name, d.price, d.billingPeriod,
     d.minQuantity, d.availableFrom ?? null, d.availableTo ?? null]
  );
  res.status(201).json(rows[0]);
});

// ---- Subscriptions ----

app.get("/subscriptions", requireLogin, allow("admin", "sales"), async (req, res) => {
  const { limit, offset } = page(req);
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;

  const { rows } = await db.query(
    `SELECT s.id, c.email AS customer_email, pr.name AS product_name, pl.name AS plan_name,
            s.quantity, s.unit_price, s.status, s.start_date, s.next_billing_date, s.expiry_date
       FROM subscriptions s
       JOIN customers c  ON c.id  = s.customer_id
       JOIN products  pr ON pr.id = s.product_id
       JOIN plans     pl ON pl.id = s.plan_id
      WHERE ($1::text IS NULL OR s.status = $1)
      ORDER BY s.id DESC
      LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );
  res.json(rows);
});

// The price is read from the plan on the server. The client never sends it.
app.post("/subscriptions", requireLogin, allow("admin", "sales"), async (req, res) => {
  const d = subscriptionSchema.parse(req.body);
  if (d.expiryDate && d.expiryDate < d.startDate) {
    fail(422, "expiryDate cannot be before startDate");
  }

  const subscription = await transaction(async (client) => {
    // Find the plan only if it can be sold on this date and quantity
    const { rows: plans } = await client.query(
      `SELECT id, product_id, price FROM plans
        WHERE id = $1
          AND (available_from IS NULL OR available_from <= $2)
          AND (available_to   IS NULL OR available_to   >= $2)
          AND min_quantity <= $3`,
      [d.planId, d.startDate, d.quantity]
    );
    const plan = plans[0];
    if (!plan) fail(422, "Plan is not available for this start date or quantity");

    const { rows } = await client.query(
      `INSERT INTO subscriptions
         (customer_id, product_id, plan_id, quantity, unit_price,
          start_date, expiry_date, next_billing_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6, 'ACTIVE')
       RETURNING *`,
      [d.customerId, plan.product_id, plan.id, d.quantity,
       plan.price, d.startDate, d.expiryDate ?? null]
    );
    return rows[0];
  });

  res.status(201).json(subscription);
});

// Create the invoice for the next billing period, then move the date forward
app.post("/subscriptions/:id/invoices", requireLogin, allow("admin", "sales"), async (req, res) => {
  const id = idFrom(req);

  const invoice = await transaction(async (client) => {
    // Lock the subscription row so two clicks can't bill the same period
    const { rows } = await client.query(
      `SELECT s.id, s.customer_id, s.status, s.expiry_date, s.next_billing_date,
              (s.unit_price * s.quantity) AS amount,
              (s.next_billing_date + CASE p.billing_period
                  WHEN 'daily'   THEN INTERVAL '1 day'
                  WHEN 'weekly'  THEN INTERVAL '7 days'
                  WHEN 'monthly' THEN INTERVAL '1 month'
                  WHEN 'yearly'  THEN INTERVAL '1 year'
               END)::date AS period_end
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1
        FOR UPDATE OF s`,
      [id]
    );
    const sub = rows[0];

    if (!sub) fail(404, "Subscription not found");
    if (sub.status !== "ACTIVE") fail(409, `Subscription is ${sub.status}, so it cannot be billed`);
    if (sub.expiry_date && sub.next_billing_date > sub.expiry_date) {
      fail(409, "Subscription has reached its expiry date");
    }

    const { rows: created } = await client.query(
      `INSERT INTO invoices
         (subscription_id, customer_id, period_start, period_end, amount, issue_date, due_date)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_DATE + 14)
       RETURNING *`,
      [sub.id, sub.customer_id, sub.next_billing_date, sub.period_end, sub.amount]
    );

    await client.query(
      "UPDATE subscriptions SET next_billing_date = $2 WHERE id = $1",
      [sub.id, sub.period_end]
    );
    return created[0];
  });

  res.status(201).json(invoice);
});

// ---- Invoices ----

// "state" is worked out from the data: PAID, OVERDUE or UNPAID
app.get("/invoices", requireLogin, allow("admin", "sales"), async (req, res) => {
  const { limit, offset } = page(req);
  const state = req.query.status ? String(req.query.status).toUpperCase() : null;

  const { rows } = await db.query(
    `SELECT * FROM (
        SELECT i.id, c.email AS customer_email, i.period_start, i.period_end,
               i.amount, i.issue_date, i.due_date, i.is_paid, i.paid_on,
               CASE WHEN i.is_paid THEN 'PAID'
                    WHEN i.due_date < CURRENT_DATE THEN 'OVERDUE'
                    ELSE 'UNPAID' END AS state
          FROM invoices i
          JOIN customers c ON c.id = i.customer_id
     ) t
      WHERE ($1::text IS NULL OR t.state = $1)
      ORDER BY t.id DESC
      LIMIT $2 OFFSET $3`,
    [state, limit, offset]
  );
  res.json(rows);
});

// Mark an invoice paid, and update the customer's has_paid flag
app.post("/invoices/:id/pay", requireLogin, allow("admin", "sales"), async (req, res) => {
  const id = idFrom(req);
  const { paidOn } = paySchema.parse(req.body ?? {});

  const invoice = await transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id, customer_id, is_paid FROM invoices WHERE id = $1 FOR UPDATE",
      [id]
    );
    const inv = rows[0];
    if (!inv) fail(404, "Invoice not found");
    if (inv.is_paid) fail(409, "Invoice is already paid");

    const { rows: updated } = await client.query(
      `UPDATE invoices
          SET is_paid = TRUE, paid_on = COALESCE($2::date, CURRENT_DATE)
        WHERE id = $1
        RETURNING *`,
      [id, paidOn ?? null]
    );

    // has_paid is TRUE when the customer has paid something
    // and has no unpaid invoice that is past due
    await client.query(
      `UPDATE customers c
          SET has_paid =
                EXISTS (SELECT 1 FROM invoices i
                         WHERE i.customer_id = c.id AND i.is_paid)
            AND NOT EXISTS (SELECT 1 FROM invoices i
                             WHERE i.customer_id = c.id
                               AND NOT i.is_paid
                               AND i.due_date < CURRENT_DATE)
        WHERE c.id = $1`,
      [inv.customer_id]
    );
    return updated[0];
  });

  res.json(invoice);
});

// ---- Reports (admin only) ----

app.get("/reports/summary", requireLogin, allow("admin"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM customers)::int                                     AS customers,
       (SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE')::int         AS active_subscriptions,
       (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE is_paid)::float      AS revenue_collected,
       (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE NOT is_paid)::float  AS amount_outstanding,
       (SELECT COUNT(*) FROM invoices
          WHERE NOT is_paid AND due_date < CURRENT_DATE)::int                    AS overdue_invoices`
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------
// 5. ERRORS
// ---------------------------------------------------------------

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  if (err.name === "ZodError") {
    return res.status(422).json({ error: "Validation failed", details: err.issues });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  // PostgreSQL error codes
  if (err.code === "23505") return res.status(409).json({ error: "Already exists" });
  if (err.code === "23503") return res.status(422).json({ error: "Referenced record does not exist" });
  if (err.code === "23514") return res.status(422).json({ error: "A business rule was violated" });

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------------------------------------------------
// 6. START
// ---------------------------------------------------------------

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Brightloop API running on http://localhost:${port}`));
