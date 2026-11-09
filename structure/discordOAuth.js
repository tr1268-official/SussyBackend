/**
 * Discord OAuth login for the Frost launcher.
 *
 *   POST /lawin/discord-oauth   { code, redirectUri, hwid?, stickyHwid? }
 *     -> { ok, created, account: { accountId, displayName, email, password, discordId },
 *          discord: { id, username, avatar } }
 *     -> { ok:false, banned?, error }
 *
 * On create and every login:
 *   - Random 6-char password for new accounts (stored in Config/accounts.json)
 *   - HWID + stickyHwid registered on the account via accountManager.registerHwid
 *   - Rejects if account or HWID is already banned
 *
 * config.ini  [Config]
 *   discordClientId=...
 *   discordClientSecret=...
 */
const Express = require("express");
const router = Express.Router();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const iniparser = require("ini");
const accountManager = require("./accountManager.js");

const config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());
const CLIENT_ID = String((config.Config && config.Config.discordClientId) || "1542306639342735481").trim();
const CLIENT_SECRET = String((config.Config && config.Config.discordClientSecret) || "").trim();

const ALLOWED_REDIRECTS = [
    "http://localhost:3847/discord-callback",
    "http://127.0.0.1:3847/discord-callback"
];

/** Random 6-char alphanumeric password (safe for launch args). */
function randomPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = crypto.randomBytes(6);
    let out = "";
    for (let i = 0; i < 6; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

function cleanName(s) {
    let n = String(s || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 14);
    if (n.length < 3) n = "Player" + crypto.randomBytes(2).toString("hex");
    return n;
}

function avatarUrl(user) {
    if (!user.avatar) return null;
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
}

function ensureAccountPassword(account) {
    if (!account || !account.accountId) return account;
    const current = account.password != null ? String(account.password).trim() : "";
    const needsNew =
        !current ||
        current === "password" ||
        current.startsWith("discord:");

    if (!needsNew) return account;

    const data = accountManager.loadAccounts();
    const target = (data.accounts || []).find((a) => a.accountId === account.accountId);
    if (!target) return account;

    const pwd = randomPassword();
    target.password = pwd;
    const file = path.join(__dirname, "..", "Config", "accounts.json");
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    account.password = pwd;
    console.log("[DiscordOAuth] assigned password for", account.displayName);
    return account;
}

/**
 * Register HWID(s) on the account and reject if this machine or account is banned.
 * Uses accountManager.registerHwid / isBanned / attachHwidAndCheckBan when available.
 */
function registerHwidsOnAccount(account, hwid, stickyHwid) {
    if (!account || !account.accountId) {
        return { ok: false, error: "no_account" };
    }

    const ids = [];
    const norm = (h) =>
        typeof accountManager.normalizeHwid === "function"
            ? accountManager.normalizeHwid(h)
            : String(h || "").trim().replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 128);

    for (const raw of [hwid, stickyHwid]) {
        const n = norm(raw);
        if (n && !ids.includes(n)) ids.push(n);
    }

    // Pre-check: any of these HWIDs already banned on any account?
    for (const id of ids) {
        const hit = accountManager.isBanned({ hwid: id });
        if (hit && hit.banned) {
            return {
                ok: false,
                banned: true,
                reason: hit.reason || "Banned from our services",
                accountId: hit.accountId
            };
        }
    }

    // Account itself banned?
    if (account.banned) {
        return {
            ok: false,
            banned: true,
            reason: account.banReason || "Banned from our services",
            accountId: account.accountId
        };
    }

    // Prefer attachHwidAndCheckBan for primary hwid (registers + re-checks)
    if (typeof accountManager.attachHwidAndCheckBan === "function" && ids[0]) {
        const gate = accountManager.attachHwidAndCheckBan(account, ids[0]);
        if (!gate.ok) {
            return {
                ok: false,
                banned: true,
                reason: gate.reason || "Banned from our services",
                accountId: gate.accountId || account.accountId
            };
        }
        account = gate.account || account;
    }

    // Register all HWIDs (primary + sticky)
    for (const id of ids) {
        try {
            if (typeof accountManager.registerHwid === "function") {
                accountManager.registerHwid(account.accountId, id);
            }
        } catch (e) {
            console.log("[DiscordOAuth] registerHwid error:", e.message || e);
        }
    }

    // Reload so response reflects hwids array
    const fresh =
        accountManager.findAccount({ accountId: account.accountId }) || account;

    if (ids.length) {
        console.log(
            "[DiscordOAuth] HWID registered for",
            fresh.displayName,
            "->",
            (fresh.hwids || ids).join(", ")
        );
    }

    return { ok: true, account: fresh };
}

