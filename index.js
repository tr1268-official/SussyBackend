const Express = require("express");
const express = Express();
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const accountManager = require("./structure/accountManager.js");   // adjust path if needed
const kv = require("./structure/kv.js");
const https = require("https");
const WebSocket = require('ws');

express.use(Express.json());
express.use(Express.urlencoded({ extended: true }));
express.use(Express.static('public'));
express.use(cookieParser());
express.use((req, res, next) => { console.log("[REQ]", req.method, req.headers.host, req.originalUrl); next(); });

express.use(require("./structure/ot65.js")); // OT6.5 common/ + MCP (before STW routes)
express.use(require("./structure/party.js"));
express.use(require("./structure/discovery.js"));
express.use(require("./structure/privacy.js"));
express.use(require("./structure/timeline.js"));
express.use(require("./structure/user.js"));
express.use(require("./structure/contentpages.js"));
express.use(require("./structure/friends.js"));
express.use(require("./structure/main.js"));
express.use(require("./structure/storefront.js"));
express.use(require("./structure/version.js"));
express.use(require("./structure/lightswitch.js"));
express.use(require("./structure/affiliate.js"));
express.use(require("./structure/matchmaking.js"));
express.use(require("./structure/cloudstorage.js"));
express.use(require("./structure/mcp.js"));
express.use("/api", require("./structure/gameserver.js"));
express.use(require("./structure/adminPanel.js"));
express.use(require("./structure/discordOAuth.js"));
express.use(require("./structure/checkBan.js"));
express.use(require("./structure/vbucks.js"));
const giftRoutes = require("./structure/giftRoutes.js");
express.use("/", giftRoutes);

//express.use(require("./TCP_XMPP.js").start());

const port = process.env.PORT || 3551;
express.listen(port, () => {
    console.log("LawinServer started listening on port", port);
    //require("./structure/TCP_XMPP.js").start()
    try {
        // WebSocket XMPP + Matchmaker (old builds connect their matchmaker to ws://<ip>[:wsPort]/)
        require("./structure/xmpp.js");
        console.log("XMPP WebSocket + Matchmaker listening on port", process.env.XMPP_PORT || 80);
    } catch (e) {
        console.log("XMPP WebSocket/Matchmaker not started:", e.message);
    }
    try {
        require("./structure/adminConsole.js").start();
    } catch (e) {
        console.log("Admin console not started:", e.message);
    }
}).on("error", (err) => {
    if (err.code == "EADDRINUSE") console.log("\x1b[31mERROR\x1b[0m: Port " + port + " is already in use!");
    else throw err;
    process.exit(0);
});



const tokens = JSON.parse(fs.readFileSync("./tokenManager/tokens.json").toString());

for (let tokenType in tokens) {
    for (let tokenIndex in tokens[tokenType]) {
        let decodedToken = jwt.decode(tokens[tokenType][tokenIndex].token.replace("eg1~", ""));

        if (DateAddHours(new Date(decodedToken.creation_date), decodedToken.hours_expire).getTime() <= new Date().getTime()) {
            tokens[tokenType].splice(Number(tokenIndex), 1);
        }
    }
}

fs.writeFileSync("./tokenManager/tokens.json", JSON.stringify(tokens, null, 2));

global.accessTokens = tokens.accessTokens;
global.refreshTokens = tokens.refreshTokens;
global.clientTokens = tokens.clientTokens;
global.kv = kv;

// ---------- DOWNLOAD FILE HANDLER ----------

const DOWNLOADS_DIR = path.join(__dirname, "bin");

// Make sure the downloads folder exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

express.get("/bin/:fileName", async (req, res) => {
    try {
        const fileName = req.params.fileName;

        // Prevent path traversal
        if (
            !fileName ||
            fileName.includes("..") ||
            fileName.includes("/") ||
            fileName.includes("\\")
        ) {
            return res.status(400).json({
                ok: false,
                error: "Invalid file name"
            });
        }

        const filePath = path.join(DOWNLOADS_DIR, fileName);

        // Check if file exists
        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
        } catch {
            return res.status(404).json({
                ok: false,
                error: "File not found"
            });
        }

        // Make sure it is actually a file
        const stat = await fs.promises.stat(filePath);

        if (!stat.isFile()) {
            return res.status(400).json({
                ok: false,
                error: "Requested path is not a file"
            });
        }

        // Force download
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        res.setHeader("Content-Length", stat.size);

        // Send file
        return res.sendFile(filePath);

    } catch (error) {
        console.error("[DOWNLOAD ERROR]", error);

        if (!res.headersSent) {
            return res.status(500).json({
                ok: false,
                error: error.message || "Failed to download file"
            });
        }
    }
});

