/**
 * OT6.5 (Fortnite Alpha) support for LawinServer
 * - Same accounts + friends as modern STW
 * - Separate progression under profiles/accounts_ot65/<accountId>/
 * Inspired by https://github.com/vopswtf/Fortify-Alpha
 */
const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const accountManager = require("./accountManager.js");
const functions = require("./functions.js");
const gameData = require("./ot65GameData.js");

function isOt65(req) {
    try {
        const ini = require("ini");
        const cfgPath = path.join(__dirname, "..", "Config", "config.ini");
        if (fs.existsSync(cfgPath)) {
            const cfg = ini.parse(fs.readFileSync(cfgPath, "utf8"));
            if (cfg.Config && (cfg.Config.bOT65 === true || cfg.Config.bOT65 === "true" || String(cfg.Config.bForceOT65).toLowerCase() === "true")) {
                return true;
            }
        }
    } catch (e) {}

    const ua = String(req.headers["user-agent"] || "");
    const clRaw = String(
        req.headers["x-epic-cl"] ||
        req.headers["X-Epic-CL"] ||
        req.headers["x-epic-changelist"] ||
        req.headers["x-ue-changelist"] ||
        ""
    );
    const clNum = parseInt(String(clRaw).replace(/\D/g, ""), 10);

    // Exact OT6.5 shipping build from client logs
    if (clNum === 2870186) return true;
    if (/2870186/.test(ua) || /2870186/.test(clRaw)) return true;
    if (/4\.12\.0-2870186/i.test(ua) || /\+\+\+Fortnite\+Release-Live/i.test(ua)) return true;
    if (/OT\s*6\.?5/i.test(ua) || /\bOT6\b/i.test(ua)) return true;

    // Early CLs
    if (!isNaN(clNum) && clNum > 100000 && clNum < 4000000) return true;

    try {
        const memory = functions.GetVersionInfo(req);
        if (memory && memory.season === 0) return true;
        if (memory && memory.build && memory.build < 1.9) return true;
    } catch (e) {}

    // Sticky: if this process already served OT version to this IP recently
    if (global.__ot65Clients && req.socket && req.socket.remoteAddress) {
        const ip = req.socket.remoteAddress;
        if (global.__ot65Clients[ip] && Date.now() - global.__ot65Clients[ip] < 3600000) return true;
    }

    return false;
}

function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : (functions.MakeID && functions.MakeID()) || (Date.now().toString(16) + Math.random().toString(16).slice(2));
}

function mcpResponse(profile, ApplyProfileChanges, BaseRevision) {
    let changes = ApplyProfileChanges;
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
        changes = [{ changeType: "fullProfileUpdate", profile: profile }];
    }
    // Ensure nested profile is plain JSON
    changes = changes.map(c => {
        if (c && c.changeType === "fullProfileUpdate" && c.profile) {
            return { changeType: "fullProfileUpdate", profile: JSON.parse(JSON.stringify(c.profile)) };
        }
        return c;
    });
    return {
        profileRevision: profile.rvn || 1,
        profileId: profile.profileId || "profile0",
        profileChangesBaseRevision: BaseRevision || 0,
        profileChanges: changes,
        profileCommandRevision: profile.commandRevision || 1,
        serverTime: new Date().toISOString(),
        responseVersion: 1
    };
}

function fullUpdate(profile) {
    return [{ changeType: "fullProfileUpdate", profile: JSON.parse(JSON.stringify(profile)) }];
}

function loadProfile(req) {
    let accountId = accountManager.accountIdFromRequest(req);
    // Prefer path param from OT routes
    if (req.params && req.params.accountId) {
        accountId = accountManager.sanitizeAccountId(req.params.accountId);
    }
    let profileId = req.query.profileId || "profile0";
    // OT6.5 almost always uses profile0
    if (!profileId || profileId === "undefined") profileId = "profile0";
    accountManager.ensureOt65Profiles(accountId);
    let profile = accountManager.readOt65Profile(accountId, profileId);
    if (!profile) {
        profile = accountManager.readOt65Profile(accountId, "profile0");
        profileId = "profile0";
    }
    // Strip mongoose-style / non-serializable junk
    profile = JSON.parse(JSON.stringify(profile));
    profile.accountId = accountId;
    profile.profileId = profileId;
    return { accountId, profileId, profile };
}

function saveProfile(accountId, profileId, profile) {
    profile.rvn = (profile.rvn || 0) + 1;
    profile.commandRevision = (profile.commandRevision || 0) + 1;
    profile.updated = new Date().toISOString();
    accountManager.writeOt65Profile(accountId, profileId, profile);
}


// OT6.5 queries this during login — must not 404
express.get("/account/api/accounts/:accountId/metadata", async (req, res) => {
    res.json({});
});

