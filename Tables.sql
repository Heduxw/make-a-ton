CREATE TABLE customers (
    id             BIGSERIAL PRIMARY KEY,
    email          VARCHAR(255) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    has_paid       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE products (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    type         VARCHAR(50)  NOT NULL,
    sales_price  NUMERIC(12,2) NOT NULL CHECK (sales_price >= 0),
    cost_price   NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
    notes        TEXT,
    active       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE plans (
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
CREATE TABLE subscriptions (
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

CREATE INDEX idx_subscriptions_billing ON subscriptions (status, next_billing_date);

CREATE TABLE invoices (
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

CREATE INDEX idx_invoices_unpaid ON invoices (is_paid, due_date);
SELECT c.email, p.name AS product, pl.name AS plan, s.next_billing_date
FROM subscriptions s
JOIN customers c ON c.id = s.customer_id
JOIN products  p ON p.id = s.product_id
JOIN plans    pl ON pl.id = s.plan_id
WHERE s.status = 'ACTIVE';