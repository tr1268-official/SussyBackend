const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const iniparser = require("ini");
const config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());
const accountManager = require("./accountManager.js");   // <-- required

var Memory_CurrentAccountID = config.Config.displayName;

function accountJson(account) {
    return {
        "id": account.accountId,
        "displayName": account.displayName,
        "name": account.displayName,
        "email": account.email || (account.displayName + "@lawin.local"),
        "failedLoginAttempts": 0,
        "lastLogin": new Date().toISOString(),
        "numberOfDisplayNameChanges": 0,
        "ageGroup": "UNKNOWN",
        "headless": false,
        "country": "US",
        "lastName": "Server",
        "preferredLanguage": "en",
        "canUpdateDisplayName": false,
        "tfaEnabled": false,
        "emailVerified": true,
        "minorVerified": false,
        "minorExpected": false,
        "minorStatus": "NOT_MINOR",
        "cabinedMode": false,
        "hasHashedEmail": false,
        "externalAuths": {}
    };
}

function resolveAccountByName(name) {
    name = String(name || "").trim();
    if (!name) return null;

    let account = accountManager.findAccount({ username: name });
    if (!account) account = accountManager.findAccount({ accountId: name });
    if (!account) account = accountManager.findAccount({ email: name });

    // partial / case-insensitive scan
    if (!account) {
        const data = accountManager.loadAccounts();
        const lower = name.toLowerCase();
        account = data.accounts.find(a =>
            (a.displayName && a.displayName.toLowerCase() === lower) ||
            (a.accountId && a.accountId.toLowerCase() === lower) ||
            (a.email && a.email.toLowerCase() === lower)
        ) || null;
    }
    return account;
}

// Debug: list accounts (open in browser)
express.get("/lawin/accounts", async (req, res) => {
    const data = accountManager.loadAccounts();
    res.json(data.accounts.map(a => ({
        accountId: a.accountId,
        displayName: a.displayName,
        email: a.email
    })));
});

// Create account: POST /lawin/create-account  { "email", "username", "password" }
express.post("/lawin/create-account", async (req, res) => {
    const email = (req.body && req.body.email) || "";
    const username = (req.body && (req.body.username || req.body.displayName)) || "";
    const password = (req.body && req.body.password) || "password";

    if (!username && !email) {
        return res.status(400).json({ error: "username or email required" });
    }

    const result = await accountManager.createAccount(
        email || (username + "@lawin.local"),
        username || email.split("@")[0],
        password
    );

    if (result.error) return res.status(409).json(result);

    res.json({
        ok: true,
        account: {
            accountId: result.account.accountId,
            displayName: result.account.displayName,
            email: result.account.email
        }
    });
});

express.get("/account/api/public/account", async (req, res) => {
    var response = [];

    async function pushId(accountId) {
        if (accountId.includes("@")) accountId = accountId.split("@")[0];
        var account = await accountManager.findAccount({ accountId: accountId });
        if (!account) account = await accountManager.findAccount({ username: accountId });

        if (account) {
            response.push({
                "id": account.accountId,
                "displayName": account.displayName,
                "externalAuths": {}
            });
        } else {
            response.push({
                "id": accountId,
                "displayName": accountId,
                "externalAuths": {}
            });
        }
    }

    if (typeof req.query.accountId == "string") {
        await pushId(req.query.accountId);
    }
    if (Array.isArray(req.query.accountId)) {
        for (var x in req.query.accountId) {
            await pushId(req.query.accountId[x]);
        }
    }
    res.json(response);
});

// Lookup by email
express.get("/account/api/public/account/email/:email", async (req, res) => {
    const account = await accountManager.findAccount({ email: req.params.email });
    if (!account) {
        return res.status(404).json({
            "errorCode": "errors.com.epicgames.account.account_not_found",
            "errorMessage": "Sorry, we couldn't find an account for " + req.params.email,
            "numericErrorCode": 18007,
            "originatingService": "com.epicgames.account.public",
            "intent": "prod"
        });
    }
    res.json({
        "id": account.accountId,
        "displayName": account.displayName,
        "externalAuths": {}
    });
});