express.get("/account/api/public/account/:accountId/metadata", async (req, res) => {
    res.json({});
});

// Middleware: mark OT requests (optional logging)
express.use((req, res, next) => {
    if (isOt65(req)) {
        req.lawinOt65 = true;
        // ensure OT profiles exist when any OT traffic arrives
        try {
            const aid = accountManager.accountIdFromRequest(req);
            if (aid) accountManager.ensureOt65Profiles(aid);
        } catch (e) {}
    }
    next();
});

// ---- OT-specific world / outpost stubs (Fortify-style) ----
express.get("/fortnite/api/game/v2/outpost/:accountId", async (req, res, next) => {
    if (!isOt65(req)) return next();
    res.json({});
});

express.get("/fortnite/api/world/worlds/:rest", async (req, res, next) => {
    if (!isOt65(req)) return next();
    res.json({});
});

express.post("/fortnite/api/world/worlds/:rest/lock", async (req, res, next) => {
    if (!isOt65(req)) return next();
    res.json({ lockState: true });
});

express.delete("/fortnite/api/world/worlds/:rest/lock", async (req, res, next) => {
    if (!isOt65(req)) return next();
    res.json({ lockState: false });
});

express.post("/fortnite/api/matchmaking/session/matchMakingRequest", async (req, res, next) => {
    if (!isOt65(req)) return next();
    res.json([]);
});

// ---- Fortify common/ assets (world_info, catalog, version) ----
function loadCommonJson(...parts) {
    const p = path.join(__dirname, "..", "common", ...parts);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
        console.log("[OT65] failed to parse", p, e.message);
        return null;
    }
}

express.get("/fortnite/api/game/v2/world/info", async (req, res, next) => {
    if (!isOt65(req)) return next();
    const world = loadCommonJson("world_info.json");
    if (world) {
        res.setHeader("Content-Type", "application/json");
        return res.send(JSON.stringify(world));
    }
    console.log("[OT65] missing common/world_info.json — copy from Fortify-Alpha/common/");
    return next();
});

express.post("/fortnite/api/game/v2/world/validate", async (req, res, next) => {
    if (!isOt65(req)) return next();
    const world = loadCommonJson("world_info.json");
    if (!world) return res.status(404).end();
    const { theaterId, theaterMissionId, zoneThemeClass, worldId } = req.body || {};
    if (!theaterId || !theaterMissionId || !zoneThemeClass) return res.status(400).end();
    const theaters = world.missions || world.theaters || [];
    const theater = (Array.isArray(theaters) ? theaters : []).find(t => t.theaterId === theaterId);
    if (!theater) return res.status(404).end();
    const mission = (theater.availableMissions || []).find(m => m.missionGuid === theaterMissionId);
    if (!mission) return res.status(404).end();
    res.json({
        worldId,
        theaterId,
        theaterMissionId,
        zoneThemeClass,
        missionRewards: mission.missionRewards,
        missionGenerator: mission.missionGenerator,
        zoneDifficultyInfo: mission.missionDifficultyInfo,
        tileIndex: mission.tileIndex,
        zoneModifiers: []
    });
});

express.get("/fortnite/api/storefront/v2/catalog", async (req, res, next) => {
    if (!isOt65(req)) return next();
    const catalog = loadCommonJson("catalog.json");
    if (catalog) {
        res.setHeader("Content-Type", "application/json");
        return res.send(JSON.stringify(catalog));
    }
    return next();
});

express.get("/fortnite/api/version", async (req, res, next) => {
    // Always respond OT version for known OT builds; also set sticky flag from response path
    const clHint = String(req.headers["x-epic-cl"] || req.headers["X-Epic-CL"] || "");
    const forceOtVersion = isOt65(req) || /2870186/.test(clHint);
    if (!forceOtVersion) return next();
    try {
        global.__ot65Clients = global.__ot65Clients || {};
        if (req.socket && req.socket.remoteAddress) {
            global.__ot65Clients[req.socket.remoteAddress] = Date.now();
        }
    } catch (e) {}
    res.json({
        app: "fortnite",
        serverDate: new Date().toISOString(),
        overridePropertiesVersion: "unknown",
        cln: "2870186",
        build: "1",
        moduleName: "Fortnite-Core",
        buildDate: "2016-02-17T11:16:51.000Z",
        version: "4.12.0-2870186+++Fortnite+Release-Live",
        branch: "++Fortnite+Release-Live",
        modules: {}
    });
});


// ---- MCP operations for OT65 ----
// Register BEFORE main mcp catch-all by loading this router first in index.js