router.post("/lawin/discord-oauth", async (req, res) => {
    try {
        const body = req.body || {};
        const { code, redirectUri } = body;
        const hwid = body.hwid || null;
        const stickyHwid = body.stickyHwid || null;

        if (!code) return res.status(400).json({ ok: false, error: "code required" });
        if (!CLIENT_SECRET) {
            console.log("[DiscordOAuth] discordClientSecret missing in Config/config.ini [Config]");
            return res.status(500).json({ ok: false, error: "Discord login is not configured on the server" });
        }
        const redirect = ALLOWED_REDIRECTS.includes(redirectUri) ? redirectUri : ALLOWED_REDIRECTS[0];

        // 1) code -> access token
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: "authorization_code",
                code: String(code),
                redirect_uri: redirect
            }).toString()
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.access_token) {
            console.log("[DiscordOAuth] token exchange failed:", tokenRes.status, JSON.stringify(tokenData));
            return res.status(401).json({
                ok: false,
                error: "Discord rejected the login (" + (tokenData.error_description || tokenData.error || tokenRes.status) + ")"
            });
        }

        // 2) access token -> Discord user
        const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: "Bearer " + tokenData.access_token }
        });
        const user = await userRes.json().catch(() => ({}));
        if (!userRes.ok || !user.id) {
            console.log("[DiscordOAuth] user fetch failed:", userRes.status, JSON.stringify(user));
            return res.status(401).json({ ok: false, error: "Could not read your Discord profile" });
        }

        // Early HWID ban gate (before create) so banned boxes cannot open new accounts
        if (hwid || stickyHwid) {
            for (const raw of [hwid, stickyHwid]) {
                if (!raw) continue;
                const pre = accountManager.isBanned({ hwid: raw });
                if (pre && pre.banned) {
                    return res.status(403).json({
                        ok: false,
                        banned: true,
                        error: pre.reason || "Banned from our services"
                    });
                }
            }
        }

        // 3) find (or create) the linked account
        let account = accountManager.findAccount({ discordId: user.id });
        let created = false;

        if (!account) {
            const base = cleanName(user.global_name || user.username);
            const password = randomPassword();
            for (let i = 0; i < 25 && !account; i++) {
                const name = i === 0 ? base : base.slice(0, 12) + i;
                const email = name + "@Frost.dev";
                const r = accountManager.createAccount(email, name, password, user.id);
                if (r.account) {
                    account = r.account;
                    created = true;
                    console.log(
                        "[DiscordOAuth] created account",
                        account.displayName,
                        "password set (6 chars), discord",
                        user.id
                    );
                } else if (r.error && /Discord ID already linked/i.test(r.error)) {
                    account = accountManager.findAccount({ discordId: user.id });
                    break;
                } else if (r.error && /already exists/i.test(r.error)) {
                    continue;
                } else if (r.error) {
                    console.log("[DiscordOAuth] createAccount error:", r.error);
                }
            }
            if (!account) return res.status(500).json({ ok: false, error: "Could not create an account" });
        } else {
            account = ensureAccountPassword(account);
        }

        if (account.banned) {
            return res.status(403).json({
                ok: false,
                banned: true,
                error: account.banReason || "Banned from our services"
            });
        }

        // 4) Register HWID on this account (create + every subsequent Discord login)
        const hwidResult = registerHwidsOnAccount(account, hwid, stickyHwid);
        if (!hwidResult.ok) {
            return res.status(403).json({
                ok: false,
                banned: true,
                error: hwidResult.reason || "Banned from our services"
            });
        }
        account = hwidResult.account;

        const fresh =
            accountManager.findAccount({ accountId: account.accountId }) ||
            accountManager.findAccount({ discordId: user.id }) ||
            account;

        console.log(
            "[DiscordOAuth] login ok:",
            fresh.displayName,
            "discord",
            user.id,
            "created=",
            created,
            "hwids=",
            (fresh.hwids || []).length
        );

        res.json({
            ok: true,
            created,
            account: {
                accountId: fresh.accountId,
                displayName: fresh.displayName,
                email: fresh.email,
                password: String(fresh.password || ""),
                discordId: user.id,
                hwids: Array.isArray(fresh.hwids) ? fresh.hwids.length : 0
            },
            discord: { id: user.id, username: user.username, avatar: avatarUrl(user) }
        });
    } catch (e) {
        console.log("[DiscordOAuth] error:", e && e.stack || e);
        res.status(500).json({ ok: false, error: "Server error during Discord login" });
    }
});

module.exports = router;