// Lookup by display name (required for Add Friend)
express.get("/account/api/public/account/displayName/:displayName", async (req, res) => {
    const name = decodeURIComponent(String(req.params.displayName || "").trim());
    console.log("[Accounts] displayName lookup:", name);

    const account = resolveAccountByName(name);
    if (!account) {
        console.log("[Accounts] NOT FOUND:", name, "known:", accountManager.loadAccounts().accounts.map(a => a.displayName));
        return res.status(404).json({
            "errorCode": "errors.com.epicgames.account.account_not_found",
            "errorMessage": "Sorry, we couldn't find an account for " + name,
            "messageVars": [name],
            "numericErrorCode": 18007,
            "originatingService": "com.epicgames.account.public",
            "intent": "prod"
        });
    }

    console.log("[Accounts] FOUND:", account.displayName, "->", account.accountId);
    res.json({
        "id": account.accountId,
        "displayName": account.displayName,
        "externalAuths": {}
    });
});

// Case-insensitive path used by some clients
express.get("/account/api/public/account/displayName/*", async (req, res) => {
    const name = decodeURIComponent((req.params[0] || "").replace(/\/$/, ""));
    console.log("[Accounts] displayName* lookup:", name);

    const account = resolveAccountByName(name);
    if (!account) {
        return res.status(404).json({
            "errorCode": "errors.com.epicgames.account.account_not_found",
            "errorMessage": "Sorry, we couldn't find an account for " + name,
            "messageVars": [name],
            "numericErrorCode": 18007,
            "originatingService": "com.epicgames.account.public",
            "intent": "prod"
        });
    }
    res.json({
        id: account.accountId,
        displayName: account.displayName,
        externalAuths: {}
    });
});

express.get("/account/api/public/account/:accountId", async (req, res) => {
    var account = await accountManager.findAccount({ accountId: req.params.accountId });

    if (!account) {
        var id = accountManager.sanitizeAccountId(req.params.accountId);
        account = {
            accountId: id,
            displayName: id,
            email: id + "@lawin.local"
        };
        await accountManager.ensureAccountProfiles(id);
    }

    Memory_CurrentAccountID = account.displayName;

    res.json({
        "id": account.accountId,
        "displayName": account.displayName,
        "name": account.displayName,
        "email": account.email || (account.displayName + "@lawin.local"),
        "failedLoginAttempts": 0,
        "lastLogin": new Date().toISOString(),
        "numberOfDisplayNameChanges": 0,
        "ageGroup": "UNKNOWN",
        "headless": false,
        "country": "US",
        "lastName": "Server",
        "preferredLanguage": "en",
        "canUpdateDisplayName": false,
        "tfaEnabled": false,
        "emailVerified": true,
        "minorVerified": false,
        "minorExpected": false,
        "minorStatus": "NOT_MINOR",
        "cabinedMode": false,
        "hasHashedEmail": false
    });
});

express.get("/account/api/public/account/:accountId/externalAuths", async (req, res) => {
    res.json([]);
});

express.get("/sdk/v1/*", async (req, res) => {
    const sdk = require("./../responses/sdkv1.json");
    res.json(sdk);
});

express.post("/auth/v1/oauth/token", async (req, res) => {
    res.json({
        "access_token": "lawinstokenlol",
        "token_type": "bearer",
        "expires_in": 28800,
        "expires_at": "9999-12-31T23:59:59.999Z",
        "nonce": "lawinserver",
        "features": ["AntiCheat", "CommerceService", "Connect", "ContentService", "Ecom", "EpicConnect", "Inventories", "LockerService", "MagpieService", "Matchmaking Service", "PCBService", "QuestService", "Stats"],
        "deployment_id": "lawinsdeploymentidlol",
        "organization_id": "lawinsorganizationidlol",
        "organization_user_id": "lawinsorganisationuseridlol",
        "product_id": "prod-fn",
        "product_user_id": "lawinsproductuseridlol",
        "product_user_id_created": false,
        "id_token": "lawinsidtokenlol",
        "sandbox_id": "fn"
    });
});