function otMcp(operationNames, handler) {
    const names = Array.isArray(operationNames) ? operationNames : [operationNames];
    for (const name of names) {
        express.post(`/fortnite/api/game/v2/profile/:accountId/client/${name}`, async (req, res, next) => {
            if (!isOt65(req)) return next();
            try {
                const { accountId, profileId, profile } = loadProfile(req);
                console.log("[OT65] MCP", req.params && req.params.operation || "op", "account=", accountId, "profile=", profileId);
                const BaseRevision = profile.rvn || 0;
                req.mcp = { profileChanges: [] };
                await handler(req, res, profile, accountId, profileId);
                if (res.headersSent) return;
                // if handler didn't save, still return full profile for queries
                if (!req.mcp.skipSave && req.mcp.dirty) {
                    saveProfile(accountId, profileId, profile);
                }
                const latest = accountManager.readOt65Profile(accountId, profileId);
                // OT6.5 client crashes if profileChanges is empty or body is not a JSON object
                const changes = fullUpdate(latest);
                return res.status(200).json(mcpResponse(latest, changes, BaseRevision));
            } catch (e) {
                console.log("[OT65] MCP error", name, e);
                if (!res.headersSent) res.status(500).json({ error: e.message });
            }
        });
    }
}

otMcp(["QueryProfile", "QueryPublicProfile"], async (req, res, profile) => {
    // full profile returned by wrapper
});

otMcp(["ClientQuestLogin", "QuestLogin"], async (req, res, profile) => {
    // no-op login for OT
});

otMcp("SetHomebaseMeta", async (req, res, profile) => {
    if (!profile.stats) profile.stats = { attributes: {} };
    if (!profile.stats.attributes) profile.stats.attributes = {};
    profile.stats.attributes.homebase = {
        townName: (req.body && req.body.townName) || "Homebase",
        flagPattern: (req.body && req.body.flagPattern) || 0,
        flagColor: (req.body && req.body.flagColor) || 0.5
    };
    req.mcp.dirty = true;
    req.mcp.profileChanges.push({
        changeType: "statModified",
        name: "homebase",
        value: profile.stats.attributes.homebase
    });
});

otMcp("SetGameplayStats", async (req, res, profile) => {
    if (req.body && Array.isArray(req.body.gameplayStats)) {
        profile.stats.attributes.gameplay_stats = req.body.gameplayStats;
        req.mcp.dirty = true;
    }
});

otMcp("SetModeLoadout", async (req, res, profile) => {
    if (!req.body) return;
    profile.stats.attributes.mode_loadouts = profile.stats.attributes.mode_loadouts || [];
    // simple replace/append
    if (req.body.loadoutName) {
        const idx = profile.stats.attributes.mode_loadouts.findIndex(l => l.loadoutName === req.body.loadoutName);
        const entry = {
            loadoutName: req.body.loadoutName,
            selectedGadgets: req.body.selectedGadgets || ["", ""]
        };
        if (idx >= 0) profile.stats.attributes.mode_loadouts[idx] = entry;
        else profile.stats.attributes.mode_loadouts.push(entry);
        req.mcp.dirty = true;
    }
});

otMcp("MarkItemSeen", async (req, res, profile) => {
    const ids = (req.body && (req.body.itemIds || req.body.itemIds)) || [];
    for (const id of ids) {
        if (profile.items[id]) {
            profile.items[id].attributes = profile.items[id].attributes || {};
            profile.items[id].attributes.item_seen = true;
            profile.items[id].attributes.bItemSeen = 1;
            req.mcp.dirty = true;
        }
    }
});

otMcp("MarkNewQuestNotificationSent", async (req, res, profile) => {
    const ids = (req.body && req.body.itemIds) || [];
    for (const id of ids) {
        if (profile.items[id]) {
            profile.items[id].attributes = profile.items[id].attributes || {};
            profile.items[id].attributes.sent_new_notification = true;
            req.mcp.dirty = true;
        }
    }
});

otMcp("UpdateQuestClientObjectives", async (req, res, profile) => {
    // body often contains advance entries; apply completion increments if present
    if (!req.body || !req.body.advance) return;
    req.mcp.dirty = true;
});

otMcp("CreateBuilding", async (req, res, profile) => {
    const templateId = req.body && req.body.templateId;
    if (!templateId) return;
    if (gameData.isReady()) {
        const def = gameData.getItem(templateId);
        if (!def && !String(templateId).startsWith("MyFortBuilding.")) {
            console.log("[OT65] CreateBuilding unknown template", templateId);
        }
    }
    let key = Object.keys(profile.items || {}).find(k => profile.items[k].templateId === templateId);
    if (!key) {
        key = makeId();
        const attrs = gameData.isReady() ? gameData.generateAttributes(templateId) : {};
        attrs.level = 1;
        attrs.buildingState = "CanUpgrade";
        attrs.item_seen = true;
        attrs.bItemSeen = 1;
        profile.items[key] = { templateId, attributes: attrs, quantity: 1 };
    } else {
        profile.items[key].attributes = profile.items[key].attributes || {};
        profile.items[key].attributes.level = 1;
        profile.items[key].attributes.buildingState = "CanUpgrade";
    }
    req.mcp.dirty = true;
});

