// Brightloop auth service (hackathon version: users are kept in memory)
// Install first: npm install express bcrypt jsonwebtoken
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
app.use(cors());app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "change-me-before-real-use";

// ---------- Temporary storage (replace with the database later) ----------
const users = []; // { id, email, passwordHash, role }  role = admin | staff | customer
const resetTokens = {}; // token -> { email, expires }
let nextId = 1;

// ---------- Helper functions ----------
function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length <= 8)
    return "Password must be more than 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password needs an uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password needs a lowercase letter";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs a special character";
  return null; // null means the password is fine
}

function isValidEmail(email) {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

function findByEmail(email) {
  return users.find((u) => u.email === String(email).toLowerCase());
}

async function createUser(email, password, role) {
  const user = {
    id: nextId++,
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10), // never store the plain password
    role,
  };
  users.push(user);
  return user;
}

// ---------- Middleware (checks that run before a route) ----------
function requireLogin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET); // contains id, email, role
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

// 1. Sign up (always creates a customer)
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email))
    return res.status(400).json({ error: "A valid email is required" });
  if (findByEmail(email))
    return res.status(409).json({ error: "This email is already registered" });
  const problem = validatePassword(password);
  if (problem) return res.status(400).json({ error: problem });

  const user = await createUser(email, password, "customer");
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

// 2. Log in (returns a token, the "ID card")
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = findByEmail(email || "");
  const ok = user && (await bcrypt.compare(password || "", user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Wrong email or password" });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
  res.json({ token, role: user.role });
});

// 3. Who am I? (any logged-in user)
app.get("/me", requireLogin, (req, res) => res.json(req.user));

// 4. Only the admin can add staff
app.post("/staff", requireLogin, requireRole("admin"), async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email))
    return res.status(400).json({ error: "A valid email is required" });
  if (findByEmail(email))
    return res.status(409).json({ error: "This email is already registered" });
  const problem = validatePassword(password);
  if (problem) return res.status(400).json({ error: problem });

  const user = await createUser(email, password, "staff");
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

// 5. Forgot password (for now the reset link is printed in the terminal;
//    later, send it by email with nodemailer)
app.post("/forgot-password", (req, res) => {
  const user = findByEmail(req.body.email || "");
  if (user) {
    const token = crypto.randomBytes(20).toString("hex");
    resetTokens[token] = { email: user.email, expires: Date.now() + 15 * 60 * 1000 };
    console.log(`Reset link: http://localhost:3000/reset-password?token=${token}`);
  }
  // Same answer either way, so nobody can discover which emails exist
  res.json({ message: "If that email is registered, a reset link has been sent" });
});

// 6. Reset password using the token from the link
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  const entry = resetTokens[token];
  if (!entry || entry.expires < Date.now())
    return res.status(400).json({ error: "Reset link is invalid or expired" });
  const problem = validatePassword(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const user = findByEmail(entry.email);
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  delete resetTokens[token]; // the link can only be used once
  res.json({ message: "Password updated. You can log in now." });
});

// ---------- Start the server (with one starter admin) ----------
createUser("admin@brightloop.com", "Admin@12345", "admin").then(() => {
  app.listen(3000, () => console.log("Auth service running on port 3000"));
});
