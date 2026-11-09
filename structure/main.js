const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const functions = require("./functions.js");
const stats = require("./stats.js");
let accountManager = null;
try { accountManager = require("./accountManager.js"); } catch (e) {}
let virtualPresence = null;
try { virtualPresence = require("./virtualpresence.js"); } catch (e) {}

const connectedClients = [];

express.get("/clearitemsforshop", async (req, res) => {
    res.set("Content-Type", "text/plain");

    const athena = require("./../profiles/athena.json");
    const CatalogConfig = require("./../Config/catalog_config.json");
    var StatChanged = false;

    for (var value in CatalogConfig) {
        for (var i in CatalogConfig[value].itemGrants) {
            if (Array.isArray(CatalogConfig[value].itemGrants)) {
                for (var key in athena.items) {
                    if (typeof CatalogConfig[value].itemGrants[i] == "string") {
                        if (CatalogConfig[value].itemGrants[i].length != 0) {
                            if (CatalogConfig[value].itemGrants[i].toLowerCase() == athena.items[key].templateId.toLowerCase()) {
                                delete athena.items[key]

                                StatChanged = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if (StatChanged == true) {
        athena.rvn += 1;
        athena.commandRevision += 1;

        fs.writeFileSync("./profiles/athena.json", JSON.stringify(athena, null, 2));

        res.send('Success');
    } else {
        res.send('Failed, there are no items to remove')
    }
})

express.get("/eulatracking/api/shared/agreements/fn*", async (req, res) => {
    res.json({})
})

express.get("/fortnite/api/game/v2/friendcodes/*/epic", async (req, res) => {
    res.json([{
        "codeId": "L4WINS3RV3R",
        "codeType": "CodeToken:FounderFriendInvite",
        "dateCreated": "2024-04-02T21:37:00.420Z"
    },
    {
        "codeId": "playeereq",
        "codeType": "CodeToken:FounderFriendInvite_XBOX",
        "dateCreated": "2024-04-02T21:37:00.420Z"
    },
    {
        "codeId": "lawinscodelol",
        "codeType": "CodeToken:MobileInvite",
        "dateCreated": "2024-04-02T21:37:00.420Z"
    }])
})

express.get("/launcher/api/public/distributionpoints/", async (req, res) => {
    res.json({
        "distributions": [
            "https://epicgames-download1.akamaized.net/",
            "https://download.epicgames.com/",
            "https://download2.epicgames.com/",
            "https://download3.epicgames.com/",
            "https://download4.epicgames.com/",
            "https://lawinserver.ol.epicgames.com/"
        ]
    });
})

express.get("/launcher/api/public/assets/*", async (req, res) => {
    // Was hardcoded to "Release-20.00-CL-19458861", a completely different build
    // from this server's actual client (CL 611750138) — see version.js for the
    // same fix. A mismatched CL here is another source of "can't determine if
    // game needs updating."
    const memory = functions.GetVersionInfo(req);
    const cln = memory.CL || "611750138";
    const versionStr = memory.build ? String(memory.build) : "1.0";

    res.json({
        "appName": "FortniteContentBuilds",
        "labelName": "LawinServer",
        "buildVersion": `++Fortnite+Release-${versionStr}-CL-${cln}-Windows`,
        "catalogItemId": "5cb97847cee34581afdbc445400e2f77",
        "expires": "9999-12-31T23:59:59.999Z",
        "items": {
            "MANIFEST": {
                "signature": "LawinServer",
                "distribution": "https://lawinserver.ol.epicgames.com/",
                "path": "Builds/Fortnite/Content/CloudDir/LawinServer.manifest",
                "hash": "55bb954f5596cadbe03693e1c06ca73368d427f3",
                "additionalDistributions": []
            },
            "CHUNKS": {
                "signature": "LawinServer",
                "distribution": "https://lawinserver.ol.epicgames.com/",
                "path": "Builds/Fortnite/Content/CloudDir/LawinServer.manifest",
                "additionalDistributions": []
            }
        },
        "assetId": "FortniteContentBuilds"
    });
})

express.get("/Builds/Fortnite/Content/CloudDir/*.manifest", async (req, res) => {
    res.set("Content-Type", "application/octet-stream")

    const manifest = fs.readFileSync(path.join(__dirname, "..", "responses", "CloudDir", "LawinServer.manifest"));

    res.status(200).send(manifest).end();
})

express.get("/Builds/Fortnite/Content/CloudDir/*.chunk", async (req, res) => {
    res.set("Content-Type", "application/octet-stream")

    const chunk = fs.readFileSync(path.join(__dirname, "..", "responses", "CloudDir", "LawinServer.chunk"));

    res.status(200).send(chunk).end();
})

express.get("/Builds/Fortnite/Content/CloudDir/*.ini", async (req, res) => {
    const ini = fs.readFileSync(path.join(__dirname, "..", "responses", "CloudDir", "Full.ini"));

    res.status(200).send(ini).end();
})

express.post("/fortnite/api/game/v2/grant_access/*", async (req, res) => {
    res.json({});
    res.status(204);
})

express.post("/api/v1/user/setting", async (req, res) => {
    res.json([]);
})

express.get("/waitingroom/api/waitingroom", async (req, res) => {
    res.status(204);
    res.end();
})

express.get("/socialban/api/public/v1/*", async (req, res) => {
    res.json({
        "bans": [],
        "warnings": []
    });
})

express.get("/fortnite/api/game/v2/events/tournamentandhistory/*", async (req, res) => {
    const tournamentandhistory = require("./../responses/Athena/Tournament/tournamentandhistory.json");
    
    res.json(tournamentandhistory)
})

express.get("/fortnite/api/statsv2/account/:accountId", async (req, res) => {
    res.json(stats.statsV2(req.params.accountId));
})

express.get("/statsproxy/api/statsv2/account/:accountId", async (req, res) => {
    res.json(stats.statsV2(req.params.accountId));
})

express.get("/fortnite/api/stats/accountId/:accountId/bulk/window/alltime", async (req, res) => {
    res.json(stats.statsV2(req.params.accountId));
})

express.get("/d98eeaac-2bfa-4bf4-8a59-bdc95469c693", async (req, res) => {
    res.json({
        "playlist": "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPE1QRCB4bWxucz0idXJuOm1wZWc6ZGFzaDpzY2hlbWE6bXBkOjIwMTEiIHhtbG5zOnhzaT0iaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEtaW5zdGFuY2UiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4c2k6c2NoZW1hTG9jYXRpb249InVybjptcGVnOkRBU0g6c2NoZW1hOk1QRDoyMDExIGh0dHA6Ly9zdGFuZGFyZHMuaXNvLm9yZy9pdHRmL1B1YmxpY2x5QXZhaWxhYmxlU3RhbmRhcmRzL01QRUctREFTSF9zY2hlbWFfZmlsZXMvREFTSC1NUEQueHNkIiBwcm9maWxlcz0idXJuOm1wZWc6ZGFzaDpwcm9maWxlOmlzb2ZmLWxpdmU6MjAxMSIgdHlwZT0ic3RhdGljIiBtZWRpYVByZXNlbnRhdGlvbkR1cmF0aW9uPSJQVDMwLjIxM1MiIG1heFNlZ21lbnREdXJhdGlvbj0iUFQyLjAwMFMiIG1pbkJ1ZmZlclRpbWU9IlBUNC4xMDZTIj4KICA8QmFzZVVSTD5odHRwczovL3BpbGdyaW0ucXN0di5vbi5lcGljZ2FtZXMuY29tL3VtbXFVcUNTRlVXZVFmelR2cy9mMjUyOGZhMS01ZjMwLTQyZmYtOGFlNS1hMDNlM2IwMjNhMGEvPC9CYXNlVVJMPgogIDxQcm9ncmFtSW5mb3JtYXRpb24+PC9Qcm9ncmFtSW5mb3JtYXRpb24+CiAgPFBlcmlvZCBpZD0iMCIgc3RhcnQ9IlBUMFMiPgogICAgPEFkYXB0YXRpb25TZXQgaWQ9IjAiIGNvbnRlbnRUeXBlPSJhdWRpbyIgc3RhcnRXaXRoU0FQPSIxIiBzZWdtZW50QWxpZ25tZW50PSJ0cnVlIiBiaXRzdHJlYW1Td2l0Y2hpbmc9InRydWUiPgogICAgICA8UmVwcmVzZW50YXRpb24gaWQ9IjAiIGF1ZGlvU2FtcGxpbmdSYXRlPSI0ODAwMCIgYmFuZHdpZHRoPSIxMjgwMDAiIG1pbWVUeXBlPSJhdWRpby9tcDQiIGNvZGVjcz0ibXA0YS40MC4yIj4KICAgICAgICA8U2VnbWVudFRlbXBsYXRlIGR1cmF0aW9uPSIyMDAwMDAwIiB0aW1lc2NhbGU9IjEwMDAwMDAiIGluaXRpYWxpemF0aW9uPSJpbml0XyRSZXByZXNlbnRhdGlvbklEJC5tcDQiIG1lZGlhPSJzZWdtZW50XyRSZXByZXNlbnRhdGlvbklEJF8kTnVtYmVyJC5tNHMiIHN0YXJ0TnVtYmVyPSIxIj48L1NlZ21lbnRUZW1wbGF0ZT4KICAgICAgICA8QXVkaW9DaGFubmVsQ29uZmlndXJhdGlvbiBzY2hlbWVJZFVyaT0idXJuOm1wZWc6ZGFzaDoyMzAwMzozOmF1ZGlvX2NoYW5uZWxfY29uZmlndXJhdGlvbjoyMDExIiB2YWx1ZT0iMiI+PC9BdWRpb0NoYW5uZWxDb25maWd1cmF0aW9uPgogICAgICA8L1JlcHJlc2VudGF0aW9uPgogICAgPC9BZGFwdGF0aW9uU2V0PgogIDwvUGVyaW9kPgo8L01QRD4=",
        "playlistType": "application/dash+xml",
        "metadata": {
            "assetId": "",
            "baseUrls": [
                "https://fortnite-public-service-prod11.ol.epicgames.com/ummqUqCSFUWeQfzTvs/f2528fa1-5f30-42ff-8ae5-a03e3b023a0a/"
            ],
            "supportsCaching": true,
            "ucp": "a",
            "version": "f2528fa1-5f30-42ff-8ae5-a03e3b023a0a"
        }
    })
})

express.post("/fortnite/api/feedback/*", async (req, res) => {
    res.status(200);
    res.end();
})

express.post("/fortnite/api/statsv2/query", async (req, res) => {
    const body = req.body || {};
    let owners = body.owners || body.accountIds || [];
    if (!Array.isArray(owners)) owners = [owners];
    const wanted = Array.isArray(body.stats) ? body.stats : null;

    res.json(owners.filter(Boolean).map(id => {
        const payload = stats.statsV2(id);
        if (wanted && wanted.length) {
            // Only hand back the keys that were asked for.
            const picked = {};
            for (const k of wanted) picked[k] = payload.stats[k] || 0;
            payload.stats = picked;
        }
        return payload;
    }));
})

express.post("/statsproxy/api/statsv2/query", async (req, res) => {
    const body = req.body || {};
    let owners = body.owners || body.accountIds || [];
    if (!Array.isArray(owners)) owners = [owners];
    const wanted = Array.isArray(body.stats) ? body.stats : null;

    res.json(owners.filter(Boolean).map(id => {
        const payload = stats.statsV2(id);
        if (wanted && wanted.length) {
            // Only hand back the keys that were asked for.
            const picked = {};
            for (const k of wanted) picked[k] = payload.stats[k] || 0;
            payload.stats = picked;
        }
        return payload;
    }));
})

express.post("/fortnite/api/game/v2/events/v2/setSubgroup/*", async (req, res) => {
    res.status(204);
    res.end();
})

express.get("/fortnite/api/game/v2/enabled_features", async (req, res) => {
    res.json([])
})

// Sidekicks' icons
express.get("/v1/item/*", async (req, res) => {
    res.set("Content-Type", "image/png");
    const lawinpfp = fs.readFileSync(path.join(__dirname, "..", "public", "images", "lawinpfp.png"));
    res.send(lawinpfp);
})

express.get("/api/v1/events/Fortnite/download/:accountId", async (req, res) => {
    const memory = functions.GetVersionInfo(req);
    const tournament = require("./../responses/Athena/Tournament/tournament.json");
    tournament.player.accountId = req.params.accountId;

    if (memory.season >= 33) {
        // Dates must be more recent than 2018 for the Tournament to be displayed in the new UI.
        const nowMinusOneDay = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        try {
            const event = tournament.events[0];
            const window = event.eventWindows[0];

            event.beginTime = event.beginTime.replace(/^[^T]+/, nowMinusOneDay);
            window.beginTime = window.beginTime.replace(/^[^T]+/, nowMinusOneDay);
            window.countdownBeginTime = window.countdownBeginTime.replace(/^[^T]+/, nowMinusOneDay);
            event.endTime = event.endTime.replace(/^[^T]+/, nowMinusOneDay);
            window.endTime = window.endTime.replace(/^[^T]+/, nowMinusOneDay);
        } catch (err) {}
    }
    
    res.json(tournament)
})


express.get("/api/v1/events/Fortnite/:eventId/history/:accountId", async (req, res) => {
    const history = require("./../responses/Athena/Tournament/history.json");
    history[0].scoreKey.eventId = req.params.eventId;
    history[0].teamId = req.params.accountId;
    history[0].teamAccountIds = [req.params.accountId];
    
    res.json(history)
})

express.get("/api/v1/players/Fortnite/tokens", async (req, res) => {
    const teamAccountIds = (req.query.teamAccountIds || "").split(",");
    const tournament = require("./../responses/Athena/Tournament/tournament.json");
    var response = {"accounts": []}

    for (const accountId of teamAccountIds) {
        response.accounts.push({
            "accountId": accountId,
            "tokens": tournament.player.tokens
        })
    }
    
    res.json(response)
})

express.get("/api/v1/leaderboards/Fortnite/:eventId/:eventWindowId/:accountId", async (req, res) => {
    const template = require("./../responses/Athena/Tournament/leaderboard.json");
    // Deep copy: the old code pushed straight into the cached require() object.
    const leaderboards = JSON.parse(JSON.stringify(template));
    const { eventId, eventWindowId, accountId } = req.params;

    leaderboards.eventId = eventId;
    leaderboards.eventWindowId = eventWindowId;
    leaderboards.entries = [];

    const entryTemplate = leaderboards.entryTemplate || {};
    const pointsKey = "event_" + eventId + "_points";

    // Real accounts, ranked by points actually earned in this event.
    const ranked = stats.knownAccountIds()
        .map(id => ({ id, points: stats.value(id, pointsKey) }))
        .sort((a, b) => (b.points - a.points) || a.id.localeCompare(b.id));

    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 100;
    let rank = 0;
    for (const row of ranked.slice(0, limit)) {
        rank++;
        const entry = JSON.parse(JSON.stringify(entryTemplate));
        entry.eventId = eventId;
        entry.eventWindowId = eventWindowId;
        entry.teamAccountIds = [row.id];
        entry.teamId = row.id;
        entry.pointsEarned = entry.score = row.points;
        entry.rank = rank;
        entry.percentile = ranked.length ? Math.round((rank / ranked.length) * 100) / 100 : 0;
        entry.pointBreakdown = {
            "PLACEMENT_STAT_INDEX:13": {
                "timesAchieved": stats.value(row.id, pointsKey + "_placements"),
                "pointsEarned": stats.value(row.id, pointsKey + "_placement_points")
            },
            "TEAM_ELIMS_STAT_INDEX:37": {
                "timesAchieved": stats.value(row.id, pointsKey + "_elims"),
                "pointsEarned": stats.value(row.id, pointsKey + "_elim_points")
            }
        };
        leaderboards.entries.push(entry);
    }

    leaderboards.totalSessionsPlayed = leaderboards.entries.length;
    leaderboards.updatedTime = new Date().toISOString();
    // The requesting player is always included so the UI can highlight them.
    if (accountId && !leaderboards.entries.some(e => e.teamId === accountId)) {
        const self = ranked.findIndex(r => r.id === accountId);
        if (self !== -1) {
            const entry = JSON.parse(JSON.stringify(entryTemplate));
            entry.eventId = eventId;
            entry.eventWindowId = eventWindowId;
            entry.teamAccountIds = [accountId];
            entry.teamId = accountId;
            entry.pointsEarned = entry.score = ranked[self].points;
            entry.rank = self + 1;
            leaderboards.entries.push(entry);
        }
    }

    res.json(leaderboards);
})

// --- stat ingestion / admin -------------------------------------------------
// Nothing on a private server reports match results on its own, so this is how
// numbers get onto the board: the game server (or a match-end hook) posts here.

express.post("/lawin/stats/report", async (req, res) => {
    const body = req.body || {};
    const accountId = body.accountId || req.headers["x-epic-account-id"];
    if (!accountId) return res.status(400).json({ error: "accountId required" });

    if (body.stats && typeof body.stats === "object") {
        stats.addStats(accountId, body.stats);
    }
    if (body.eventId && (body.points !== undefined || body.elims !== undefined)) {
        const k = "event_" + body.eventId + "_points";
        const d = {};
        if (body.points !== undefined) d[k] = Number(body.points) || 0;
        if (body.elims !== undefined) {
            d[k + "_elims"] = Number(body.elims) || 0;
            d[k + "_elim_points"] = Number(body.elimPoints !== undefined ? body.elimPoints : body.elims) || 0;
        }
        if (body.placement !== undefined) {
            d[k + "_placements"] = 1;
            d[k + "_placement_points"] = Number(body.placementPoints) || 0;
        }
        stats.addStats(accountId, d);
    }
    if (body.playlist !== undefined || body.placement !== undefined || body.kills !== undefined) {
        stats.recordMatch(accountId, body);
    }

    console.log(`[Stats] recorded match for ${accountId} (playlist ${body.playlist || "p2"}, placement ${body.placement || "-"}, kills ${body.kills || 0})`);
    res.json({ accountId, stats: stats.statsFor(accountId) });
})

express.post("/lawin/stats/set", async (req, res) => {
    const body = req.body || {};
    if (!body.accountId) return res.status(400).json({ error: "accountId required" });
    stats.setStats(body.accountId, body.stats || {});
    res.json({ accountId: body.accountId, stats: stats.statsFor(body.accountId) });
})

express.post("/lawin/stats/reset", async (req, res) => {
    const accountId = (req.body || {}).accountId;
    stats.reset(accountId);
    res.json({ reset: accountId || "all" });
})

express.get("/lawin/stats/:accountId", async (req, res) => {
    res.json(stats.statsV2(req.params.accountId));
})

// Human-readable board for a web page or a quick check in the browser.
express.get("/lawin/leaderboard", async (req, res) => {
    const stat = req.query.stat || "br_placetop1_pc_m0_p2";
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 100;
    res.json({
        stat,
        updated: new Date().toISOString(),
        entries: stats.leaderboard(stat, limit)
    });
})


express.get("/fortnite/api/game/v2/twitch/*", async (req, res) => {
    res.status(200);
    res.end();
})

express.get("/fortnite/api/game/v2/world/info", async (req, res) => {
    const worldstw = functions.getTheater(req);

    res.json(worldstw)
})

// When client asks for chat rooms, register them as online
express.post("/fortnite/api/game/v2/chat/*/*/*/pc", async (req, res) => {
    // Get client identifier from request
    const clientId = req.headers['x-epic-account-id'] || req.query.accountId || 'client_' + Date.now();
    
    // Add to connected clients if not already there
    if (!connectedClients.includes(clientId)) {
        connectedClients.push(clientId);
        console.log(`[Chat] Client ${clientId} connected`);
    }

    // Also mark real account online via virtual presence (early clients)
    try {
        let accId = req.headers['x-epic-account-id'] || "";
        if (!accId && accountManager && accountManager.accountFromToken) {
            const acc = accountManager.accountFromToken(req.headers.authorization || "");
            if (acc) accId = acc.accountId;
        }
        if (accId && virtualPresence && typeof virtualPresence.heartbeat === "function") {
            virtualPresence.heartbeat(accId, accId);
        }
    } catch (e) {}
    
    res.json({ "GlobalChatRooms": [
        {"roomName":"lawinserverglobal"},
        {"roomName":"founderschat"}
    ] });
});

express.post("/fortnite/api/game/v2/chat/founders/*/*/pc", async (req, res) => {
    res.json({ "FoundersChatRooms": [{"roomName":"foundersglobal"}] })
})

express.post("/fortnite/api/game/v2/chat/*/recommendGeneralChatRooms/pc", async (req, res) => {
    res.json({});
});

express.post("/fortnite/api/game/v2/chat/message", async (req, res) => {
    const { message, sender } = req.body;
    const senderId = sender || req.headers['x-epic-account-id'] || 'Unknown';
    
    // Broadcast to all connected clients EXCEPT sender
    // Note: This requires clients to be polling this endpoint
    res.json({ 
        success: true,
        broadcast: true,
        data: {
            sender: senderId,
            message: message,
            timestamp: Date.now()
        }
    });
});

express.get("/presence/api/v1/_/*/last-online", async (req, res) => {
    res.json({})
})

// ---------------------------------------------------------------------------
// Lawin launcher / custom client HTTP presence
// The modified client polls these instead of (or before) XMPP on early builds.
// Without them the UI stays "Offline" even when the player is in lobby.
// ---------------------------------------------------------------------------
function presenceSnapshot(excludeId) {
    const list = [];
    if (!global.Clients || !Array.isArray(global.Clients)) return list;
    const exclude = String(excludeId || "").toLowerCase();
    for (const c of global.Clients) {
        if (!c || !c.accountId) continue;
        if (exclude && String(c.accountId).toLowerCase() === exclude) continue;
        let statusObj = {};
        try {
            statusObj = JSON.parse((c.lastPresenceUpdate && c.lastPresenceUpdate.status) || "{}");
        } catch (e) {}
        list.push({
            accountId: c.accountId,
            displayName: c.displayName || c.accountId,
            status: statusObj.Status || "Online",
            bIsPlaying: !!statusObj.bIsPlaying,
            bIsJoinable: !!statusObj.bIsJoinable,
            ProductName: statusObj.ProductName || "Fortnite",
            SessionId: statusObj.SessionId || "",
            lastSeen: c.lastSeen || Date.now(),
            jid: c.jid || null,
            isVirtual: !!c.isVirtualHost
        });
    }
    return list;
}

// Launcher heartbeat: marks the account online (virtual host if no real XMPP yet)
express.post("/lawin/presence", async (req, res) => {
    try {
        const body = req.body || {};
        let accountId = body.accountId || body.account_id || body.id
            || req.headers["x-epic-account-id"] || req.query.accountId || "";
        let displayName = body.displayName || body.display_name || body.username || accountId;

        // Fall back to token identity
        if (!accountId) {
            try {
                const acc = accountManager && accountManager.accountFromToken
                    ? accountManager.accountFromToken(req.headers.authorization || "")
                    : null;
                if (acc) {
                    accountId = acc.accountId;
                    displayName = displayName || acc.displayName || accountId;
                }
            } catch (e) {}
        }

        accountId = String(accountId || "").trim();
        if (!accountId) {
            return res.status(400).json({ error: "accountId required" });
        }

        if (virtualPresence && typeof virtualPresence.heartbeat === "function") {
            virtualPresence.heartbeat(accountId, displayName);
        } else {
            // Minimal fallback if virtualpresence module missing
            global.Clients = global.Clients || [];
            let existing = global.Clients.find(c => c.accountId === accountId);
            if (existing) {
                existing.lastSeen = Date.now();
            } else {
                const domain = global.xmppDomain || "prod.ol.epicgames.com";
                global.Clients.push({
                    client: { send: () => {} },
                    accountId,
                    displayName: displayName || accountId,
                    jid: `${accountId}@${domain}/V2:Fortnite:WIN::legacy`,
                    resource: "V2:Fortnite:WIN::legacy",
                    isVirtualHost: true,
                    lastSeen: Date.now(),
                    lastPresenceUpdate: {
                        away: false,
                        status: JSON.stringify({
                            Status: "Online",
                            bIsPlaying: false,
                            bIsJoinable: false,
                            bHasVoiceSupport: false,
                            ProductName: "Fortnite",
                            SessionId: ""
                        })
                    }
                });
                console.log("[LawinPresence] marked online:", displayName || accountId);
            }
        }

        res.json({ ok: true, accountId, online: true });
    } catch (e) {
        console.log("[LawinPresence] error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Who is online (used by launcher friend list / status UI)
express.get("/lawin/online", async (req, res) => {
    try {
        const exclude = req.query.exclude || req.query.accountId || "";
        const online = presenceSnapshot(exclude);
        res.json({ online, count: online.length });
    } catch (e) {
        res.json({ online: [], count: 0 });
    }
});

// Optional: explicit offline
express.post("/lawin/presence/offline", async (req, res) => {
    try {
        const accountId = (req.body && (req.body.accountId || req.body.account_id)) || "";
        if (accountId && virtualPresence && typeof virtualPresence.markOffline === "function") {
            virtualPresence.markOffline(accountId);
        }
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false });
    }
});

express.get("/fortnite/api/receipts/v1/account/*/receipts", async (req, res) => {
    res.json([])
})

express.get("/fortnite/api/game/v2/leaderboards/cohort/:accountId", async (req, res) => {
    res.json({
        "accountId": req.params.accountId,
        "cohortAccounts": stats.cohort(req.params.accountId),
        "expiresAt": "9999-12-31T00:00:00.000Z",
        "playlist": req.query.playlist
    })
})

express.post("/fortnite/api/leaderboards/type/group/stat/:statName/window/:statWindow", async (req, res) => {
    // Was Math.random() per account, so the board reshuffled every request.
    let ids = Array.isArray(req.body) ? req.body : (req.body && req.body.accountIds) || [];
    const entries = stats.valuesFor(ids, req.params.statName);

    res.json({
        "entries": entries,
        "statName": req.params.statName,
        "statWindow": req.params.statWindow
    })
    res.end();
});

express.post("/fortnite/api/leaderboards/type/global/stat/:statName/window/:statWindow", async (req, res) => {
    // Was heroNames.json (STW hero names, not accounts) with random values.
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 100;
    const entries = stats.leaderboard(req.params.statName, limit)
        .map(r => ({ "accountId": r.accountId, "value": r.value }));

    res.json({
        "entries": entries,
        "statName": req.params.statName,
        "statWindow": req.params.statWindow
    })
    res.end();
});

express.get("/fortnite/api/game/v2/homebase/allowed-name-chars", async (req, res) => {
    res.json({
        "ranges": [
            48,
            57,
            65,
            90,
            97,
            122,
            192,
            255,
            260,
            265,
            280,
            281,
            286,
            287,
            304,
            305,
            321,
            324,
            346,
            347,
            350,
            351,
            377,
            380,
            1024,
            1279,
            1536,
            1791,
            4352,
            4607,
            11904,
            12031,
            12288,
            12351,
            12352,
            12543,
            12592,
            12687,
            12800,
            13055,
            13056,
            13311,
            13312,
            19903,
            19968,
            40959,
            43360,
            43391,
            44032,
            55215,
            55216,
            55295,
            63744,
            64255,
            65072,
            65103,
            65281,
            65470,
            131072,
            173791,
            194560,
            195103
        ],
        "singlePoints": [
            32,
            39,
            45,
            46,
            95,
            126
        ],
        "excludedPoints": [
            208,
            215,
            222,
            247
        ]
    })
})

express.post("/datarouter/api/v1/public/data", async (req, res) => {
    res.status(204);
    res.end();
})

express.post("/api/v1/assets/Fortnite/*/*", async (req, res) => {
    if (req.body.hasOwnProperty("FortCreativeDiscoverySurface") && req.body.FortCreativeDiscoverySurface == 0) {
        const discovery_api_assets = require("./../responses/Athena/Discovery/discovery_api_assets.json");
        res.json(discovery_api_assets)
    }
    else {
        res.json({
            "FortCreativeDiscoverySurface": {
                "meta": {
                    "promotion": req.body.FortCreativeDiscoverySurface || 0
                },
                "assets": {}
            }
        })
    }
})

express.get("/region", async (req, res) => {
    res.json({
        "continent": {
            "code": "EU",
            "geoname_id": 6255148,
            "names": {
                "de": "Europa",
                "en": "Europe",
                "es": "Europa",
                "fr": "Europe",
                "ja": "ヨーロッパ",
                "pt-BR": "Europa",
                "ru": "Европа",
                "zh-CN": "欧洲"
            }
        },
        "country": {
            "geoname_id": 2635167,
            "is_in_european_union": false,
            "iso_code": "GB",
            "names": {
                "de": "UK",
                "en": "United Kingdom",
                "es": "RU",
                "fr": "Royaume Uni",
                "ja": "英国",
                "pt-BR": "Reino Unido",
                "ru": "Британия",
                "zh-CN": "英国"
            }
        },
        "subdivisions": [
            {
                "geoname_id": 6269131,
                "iso_code": "ENG",
                "names": {
                    "de": "England",
                    "en": "England",
                    "es": "Inglaterra",
                    "fr": "Angleterre",
                    "ja": "イングランド",
                    "pt-BR": "Inglaterra",
                    "ru": "Англия",
                    "zh-CN": "英格兰"
                }
            },
            {
                "geoname_id": 3333157,
                "iso_code": "KEC",
                "names": {
                    "en": "Royal Kensington and Chelsea"
                }
            }
        ]
    })
})

// Parental Controls
express.all("/v1/epic-settings/public/users/*/values", async (req, res) => {
    const epicsettings = require("./../responses/epic-settings.json");
    res.json(epicsettings)
})

express.post("/epic/socs/v1/users/*/settings/query", async (req, res) => {
    const socssettings = require("./../responses/socs-settings.json");
    res.json(socssettings)
})

express.get("/fortnite/api/game/v2/br-inventory/account/*", async (req, res) => {
    res.json({
        "stash": {
            "globalcash": 5000
        }
    })
})

module.exports = express;