otMcp("UpgradeBuilding", async (req, res, profile) => {
    const targetId = req.body && (req.body.targetItemId || req.body.itemId);
    if (!targetId || !profile.items[targetId]) return;
    profile.items[targetId].attributes = profile.items[targetId].attributes || {};
    profile.items[targetId].attributes.level = (profile.items[targetId].attributes.level || 1) + 1;
    req.mcp.dirty = true;
});

otMcp("AssignWorkerToBuilding", async (req, res, profile) => {
    // soft-accept; OT client continues
    req.mcp.dirty = true;
});

otMcp("UpgradeWorker", async (req, res, profile) => {
    const targetId = req.body && (req.body.targetItemId || req.body.itemId);
    if (targetId && profile.items[targetId]) {
        profile.items[targetId].attributes = profile.items[targetId].attributes || {};
        profile.items[targetId].attributes.level = (profile.items[targetId].attributes.level || 1) + 1;
        req.mcp.dirty = true;
    }
});

otMcp("CreateHero", async (req, res, profile) => {
    const templateId = (req.body && req.body.templateId) || "Hero:hid_constructor_base";
    const key = makeId();
    profile.items[key] = {
        templateId,
        attributes: {
            level: (req.body && req.body.maxLevel) ? 50 : 1,
            item_seen: true,
            xp: 0,
            favorite: false
        },
        quantity: 1
    };
    if (!profile.stats.attributes.defaultHeroId) {
        profile.stats.attributes.defaultHeroId = key;
    }
    req.mcp.dirty = true;
});

otMcp("DeleteHero", async (req, res, profile) => {
    const heroId = req.body && req.body.heroId;
    if (heroId && profile.items[heroId]) {
        delete profile.items[heroId];
        if (profile.stats.attributes.defaultHeroId === heroId) {
            profile.stats.attributes.defaultHeroId = "";
        }
        req.mcp.dirty = true;
    }
});

otMcp("SetDefaultHero", async (req, res, profile) => {
    if (req.body && req.body.heroId) {
        profile.stats.attributes.defaultHeroId = req.body.heroId;
        req.mcp.dirty = true;
    }
});

otMcp("SetHeroAbilities", async (req, res, profile) => {
    const heroId = req.body && req.body.heroId;
    if (heroId && profile.items[heroId] && req.body.abilities) {
        profile.items[heroId].attributes = profile.items[heroId].attributes || {};
        profile.items[heroId].attributes.abilities = req.body.abilities;
        req.mcp.dirty = true;
    }
});

otMcp("UpgradeItem", async (req, res, profile) => {
    const targetId = req.body && (req.body.targetItemId || req.body.itemId);
    if (targetId && profile.items[targetId]) {
        profile.items[targetId].attributes = profile.items[targetId].attributes || {};
        profile.items[targetId].attributes.level = (profile.items[targetId].attributes.level || 1) + 1;
        req.mcp.dirty = true;
    }
});

otMcp(["OpenCardPack", "PurchaseCatalogEntry", "ClaimLoginReward", "ClaimQuestReward"], async (req, res, profile) => {
    // Soft success — full profile update so client does not softlock
    req.mcp.dirty = true;
});

// Generic OT client MCP fallback for any other operation (must be registered carefully)
// Only handles OT traffic; calls next() for modern clients so Lawin mcp.js can handle them.
express.post("/fortnite/api/game/v2/profile/:accountId/client/:operation", async (req, res, next) => {
    if (!isOt65(req)) return next();
    // If a more specific otMcp handler already responded, we won't get here for those paths
    // because Express matches more specific routes first... actually same specificity.
    // Specific routes above are registered first so they take precedence.
    try {
        const { accountId, profileId, profile } = loadProfile(req);
        const BaseRevision = profile.rvn || 0;
        console.log("[OT65] generic MCP", req.params.operation, "profileId=", profileId);
        return res.status(200).json(mcpResponse(profile, fullUpdate(profile), BaseRevision));
    } catch (e) {
        console.log("[OT65] generic error", e);
        next();
    }
});

express.post("/fortnite/api/game/v2/profile/:accountId/dedicated_server/:operation", async (req, res, next) => {
    if (!isOt65(req)) return next();
    try {
        const { accountId, profileId, profile } = loadProfile(req);
        const BaseRevision = profile.rvn || 0;
        return res.status(200).json(mcpResponse(profile, fullUpdate(profile), BaseRevision));
    } catch (e) {
        next();
    }
});

// Preload common/game_data if present
try { gameData.loadGameData(); } catch (e) { console.log("[OT65] gameData load", e.message); }

module.exports = express;
module.exports.isOt65 = isOt65;
