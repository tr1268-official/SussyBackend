/**
 * Ban check for the Frost / AFort launcher.
 *
 *   POST /lawin/check-ban
 *     body: { hwid?, stickyHwid?, username?, email?, stickyDeleted? }
 *     -> { banned: false, messages?: [] }
 *     -> { banned: true, reason, accountId?, displayName?, messages?: [] }
 *
 * Matches account by username / email / displayName, or by HWID / stickyHwid.
 * Also treats stickyDeleted (client saw marker removed) as ban evasion when
 * an account can be resolved.
 *
 * Mount the same way as discordOAuth.js, e.g.:
 *   app.use(require("./routes/checkBan.js"));
 * or merge into your existing /lawin router.
 */
const Express = require("express");
const router = Express.Router();
const accountManager = require("./accountManager.js");

function normHwid(h) {
  if (typeof accountManager.normalizeHwid === "function") {
    return accountManager.normalizeHwid(h);
  }
  return String(h || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, "")
    .slice(0, 128);
}

function findByIdentity({ username, email }) {
  if (!accountManager || typeof accountManager.findAccount !== "function") {
    return null;
  }
  const tries = [];
  if (username) {
    tries.push({ displayName: username });
    tries.push({ username });
    tries.push({ accountId: username });
  }
  if (email) {
    tries.push({ email });
    // username part of email (tr1268@frost.dev → tr1268)
    const local = String(email).split("@")[0];
    if (local) {
      tries.push({ displayName: local });
      tries.push({ username: local });
    }
  }
  for (const q of tries) {
    try {
      const a = accountManager.findAccount(q);
      if (a) return a;
    } catch (_) {}
  }
  // Fallback: scan accounts.json-style list if available
  try {
    if (typeof accountManager.loadAccounts === "function") {
      const data = accountManager.loadAccounts();
      const list = data.accounts || data || [];
      const u = String(username || "").toLowerCase();
      const e = String(email || "").toLowerCase();
      const local = e.split("@")[0];
      for (const a of list) {
        if (!a) continue;
        const dn = String(a.displayName || a.username || "").toLowerCase();
        const em = String(a.email || "").toLowerCase();
        const id = String(a.accountId || "").toLowerCase();
        if (
          (u && (dn === u || id === u)) ||
          (e && em === e) ||
          (local && (dn === local || id === local))
        ) {
          return a;
        }
      }
    }
  } catch (_) {}
  return null;
}

function banHitFromHwid(raw) {
  const id = normHwid(raw);
  if (!id) return null;
  try {
    if (typeof accountManager.isBanned === "function") {
      const hit = accountManager.isBanned({ hwid: id });
      if (hit && hit.banned) return hit;
    }
  } catch (e) {
    console.log("[check-ban] isBanned error:", e.message || e);
  }
  return null;
}

router.post("/lawin/check-ban", (req, res) => {
  try {
    const body = req.body || {};
    const hwid = body.hwid || null;
    const stickyHwid = body.stickyHwid || null;
    const username = body.username || null;
    const email = body.email || null;
    const stickyDeleted = !!body.stickyDeleted;

    // 1) HWID / stickyHwid already banned on any account
    for (const raw of [hwid, stickyHwid]) {
      if (!raw) continue;
      const hit = banHitFromHwid(raw);
      if (hit) {
        console.log(
          "[check-ban] HWID ban hit",
          normHwid(raw),
          "accountId=",
          hit.accountId,
          "reason=",
          hit.reason
        );
        return res.json({
          banned: true,
          reason: hit.reason || "Banned from our services",
          accountId: hit.accountId || null,
          displayName: hit.displayName || null,
          messages: Array.isArray(hit.messages) ? hit.messages : [],
        });
      }
    }

    // 2) Resolve account by username / email
    const account = findByIdentity({ username, email });

    if (account && account.banned) {
      console.log(
        "[check-ban] account ban hit",
        account.displayName || account.accountId,
        "reason=",
        account.banReason
      );
      return res.json({
        banned: true,
        reason: account.banReason || account.reason || "Banned from our services",
        accountId: account.accountId || null,
        displayName: account.displayName || account.username || null,
        messages: Array.isArray(account.messages) ? account.messages : [],
      });
    }

    // 3) Client reports sticky marker deleted while logged in → ban evasion
    if (stickyDeleted && account) {
      console.log(
        "[check-ban] stickyDeleted ban evasion",
        account.displayName || account.accountId
      );
      return res.json({
        banned: true,
        reason: "Ban evasion detected (security marker removed)",
        accountId: account.accountId || null,
        displayName: account.displayName || account.username || null,
        messages: [],
      });
    }

    // 4) Optional admin messages on the account (non-ban)
    const messages =
      account && Array.isArray(account.messages) ? account.messages : [];

    return res.json({
      banned: false,
      accountId: account ? account.accountId || null : null,
      displayName: account ? account.displayName || account.username || null : null,
      messages,
    });
  } catch (e) {
    console.log("[check-ban] error:", e && e.stack ? e.stack : e);
    return res.status(500).json({
      banned: false,
      error: "Server error during ban check",
    });
  }
});

module.exports = router;