// Put this helper somewhere (or inside the route)
async function sendDiscordWebhook(content, embeds = null) {
    const webhook = "https://discord.com/api/webhooks/1551217591970697218/2B-s2PpSdak_-mTM5nB2ky0q2ER2-DnT4D0DsbTUuivG-qwZidcprYZtSh6Z55JKqFtl";
    try {
        await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, embeds })
        });
    } catch (e) {
        console.error("[Discord] webhook error:", e.message);
    }
}

express.post("/lawin/report-cheat", async (req, res) => {
    try {
        const { hwid, reason, displayName } = req.body || {};
        if (!hwid) return res.status(400).json({ error: "hwid required" });

        console.log("[AC] report", hwid, reason, displayName);

        const normalized = accountManager.normalizeHwid(hwid);
        const data = accountManager.loadAccounts();

        let hit = (data.accounts || []).find(a =>
            Array.isArray(a.hwids) && a.hwids.includes(normalized)
        );

        if (!hit && displayName) {
            hit = accountManager.findAccount({ username: displayName }) ||
                  accountManager.findAccount({ accountId: displayName });
        }

        let mention = "";
        if (hit && hit.discordId) {
            mention = `<@${hit.discordId}> `;
        }

        // Ban
        if (hit) {
            accountManager.banAccount(hit.accountId, reason || "Anti-cheat detection", normalized);
            console.log("[AC] BANNED", hit.displayName);
        }

        // Rich Discord message from backend (can tag the user)
        await sendDiscordWebhook(null, [{
            title: "FrostAC Detection + Ban",
            color: 16711680,
            fields: [
                { name: "Player", value: hit ? hit.displayName : (displayName || "Unknown"), inline: true },
                { name: "Discord", value: hit && hit.discordId ? `<@${hit.discordId}>` : "Not linked", inline: true },
                { name: "HWID", value: `\`${normalized}\``, inline: false },
                { name: "Reason", value: reason || "suspicious", inline: false }
            ],
            footer: { text: "Frost Anti-Cheat" }
        }]);

        res.json({ ok: true });
    } catch (e) {
        console.error("[AC] report error:", e);
        res.status(500).json({ error: e.message });
    }
});

// launcher shit

express.get('/api/news', (req, res) => res.json([
  { title: 'Save The World', summary: 'Claim STW Founders Now!', image: 'https://fnggcdn.com/assets/tUWWrC.jpg', date: new Date(Date.now()).toISOString(), url: '' },
  { title: 'Obsidian', summary: 'Play Our Custom LateGame!', image: 'https://fortnite.gg/img/items/3592/locker.jpg?7', date: new Date(Date.now()).toISOString() },
  { title: 'Legacy', summary: 'First To Host STW And BR.', image: 'https://fnggcdn.com/assets/yTsX3V.png', date: new Date(Date.now()).toISOString() },
]));

express.get('/api/servers', (req, res) => res.json([
  { name: 'Obsidian Online Beta', address: '', region: 'EU', status: 'online', players: 0, maxPlayers: 100, build: '1.11' },
]));

express.get('/api/profile/:id', (req, res) => res.json({
  accountLevel: 1, level: 1, tier: 1, friends: 0,
  stats: { all: { wins: 0, matches: 0, kills: 0, hours: 0 }, solo: {}, duos: {}, squads: {} },
}));

// before errors

express.use((req, res, next) => {
    var XEpicErrorName = "errors.com.lawinserver.common.not_found";
    var XEpicErrorCode = 1004;
    res.set({
        'X-Epic-Error-Name': XEpicErrorName,
        'X-Epic-Error-Code': XEpicErrorCode
    });
    res.status(404);
    res.json({
        "errorCode": XEpicErrorName,
        "errorMessage": "Sorry the resource you were trying to find could not be found",
        "numericErrorCode": XEpicErrorCode,
        "originatingService": "any",
        "intent": "prod"
    });
});