express.get("/epic/id/v2/sdk/accounts", async (req, res) => {
    res.json([{
        "accountId": Memory_CurrentAccountID,
        "displayName": Memory_CurrentAccountID,
        "preferredLanguage": "en",
        "cabinedMode": false,
        "empty": false
    }]);
});

express.post("/epic/oauth/v2/token", async (req, res) => {
    res.json({
        "scope": "basic_profile friends_list openid presence",
        "token_type": "bearer",
        "access_token": "lawinstokenlol",
        "expires_in": 28800,
        "expires_at": "9999-12-31T23:59:59.999Z",
        "refresh_token": "lawinstokenlol",
        "refresh_expires_in": 86400,
        "refresh_expires_at": "9999-12-31T23:59:59.999Z",
        "account_id": Memory_CurrentAccountID,
        "client_id": "lawinsclientidlol",
        "application_id": "lawinsapplicationidlol",
        "selected_account_id": Memory_CurrentAccountID,
        "id_token": "lawinstokenlol"
    });
});

express.get("/account/api/public/account/*/externalAuths", async (req, res) => {
    res.json([]);
});

express.delete("/account/api/oauth/sessions/kill", async (req, res) => {
    res.status(204);
    res.end();
});

express.delete("/account/api/oauth/sessions/kill/*", async (req, res) => {
    res.status(204);
    res.end();
});

express.get("/account/api/oauth/verify", async (req, res) => {
    var account = await accountManager.accountFromToken(req.headers["authorization"] || "");
    if (!account) {
        account = { accountId: Memory_CurrentAccountID, displayName: Memory_CurrentAccountID };
    }
    Memory_CurrentAccountID = account.displayName || account.accountId;

    res.json({
        "token": String(req.headers["authorization"] || "lawinstokenlol").replace(/^bearer\s+/i, ""),
        "session_id": "lawinsessionidlol",
        "token_type": "bearer",
        "client_id": "lawinsclientidlol",
        "internal_client": true,
        "client_service": "fortnite",
        "account_id": account.accountId,
        "expires_in": 28800,
        "expires_at": "9999-12-31T23:59:59.999Z",
        "auth_method": "exchange_code",
        "display_name": account.displayName || account.accountId,
        "app": "fortnite",
        "in_app_id": account.accountId
    });
});

