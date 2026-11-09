const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const iniparser = require("ini");
const config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());
const functions = require("./functions.js");
const mmQueue = require("./mmQueue.js");

express.get("/fortnite/api/matchmaking/session/findPlayer/*", async (req, res) => {
    res.status(200);
    res.end();
});

express.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/*", async (req, res) => {
    const bucketId = req.query.bucketId || "";
    const playlist = mmQueue.playlistFromBucketId(bucketId);
    const accountId = (req.params[0] || "").split("/")[0];

    res.cookie("currentbuildUniqueId", bucketId.split(":")[0]);
    res.cookie("playlistName", playlist);

    // Register the ticket so the matchmaker WebSocket knows which playlist was requested
    mmQueue.registerTicket({ accountId: accountId, playlist: playlist, bucketId: bucketId });

    // Build serviceUrl the client will open for the matchmaker WebSocket.
    // Priority:
    //   1. MATCHMAKER_HOST / XMPP.host from config / env
    //   2. Host the client actually used to reach this HTTP backend (req.hostname)
    //   3. GameServer.ip
    //   4. 26.155.48.164 (last resort)
    let mmHost = "26.155.48.164";
    try {
        const candidates = [
            process.env.MATCHMAKER_HOST,
            process.env.XMPP_HOST,
            config.XMPP && config.XMPP.host,
            config.Matchmaker && config.Matchmaker.host,
            req.hostname,
            req.headers["x-forwarded-host"] && String(req.headers["x-forwarded-host"]).split(",")[0].trim(),
            process.env.GAMESERVER_IP,
            config.GameServer && config.GameServer.ip
        ];
        for (const h of candidates) {
            if (!h) continue;
            const clean = String(h).replace(/^https?:\/\//, "").split(":")[0].trim();
            if (clean && clean !== "0.0.0.0" && clean !== "localhost") {
                mmHost = clean;
                break;
            }
            if (clean === "localhost") {
                mmHost = "26.155.48.164";
                break;
            }
        }
    } catch (e) {}

    // v1.11 clients connect to ws://<host>[:port]
    const wsPort = mmQueue.settings.wsPort;
    const serviceUrl = wsPort === 80 || wsPort === 443
        ? "ws://" + mmHost
        : "ws://" + mmHost + ":" + wsPort;

    console.log(`[Matchmaker] ticket for ${accountId} playlist=${playlist} serviceUrl=${serviceUrl}`);

    res.json({
        serviceUrl: serviceUrl,
        ticketType: "mms-player",
        payload: "69=",
        signature: "420="
    });
});

// Live matchmaking queue (real number of players queued per playlist)
express.get(["/matchmaking/queue", "/fortnite/api/matchmaking/queue"], async (req, res) => {
    res.json(mmQueue.snapshot());
});

express.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", async (req, res) => {
    res.json({
        "accountId": req.params.accountId,
        "sessionId": req.params.sessionId,
        "key": "none"
    });
});

express.get("/fortnite/api/matchmaking/session/:session_id", async (req, res) => {
    const playlist = req.cookies.playlistName || "Playlist_DefaultSolo";

    res.json({
        "id": req.params.session_id,
        "ownerId": functions.MakeID().replace(/-/ig, "").toUpperCase(),
        "ownerName": "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
        "serverName": "[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968",
        "serverAddress": config.GameServer.ip,
        "serverPort": Number(config.GameServer.port),
        "maxPublicPlayers": 220,
        "openPublicPlayers": 175,
        "maxPrivatePlayers": 0,
        "openPrivatePlayers": 0,
        "attributes": {
          "REGION_s": "EU",
          "GAMEMODE_s": "FORTATHENA",
          "ALLOWBROADCASTING_b": true,
          "SUBREGION_s": "GB",
          "DCID_s": "FORTNITE-LIVEEUGCEC1C2E30UBRCORE0A-14840880",
          "tenant_s": "Fortnite",
          "MATCHMAKINGPOOL_s": "Any",
          "STORMSHIELDDEFENSETYPE_i": 0,
          "HOTFIXVERSION_i": 0,
          "PLAYLISTNAME_s": playlist,
          "SESSIONKEY_s": functions.MakeID().replace(/-/ig, "").toUpperCase(),
          "TENANT_s": "Fortnite",
          "BEACONPORT_i": 15009
        },
        "publicPlayers": [],
        "privatePlayers": [],
        "totalPlayers": 45,
        "allowJoinInProgress": true,
        "shouldAdvertise": true,
        "isDedicated": true,
        "usesStats": false,
        "allowInvites": false,
        "usesPresence": false,
        "allowJoinViaPresence": true,
        "allowJoinViaPresenceFriendsOnly": false,
        "buildUniqueId": req.cookies.currentbuildUniqueId || "611750138",
        "lastUpdated": new Date().toISOString(),
        "started": false
      });
});

express.post("/fortnite/api/matchmaking/session/*/join", async (req, res) => {
    res.status(204);
    res.end();
});

express.post("/fortnite/api/matchmaking/session/matchMakingRequest", async (req, res) => {
    res.json([]);
});

// Call this from whatever starts your dedicated server (e.g. a launcher .bat
// that curls this once it sees the server's own "ready"/"listening" log line).
// Example: curl "http://26.155.48.164:3551/matchmaking/serverReady?ip=26.155.48.164&port=7777"
express.get("/matchmaking/serverReady", (req, res) => {
    const ip = req.query.ip || (config.GameServer && config.GameServer.ip) || "26.155.48.164";
    const port = Number(req.query.port || (config.GameServer && config.GameServer.port) || 7777);
    mmQueue.markReady(ip, port);
    res.json({ ok: true, ip, port, marked: "ready" });
});

// Call this when the dedicated server exits/crashes, so new queuers don't get
// waved through against a server that's no longer there.
express.get("/matchmaking/serverOffline", (req, res) => {
    const ip = req.query.ip || (config.GameServer && config.GameServer.ip) || "26.155.48.164";
    const port = Number(req.query.port || (config.GameServer && config.GameServer.port) || 7777);
    mmQueue.clearReady(ip, port);
    res.json({ ok: true, ip, port, marked: "offline" });
});

module.exports = express;
