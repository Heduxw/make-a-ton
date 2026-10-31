// Brightloop auth service, DATABASE version (same routes as index.js)
// Needs: npm install express bcrypt jsonwebtoken cors pg
// Run with: node index-postgres.js
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

// Hash the password, then save the user in the database
async function addUser(email, password, role) {
  const passwordHash = await bcrypt.hash(password, 10);
  return db.createUser(email, passwordHash, role);
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

app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email))
    return res.status(400).json({ error: "A valid email is required" });
  if (await db.findByEmail(email))
    return res.status(409).json({ error: "This email is already registered" });
  const problem = validatePassword(password);
  if (problem) return res.status(400).json({ error: problem });

  const user = await addUser(email, password, "customer");
  res.status(201).json(user);
});

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

app.get("/me", requireLogin, (req, res) => res.json(req.user));

app.post("/staff", requireLogin, requireRole("admin"), async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email))
    return res.status(400).json({ error: "A valid email is required" });
  if (await db.findByEmail(email))
    return res.status(409).json({ error: "This email is already registered" });
  const problem = validatePassword(password);
  if (problem) return res.status(400).json({ error: problem });

  const user = await addUser(email, password, "staff");
  res.status(201).json(user);
});

app.post("/forgot-password", async (req, res) => {
  const user = await db.findByEmail(req.body.email || "");
  if (user) {
    const token = crypto.randomBytes(20).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.saveResetToken(token, user.email, expiresAt);
    // For now the link is printed here; later send it by email
    console.log(`Reset link: http://localhost:3000/reset-password?token=${token}`);
  }
  res.json({ message: "If that email is registered, a reset link has been sent" });
});

app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  const entry = await db.getResetToken(token || "");
  if (!entry || new Date(entry.expiresAt) < new Date())
    return res.status(400).json({ error: "Reset link is invalid or expired" });
  const problem = validatePassword(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  await db.updatePassword(entry.email, await bcrypt.hash(newPassword, 10));
  await db.deleteResetToken(token); // the link works only once
  res.json({ message: "Password updated. You can log in now." });
});

// ---------- Start the server (create the admin only if missing) ----------
async function start() {
  if (!(await db.findByEmail("admin@brightloop.com"))) {
    await addUser("admin@brightloop.com", "Admin@12345", "admin");
  }
  app.listen(3000, () => console.log("Auth service running on port 3000"));
}

start().catch((err) => {
  console.error("Could not start (is the database running?):", err.message);
});
