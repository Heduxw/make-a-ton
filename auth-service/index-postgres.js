// Brightloop auth service, DATABASE version (same routes as index.js)
// Works with the team's Tables.sql (customers + staff_users).
// Needs: npm install express bcrypt jsonwebtoken cors pg
// Run with: node index-postgres.js
// Roles: admin, sales (staff_users) and customer (customers)
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cors = require("cors");
const db = require("./db"); // the database helpers

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "change-me-before-real-use";

// Reset tokens are kept in memory for now (the database has no table for them)
const resetTokens = {}; // token -> { email, expires }

// ---------- Helper functions ----------
function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length <= 8)
    return "Password must be more than 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password needs an uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password needs a lowercase letter";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs a special character";
  return null;
}

function isValidEmail(email) {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

// ---------- Middleware ----------
function requireLogin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "Please log in first" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You are not allowed to do this" });
    }
    next();
  };
}

// ---------- Routes ----------
app.get("/", (req, res) => res.send("Auth service is running!"));

// Sign up (always creates a customer)
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email))
    return res.status(400).json({ error: "A valid email is required" });
  if (await db.findByEmail(email))
    return res.status(409).json({ error: "This email is already registered" });
  const problem = validatePassword(password);
  if (problem) return res.status(400).json({ error: problem });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.createCustomer(email, passwordHash);
  res.status(201).json(user);
});

// Log in (works for customers and staff)
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.findByEmail(email || "");
  const ok = user && (await bcrypt.compare(password || "", user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Wrong email or password" });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  res.json({ token, role: user.role });
});

// Who am I?
app.get("/me", requireLogin, (req, res) => res.json(req.user));

// Only the admin can add staff (they get the role "sales")
app.post("/staff", requireLogin, requireRole("admin"), async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email))
    return res.status(400).json({ error: "A valid email is required" });
  if (await db.findByEmail(email))
    return res.status(409).json({ error: "This email is already registered" });
  const problem = validatePassword(password);
  if (problem) return res.status(400).json({ error: problem });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.createStaff(email, passwordHash, "sales");
  res.status(201).json(user);
});

// Forgot password (the link is printed here for now; later send it by email)
app.post("/forgot-password", async (req, res) => {
  const user = await db.findByEmail(req.body.email || "");
  if (user) {
    const token = crypto.randomBytes(20).toString("hex");
    resetTokens[token] = { email: user.email, expires: Date.now() + 15 * 60 * 1000 };
    console.log(`Reset link: http://localhost:3000/reset-password?token=${token}`);
  }
  res.json({ message: "If that email is registered, a reset link has been sent" });
});

// Reset password using the token from the link
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  const entry = resetTokens[token];
  if (!entry || entry.expires < Date.now())
    return res.status(400).json({ error: "Reset link is invalid or expired" });
  const problem = validatePassword(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const user = await db.findByEmail(entry.email);
  await db.updatePassword(user, await bcrypt.hash(newPassword, 10));
  delete resetTokens[token]; // the link works only once
  res.json({ message: "Password updated. You can log in now." });
});

// ---------- Start the server (create the admin only if missing) ----------
async function start() {
  if (!(await db.findByEmail("admin@brightloop.com"))) {
    const hash = await bcrypt.hash("Admin@12345", 10);
    await db.createStaff("admin@brightloop.com", hash, "admin");
  }
  app.listen(3000, () => console.log("Auth service running on port 3000"));
}

start().catch((err) => {
  console.error("Could not start (is the database running?):", err.message);
});
