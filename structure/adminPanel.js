/**
 * Admin web panel for LawinServer.
 *
 *   GET  /admin                 the panel (static HTML, no secrets in it)
 *   POST /admin/api/login       { key }   -> sets an HttpOnly session cookie
 *   ...  /admin/api/*           everything else requires that session
 *
 * Auth:  config.ini  [Config]  adminPanelKey=<long random secret>
 *        No key configured -> only loopback (127.0.0.1 / ::1) can use the panel, no login needed.
 *
 * Every action is turned into the matching adminConsole command and run through
 * adminConsole.handleLine(), so the panel and the server window always behave the same.
 */
const Express = require("express");
const router = Express.Router();
const fs = require("fs");
const path = require("path");
const util = require("util");
const crypto = require("crypto");
const iniparser = require("ini");
const config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());
const accountManager = require("./accountManager.js");
const adminConsole = require("./adminConsole.js");
// const quests = require("./questSystem.js"); // TODO: questSystem.js not found

const KEY = String((config.Config && config.Config.adminPanelKey) || "").trim();
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();   // token -> expiry
const attempts = new Map();   // ip -> { n, until }

function safeEqual(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function isLoopback(req) {
    const ip = String((req.socket && req.socket.remoteAddress) || "");
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
function isAuthed(req) {
    if (!KEY) return isLoopback(req);
    const t = req.cookies && req.cookies.admin_session;
    const exp = t && sessions.get(t);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(t); return false; }
    return true;
}

// ---------- page ----------
router.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "adminPanel.html")));

// ---------- auth ----------
router.post("/admin/api/login", (req, res) => {
    if (!KEY) return res.json({ ok: isLoopback(req), needsKey: false });
    const ip = String(req.socket.remoteAddress || "");
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return res.status(429).json({ ok: false, error: "too many attempts, wait a minute" });
    if (!safeEqual((req.body && req.body.key) || "", KEY)) {
        a.n++;
        if (a.n >= 5) { a.n = 0; a.until = Date.now() + 60000; }
        attempts.set(ip, a);
        return res.status(401).json({ ok: false, error: "wrong key" });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_MS);
    res.cookie("admin_session", token, { httpOnly: true, sameSite: "strict", secure: !!req.secure, maxAge: SESSION_MS });
    res.json({ ok: true });
});

router.post("/admin/api/logout", (req, res) => {
    if (req.cookies && req.cookies.admin_session) sessions.delete(req.cookies.admin_session);
    res.clearCookie("admin_session");
    res.json({ ok: true });
});

// everything below needs a session (+ custom header, which blocks cross-site form posts)
router.use("/admin/api", (req, res, next) => {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (req.method !== "GET" && req.headers["x-admin-panel"] !== "1") return res.status(403).json({ ok: false, error: "bad_request" });
    next();
});

router.get("/admin/api/me", (req, res) => res.json({ ok: true, needsKey: !!KEY }));

// ---------- helpers ----------
function runCommand(line) {
    const out = [];
    const orig = console.log;
    console.log = (...a) => {
        out.push(a.map((x) => (typeof x === "string" ? x : util.inspect(x))).join(" "));
        orig.apply(console, a);
    };
    try { adminConsole.handleLine(line); }
    catch (e) { out.push("Error: " + (e.message || e)); }
    finally { console.log = orig; }
    return out.join("\n");
}
const q = (s) => '"' + String(s == null ? "" : s).replace(/["\r\n]/g, "").trim() + '"';
const int = (n, d) => Math.max(1, parseInt(n, 10) || d || 1);

const ACTIONS = {
    gift: (b) => {
        const kind = String(b.kind || "item");
        const qty = int(b.qty);
        if (kind === "hero" || kind === "schematic" || kind === "resource") return `gift ${q(b.user)} ${kind} ${q(b.value)} ${qty}`;
        if (kind === "llama") return `gift ${q(b.user)} llama ${qty}`;
        return `gift ${q(b.user)} ${q(b.value)} ${qty}`;
    },
    points: (b) => `points ${q(b.user)} ${int(b.amount, 10)}`,
    xp: (b) => `xp ${q(b.user)} ${int(b.amount)}`,
    level: (b) => `level ${q(b.user)} ${int(b.amount)}`,
    stars: (b) => `stars ${q(b.user)} ${int(b.amount)}`,
    completequest: (b) => `completequest ${q(b.user)} ${q(b.questId)}`,
    resetquests: (b) => `resetquests ${q(b.user)}`,
    ban: (b) => `ban ${q(b.user)} ${q(b.reason || "Banned by admin")}`,
    unban: (b) => `unban ${q(b.user)}`,
    message: (b) => `message ${q(b.user || "all")} ${q(b.text)}`,
    notify: (b) => `notify ${q(b.user)} ${q(b.text)}`,
    setdiscord: (b) => `setdiscord ${q(b.user)} ${q(b.discordId)}`,
    cleardiscord: (b) => `cleardiscord ${q(b.user)}`,
    say: (b) => `say ${q(b.text)}`,
    questweek: (b) => `questweek ${int(b.amount)}`
};

// ---------- api ----------
router.get("/admin/api/accounts", (req, res) => {
    const data = accountManager.loadAccounts();
    const accounts = (data.accounts || []).map((a) => ({   // never send passwords
        accountId: a.accountId,
        displayName: a.displayName,
        email: a.email,
        discordId: a.discordId || null,
        created: a.created || null,
        hwids: Array.isArray(a.hwids) ? a.hwids.length : 0,
        banned: !!(a.banned || a.isBanned || (a.ban && a.ban.banned))
    }));
    const online = new Set((global.Clients || []).filter((c) => c && c.accountId && !c.isVirtualHost).map((c) => String(c.accountId).toLowerCase()));
    accounts.forEach((a) => { a.online = online.has(String(a.accountId).toLowerCase()); });
    res.json({ ok: true, accounts });
});

router.get("/admin/api/progress/:accountId", (req, res) => {
    try { 
        // TODO: questSystem.js not found
        res.json({ ok: false, error: "questSystem.js not available" }); 
        // res.json(quests.summary(req.params.accountId)); 
    }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/admin/api/action", (req, res) => {
    const b = req.body || {};
    const build = ACTIONS[b.action];
    if (!build) return res.status(400).json({ ok: false, error: "unknown action" });
    const line = build(b);
    console.log("[AdminPanel]", line);
    res.json({ ok: true, line, output: runCommand(line) });
});

router.post("/admin/api/cmd", (req, res) => {
    const line = String((req.body && req.body.line) || "").replace(/[\r\n]+/g, " ").trim();
    if (!line) return res.status(400).json({ ok: false, error: "empty command" });
    console.log("[AdminPanel] cmd:", line);
    res.json({ ok: true, line, output: runCommand(line) });
});

module.exports = router;
