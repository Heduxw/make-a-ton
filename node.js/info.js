const { Client } = require("pg");

const schema = `
CREATE TABLE IF NOT EXISTS customers (
    id             BIGSERIAL PRIMARY KEY,
    email          VARCHAR(255) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    has_paid       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    type         VARCHAR(50)  NOT NULL,
    sales_price  NUMERIC(12,2) NOT NULL CHECK (sales_price >= 0),
    cost_price   NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
    notes        TEXT,
    active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS plans (
    id              SERIAL PRIMARY KEY,
    product_id      INT NOT NULL REFERENCES products(id),
    name            VARCHAR(100) NOT NULL,
    price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    billing_period  VARCHAR(10) NOT NULL
                    CHECK (billing_period IN ('daily','weekly','monthly','yearly')),
    min_quantity    INT NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
    available_from  DATE,
    available_to    DATE,
    CHECK (available_to IS NULL OR available_to >= available_from)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                 BIGSERIAL PRIMARY KEY,
    customer_id        BIGINT NOT NULL REFERENCES customers(id),
    product_id         INT    NOT NULL REFERENCES products(id),
    plan_id            INT    NOT NULL REFERENCES plans(id),
    quantity           INT    NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    unit_price         NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    start_date         DATE NOT NULL,
    expiry_date        DATE,
    next_billing_date  DATE NOT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('DRAFT','ACTIVE','PAUSED','CLOSED')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expiry_date IS NULL OR expiry_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_billing
    ON subscriptions (status, next_billing_date);

CREATE TABLE IF NOT EXISTS invoices (
    id               BIGSERIAL PRIMARY KEY,
    subscription_id  BIGINT NOT NULL REFERENCES subscriptions(id),
    customer_id      BIGINT NOT NULL REFERENCES customers(id),
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date         DATE NOT NULL,
    is_paid          BOOLEAN NOT NULL DEFAULT FALSE,
    paid_on          DATE,
    UNIQUE (subscription_id, period_start),   -- one bill per period, no double billing
    CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_invoices_unpaid ON invoices (is_paid, due_date);
`;

const activeSubscriptions = `
SELECT c.email, p.name AS product, pl.name AS plan, s.next_billing_date
FROM subscriptions s
JOIN customers c ON c.id = s.customer_id
JOIN products  p ON p.id = s.product_id
JOIN plans    pl ON pl.id = s.plan_id
WHERE s.status = 'ACTIVE'
`;

async function addSampleData(client) {
  const { rows } = await client.query("SELECT COUNT(*) AS n FROM products");
  if (Number(rows[0].n) > 0) return;


  const customer = await client.query(
    "INSERT INTO customers (email, password_hash) VALUES ($1, $2) RETURNING id",
    ["ravi@example.com", "placeholder-hash"] 
  );

  const product = await client.query(
    `INSERT INTO products (name, type, sales_price, cost_price)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ["Cloud Storage", "service", 199.0, 80.0]
  );

  const plan = await client.query(
    `INSERT INTO plans (product_id, name, price, billing_period)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [product.rows[0].id, "Monthly Basic", 199.0, "monthly"]
  );

  await client.query(
    `INSERT INTO subscriptions
       (customer_id, product_id, plan_id, quantity, unit_price,
        start_date, next_billing_date)
     VALUES ($1, $2, $3, 1, $4, CURRENT_DATE, CURRENT_DATE + 30)`,
    [customer.rows[0].id, product.rows[0].id, plan.rows[0].id, 199.0]
  );
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(schema);        // create tables and indexes
    await addSampleData(client);       // add one customer/product/plan/subscription

    const result = await client.query(activeSubscriptions);
    console.table(result.rows);        // prints the rows as a table
  } finally {
    await client.end();                // always close the connection
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});