express.post("/account/api/oauth/token", async (req, res) => {
    // The client hits this endpoint with SEVERAL grant types, and only ONE of them
    // (password) actually carries a username/password. The old code assumed every
    // request was a password login, defaulted the username to "LawinServer" with an
    // empty password, and therefore 401'd on all the others:
    //   - client_credentials -> requested BEFORE anyone logs in. A 401 here kills the
    //     -AUTH_LOGIN/-AUTH_PASSWORD auto-login, which is why the game fell back to
    //     the in-game email/password screen even when the launcher passed the args.
    //   - refresh_token / exchange_code -> requested DURING the session. A 401 here is
    //     exactly what produces "Logout Occured - unexpectedly disconnected".
    const grant = String(req.body.grant_type || "password").toLowerCase();
    const cfgName = config.Config.displayName || "LawinServer";
    const useCfgName = String(config.Config.bUseConfigDisplayName).toLowerCase() === "true";

    function lastKnownAccount() {
        return accountManager.findAccount({ username: Memory_CurrentAccountID })
            || accountManager.findAccount({ accountId: Memory_CurrentAccountID })
            || accountManager.findAccount({ username: cfgName })
            || null;
    }

    if (grant == "client_credentials") {
        // Real Epic returns an account-less client token here. No credentials involved.
        console.log("[Auth] client_credentials -> issuing client token");
        return res.json({
            "access_token": "lawinclientcredentialstoken",
            "expires_in": 28800,
            "expires_at": "9999-12-31T23:59:59.999Z",
            "token_type": "bearer",
            "client_id": "lawinsclientidlol",
            "internal_client": true,
            "client_service": "fortnite"
        });
    }

    var account = null;

    if (grant == "password") {
        var username = req.body.username || req.body.email || "";
        var password = req.body.password || "";
        if (useCfgName) username = cfgName;
        account = await accountManager.validateLogin(username, password);
        console.log("[Auth] password grant for", username, "->", account ? "OK" : "REJECTED");
    } else {
        // refresh_token, exchange_code, authorization_code, device_auth, external_auth...
        // Resolve the identity from the token/code the client sent, then the auth
        // header, then whoever logged in last on this server.
        const carried = req.body.refresh_token || req.body.exchange_code
            || req.body.code || req.body.token || "";
        account = accountManager.accountFromToken(carried)
            || accountManager.accountFromToken(req.headers["authorization"] || "")
            || (req.body.account_id ? accountManager.findAccount({ accountId: req.body.account_id }) : null)
            || lastKnownAccount();
        if (account && account.banned) account = null;   // bans still apply on refresh
        console.log("[Auth] grant=" + grant + " -> " + (account ? account.displayName : "UNRESOLVED"));
    }

    if (!account) {
        return res.status(401).json({
            "errorCode": "errors.com.epicgames.account.invalid_account_credentials",
            "errorMessage": "Invalid account credentials",
            "numericErrorCode": 18031,
            "originatingService": "com.epicgames.account.public",
            "intent": "prod"
        });
    }

    Memory_CurrentAccountID = account.displayName;
    await accountManager.ensureAccountProfiles(account.accountId);

    // Mark online for early clients that never open a real XMPP socket.
    // Launcher will also keep calling POST /lawin/presence as a heartbeat.
    try {
        const vp = require("./virtualpresence.js");
        if (vp && typeof vp.markOnline === "function") {
            vp.markOnline(account.accountId, account.displayName);
        }
    } catch (e) {}

    var access = accountManager.tokenFor(account);

    res.json({
        "access_token": access,
        "expires_in": 28800,
        "expires_at": "9999-12-31T23:59:59.999Z",
        "token_type": "bearer",
        "refresh_token": access,
        "refresh_expires": 28800,
        "refresh_expires_at": "9999-12-31T23:59:59.999Z",
        "account_id": account.accountId,
        "client_id": "lawinsclientidlol",
        "internal_client": true,
        "client_service": "fortnite",
        "displayName": account.displayName,
        "app": "fortnite",
        "in_app_id": account.accountId,
        "device_id": "lawinsdeviceidlol"
    });
});

// An empty {} here gives the client nothing to exchange, so any launcher using
// -AUTH_TYPE=exchangecode had no working path in. Hand out a real code tied to the
// caller's token; /oauth/token above accepts it back as an exchange_code.
async function handleExchange(req, res) {
    const account = accountManager.accountFromToken(req.headers["authorization"] || "")
        || accountManager.findAccount({ username: Memory_CurrentAccountID })
        || accountManager.findAccount({ accountId: Memory_CurrentAccountID });

    if (!account) {
        return res.status(401).json({
            "errorCode": "errors.com.epicgames.account.auth_token.invalid_bearer_token",
            "errorMessage": "Invalid bearer token",
            "numericErrorCode": 1023,
            "originatingService": "com.epicgames.account.public",
            "intent": "prod"
        });
    }

    res.json({
        "expiresInSeconds": 300,
        "code": accountManager.tokenFor(account),
        "creatingClientId": "lawinsclientidlol"
    });
}

express.post("/account/api/oauth/exchange", handleExchange);
express.get("/account/api/oauth/exchange", handleExchange);

express.get("/account/api/epicdomains/ssodomains", async (req, res) => {
    res.json([
        "unrealengine.com",
        "unrealtournament.com",
        "fortnite.com",
        "epicgames.com"
    ]);
});

express.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/*", async (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(true);
});

module.exports = express;