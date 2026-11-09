/**
 * Admin console for LawinServer — gift STW items to players.
 *
 * Commands (type in the server window):
 *   gift <username> <templateId> [quantity]
 *   gift <username> hero <heroNameOrTemplate>
 *   gift <username> schematic <name>
 *   gift <username> resource <AccountResource:name> [qty]
 *   notify <username> <message>
 *   accounts
 *   profiles <username>
 *   help
 *   exit  (does not stop the server)
 *
 * Examples:
 *   gift tr1268 Hero:HID_Commando_FoundersM_SR_T01
 *   gift tr1268 hero commando
 *   gift tr1268 CardPack:cardpack_bronze 3
 *   gift LawinServer AccountResource:HeroXP 5000
 */
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

let accountManager;
let functions;

function makeId() {
    try {
        if (functions && functions.MakeID) return functions.MakeID();
    } catch (e) {}
    return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2));
}

function defaultAttrs(templateId) {
    const tid = String(templateId || "");
    const base = {
        max_level_bonus: 0,
        level: 1,
        item_seen: false,
        xp: 0,
        favorite: false
    };
    const lower = tid.toLowerCase();
    if (lower.startsWith("hero:")) {
        return Object.assign(base, {
            gender: 0,
            level: 1,
            outfitvariants: [],
            backblingvariants: [],
            refundable: false
        });
    }
    if (lower.startsWith("schematic:") || lower.startsWith("weapon:")) {
        return Object.assign(base, {
            alterations: ["", "", "", "", "", ""],
            legacy_alterations: [],
            alteration_base_rarities: [],
            refundable: false
        });
    }
    if (lower.startsWith("worker:")) {
        return Object.assign(base, {
            gender: "1",
            squad_slot_idx: -1,
            personality: "",
            squad_id: "",
            slotted_building_id: "",
            building_slot_used: -1,
            set_bonus: ""
        });
    }
    if (lower.startsWith("cardpack:")) {
        return Object.assign(base, {
            pack_source: "Admin",
            level: 1,
            is_loot_tier_overridden: false
        });
    }
    if (lower.startsWith("token:") || lower.startsWith("accountresource:") || lower.startsWith("currency:")) {
        return { level: 1, item_seen: true, xp: 0, favorite: false };
    }
    return base;
}

function resolveAccount(name) {
    const n = String(name || "").trim();
    if (!n) return null;
    let acc = accountManager.findAccount({ username: n });
    if (!acc) acc = accountManager.findAccount({ accountId: n });
    if (!acc) acc = accountManager.findAccount({ email: n });
    return acc;
}

function pickProfileId(templateId) {
    const t = String(templateId).toLowerCase();
    // Cosmetics / mtx often common_core; STW heroes/schematics campaign or profile0
    if (t.startsWith("currency:mtx") || t.startsWith("hometoken:") || t.includes("banner")) return "common_core";
    if (t.startsWith("athen")) return "athena";
    return "campaign";
}

function addItemToProfile(accountId, profileId, templateId, quantity) {
    accountManager.ensureAccountProfiles(accountId);
    let profile = accountManager.readProfile(accountId, profileId);
    if (!profile) {
        // try profile0
        profileId = "profile0";
        profile = accountManager.readProfile(accountId, profileId);
    }
    if (!profile) throw new Error("No profile " + profileId + " for " + accountId);
    if (!profile.items) profile.items = {};

    quantity = Math.max(1, parseInt(quantity, 10) || 1);
    const tid = templateId;

    // Stackable resources/tokens/currency
    const stackable = /^(AccountResource:|Token:|Currency:|Resource:|Ingredient:)/i.test(tid);
    if (stackable) {
        for (const id of Object.keys(profile.items)) {
            if (profile.items[id].templateId === tid) {
                profile.items[id].quantity = (profile.items[id].quantity || 0) + quantity;
                profile.rvn = (profile.rvn || 0) + 1;
                profile.commandRevision = (profile.commandRevision || 0) + 1;
                accountManager.writeProfile(accountId, profileId, profile);
                return { itemId: id, stacked: true, profileId, quantity: profile.items[id].quantity };
            }
        }
    }

    const itemId = makeId();
    profile.items[itemId] = {
        templateId: tid,
        attributes: defaultAttrs(tid),
        quantity: quantity
    };
    profile.rvn = (profile.rvn || 0) + 1;
    profile.commandRevision = (profile.commandRevision || 0) + 1;
    accountManager.writeProfile(accountId, profileId, profile);
    return { itemId, stacked: false, profileId, quantity };
}

/** Simple hero name → templateId helpers (extend as needed) */
function resolveHeroTemplate(name) {
    const n = String(name || "").trim();
    if (!n) return null;
    if (n.toLowerCase().startsWith("hero:")) return n;
    // If looks like HID_...
    if (/^HID_/i.test(n)) return "Hero:" + n;

    const map = {
        "ramirez": "Hero:HID_Commando_Assault_C_T01",
        "commando": "Hero:HID_Commando_Assault_C_T01",
        "soldier": "Hero:HID_Commando_Assault_C_T01",
        "constructor": "Hero:HID_Constructor_FoundersM_SR_T01",
        "ninja": "Hero:HID_Ninja_StarsAssassin_FoundersM_SR_T01",
        "outlander": "Hero:HID_Outlander_FoundersM_SR_T01",
        // common lawin-style ids
        "ranger": "Hero:HID_Commando_008_FoundersM_SR_T05",
        "guardian": "Hero:HID_Constructor_008_FoundersM_SR_T05",
        "assassin": "Hero:HID_Ninja_StarsAssassin_FoundersM_SR_T05",
        "trailblazer": "Hero:HID_Outlander_008_FoundersM_SR_T05"
    };
    const key = n.toLowerCase();
    if (map[key]) return map[key];
    // Pass through as Hero:name
    return "Hero:" + n;
}

function getHostDisplayName() {
    const a = getHostAccount();
    return a.displayName || a.accountId || "SussyServer";
}

function findClientByAccountId(accountId) {
    if (!global.Clients || !Array.isArray(global.Clients)) return null;
    const id = String(accountId || "").toLowerCase();
    return global.Clients.find(c =>
        (c.accountId && String(c.accountId).toLowerCase() === id) ||
        (c.displayName && String(c.displayName).toLowerCase() === id)
    ) || null;
}

function getHostAccount() {
    try {
        const data = accountManager.loadAccounts();
        const prefer = ["SussyServer", "LawinServer"];
        for (const name of prefer) {
            const hit = (data.accounts || []).find(a =>
                (a.displayName && a.displayName.toLowerCase() === name.toLowerCase()) ||
                (a.accountId && a.accountId.toLowerCase() === name.toLowerCase())
            );
            if (hit) return hit;
        }
        if (data.accounts && data.accounts[0]) return data.accounts[0];
    } catch (e) {}
    return { accountId: "SussyServer", displayName: "SussyServer" };
}

/**
 * Fake XMPP "login" for host account (SussyServer) — no Fortnite client required.
 * Registers a virtual client + joins Global rooms so groupchat can be sent as them.
 */
function ensureVirtualHostLogin() {
    const host = getHostAccount();
    const accountId = host.accountId || "SussyServer";
    const displayName = host.displayName || accountId;
    const domain = global.xmppDomain || "prod.ol.epicgames.com";
    const resource = "V2:chat:WIN::serverhost";
    const jid = `${accountId}@${domain}/${resource}`;

    if (!global.Clients) global.Clients = [];
    if (!global.MUCs) global.MUCs = {};

    // Remove old virtual host entries
    global.Clients = global.Clients.filter(c => !(c && c.isVirtualHost));

    // Stub websocket that no-ops sends (host is not a real game client)
    const virtualWs = {
        send: function () {},
        close: function () {},
        readyState: 1
    };

    const virtualClient = {
        accountId,
        displayName,
        token: "virtual-host",
        jid,
        resource,
        client: virtualWs,
        isVirtualHost: true
    };
    global.Clients.push(virtualClient);

    // Join the same public rooms players use for Global chat
    for (const roomName of ["Fortnite", "SaveTheWorld", "Global"]) {
        if (!global.MUCs[roomName]) global.MUCs[roomName] = { members: [] };
        if (!global.MUCs[roomName].members.find(m => m.accountId === accountId)) {
            global.MUCs[roomName].members.push({ accountId });
        }
        // Force every real online player into the room too
        global.Clients.forEach(c => {
            if (!c.accountId || c.isVirtualHost) return;
            if (!global.MUCs[roomName].members.find(m => m.accountId === c.accountId)) {
                global.MUCs[roomName].members.push({ accountId: c.accountId });
            }
        });
    }

    console.log(`[Chat] Virtual host logged in: ${displayName} (${accountId}) jid=${jid}`);
    return virtualClient;
}

function broadcastGlobalChat(message, fromName) {
    const text = String(message || "").trim();
    if (!text) return false;
    const host = getHostAccount();
    const hostName = fromName || host.displayName || host.accountId || "SussyServer";
    const hostId = host.accountId || "SussyServer";

    // Prefer XMPP module helper (real MUC path / same as in-game Global)
    if (typeof global.broadcastSTWGlobalChat === "function") {
        const n = global.broadcastSTWGlobalChat(text, hostName, hostId);
        if (n > 0) {
            console.log(`[Chat] Delivered via XMPP Global as ${hostName}`);
            return true;
        }
        console.log("[Chat] XMPP reported 0 deliveries — is a player in-game with XMPP connected?");
        return false;
    }

    console.log("[Chat] XMPP helper missing — is structure/xmpp.js updated and loaded?");
    return false;
}

function pushQuestCompleteStyle(accountId, title, body) {
    // Persist a lightweight notification file players can see on next profile query if you wire it;
    // primarily logs + optional XMPP.
    const msg = {
        type: "AdminGift",
        title: title || "Item received",
        body: body || "",
        time: new Date().toISOString()
    };
    try {
        if (functions && functions.sendXmppMessageToAll) {
            functions.sendXmppMessageToAll({
                type: "com.epicgames.gift.received",
                payload: msg,
                timestamp: msg.time
            });
        }
    } catch (e) {}
    return msg;
}

function handleLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return;
    const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const args = parts.map(p => p.replace(/^"|"$/g, ""));
    const cmd = (args[0] || "").toLowerCase();

    try {
        if (cmd === "help" || cmd === "?") {
            console.log(`
Admin commands:
  gift <user> <templateId> [qty]     Give any item (Hero:, Schematic:, AccountResource:, ...)
  gift <user> hero <name> [qty]      Give a hero (name or full Hero: id)
  gift <user> schematic <id> [qty]   Give schematic
  gift <user> llama [qty]            Give a basic card pack
  notify <user> <message>            Log/XMPP style notify
  ban <user> [reason]                Ban account (+ HWID) — launcher kicks on next check
  unban <user>                       Remove ban
  message <user|all> <text>          Push overlay message to launcher(s) for 3s
  msg <user|all> <text>              Alias for message
  setdiscord <user> <discordId>      Link Discord snowflake ID to account
  cleardiscord <user>                Remove Discord ID from account
  accounts                           List accounts
  profiles <user>                    List profile files for user
  xp <user> <amount>                 Add XP (levels up as needed)
  level <user> <n>                   Set level directly (no level rewards replayed)
  stars <user> <n>                   Add Battle Stars (starsPerTier stars = +1 level)
  quests <user>                      Show level, stars and quest progress
  completequest <user> <questId>     Force-complete (and claim) an active quest
  resetquests <user>                 Wipe + re-roll this player's quests
  questweek <n>                      Unlock weekly quests up to week n (runtime only)
  help
`);
            return;
        }

        if (cmd === "ban") {
            const name = args[1];
            if (!name) return console.log("Usage: ban <username> [reason]");
            const reason = args.slice(2).join(" ") || "Banned by admin";
            // Re-find to pass existing hwids into ban record
            const prior = resolveAccount(name);
            const existingHwids = (prior && Array.isArray(prior.hwids)) ? prior.hwids : [];
            const result = accountManager.banAccount(name, reason, existingHwids);
            if (!result.ok) return console.log("Ban failed:", result.error);

            const acc = result.account;
            console.log(`BANNED ${acc.displayName} (${acc.accountId}) — reason: ${reason}`);
            console.log("  hwids:", (acc.hwids || []).join(", ") || "(none registered yet — user must login with launcher once)");
            console.log("  Launcher will show ban screen + kill Fortnite on next ban-check / launch.");

            const client = findClientByAccountId(acc.accountId);
            if (client) {
                try {
                    if (client.client && typeof client.client.close === "function") {
                        client.client.close();
                        console.log("  Closed active XMPP/game connection for", acc.displayName);
                    }
                    if (global.Clients) {
                        global.Clients = global.Clients.filter(c => c !== client && c.accountId !== acc.accountId);
                    }
                } catch (e) {
                    console.log("  Kick attempt error:", e.message);
                }
            } else {
                console.log("  (No live game client connected right now)");
            }

            try {
                if (typeof global.onPlayerBanned === "function") {
                    global.onPlayerBanned(acc, reason);
                }
            } catch (e) {}
            return;
        }

        if (cmd === "unban") {
            const name = args[1];
            if (!name) return console.log("Usage: unban <username>");
            const result = accountManager.unbanAccount(name);
            if (!result.ok) return console.log("Unban failed:", result.error);
            console.log(`UNBANNED ${result.account.displayName} (${result.account.accountId})`);
            return;
        }


        if (cmd === "setdiscord" || cmd === "linkdiscord") {
            const name = args[1];
            const discordId = args[2];
            if (!name || !discordId) return console.log("Usage: setdiscord <username> <discordId>");
            const result = accountManager.setDiscordId(name, discordId);
            if (!result.ok) return console.log("Failed:", result.error);
            console.log(`Linked Discord ${discordId} -> ${result.account.displayName} (${result.account.accountId})`);
            return;
        }

        if (cmd === "cleardiscord") {
            const name = args[1];
            if (!name) return console.log("Usage: cleardiscord <username>");
            const result = accountManager.clearDiscordId(name);
            if (!result.ok) return console.log("Failed:", result.error);
            console.log(`Cleared Discord ID for ${result.account.displayName}`);
            return;
        }

        if (cmd === "message" || cmd === "msg") {
            const target = args[1];
            if (!target) return console.log("Usage: message <username|all> <text>");
            const message = args.slice(2).join(" ").trim();
            if (!message) return console.log("Usage: message <username|all> <text>");

            // Store pending launcher messages (in-memory; also exposed via /lawin/check-ban)
            if (!global.launcherMessages) global.launcherMessages = [];
            const entry = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                target: target.toLowerCase() === "all" ? "all" : target,
                message,
                from: "admin",
                createdAt: Date.now(),
                expiresAt: Date.now() + 60000 // keep for up to 60s for slow pollers
            };
            global.launcherMessages.push(entry);
            // prune old
            global.launcherMessages = global.launcherMessages.filter(m => m.expiresAt > Date.now());

            if (target.toLowerCase() === "all") {
                console.log(`MESSAGE (all): ${message}`);
            } else {
                const acc = resolveAccount(target);
                if (!acc) console.log("Note: account not found in DB — message still queued for matching username/HWID");
                else console.log(`MESSAGE -> ${acc.displayName}: ${message}`);
            }
            return;
        }

        if (cmd === "accounts") {
            const data = accountManager.loadAccounts();
            (data.accounts || []).forEach(a => {
                console.log(`  ${a.displayName}  id=${a.accountId}  email=${a.email}`);
            });
            return;
        }

        if (cmd === "profiles") {
            const acc = resolveAccount(args[1]);
            if (!acc) return console.log("Account not found:", args[1]);
            const dir = accountManager.getAccountDir(acc.accountId);
            if (!fs.existsSync(dir)) return console.log("No profile dir:", dir);
            console.log(dir);
            fs.readdirSync(dir).filter(f => f.endsWith(".json")).forEach(f => console.log(" ", f));
            return;
        }

        if (cmd === "notify") {
            const acc = resolveAccount(args[1]);
            if (!acc) return console.log("Account not found:", args[1]);
            const message = args.slice(2).join(" ") || "You received a gift!";
            pushQuestCompleteStyle(acc.accountId, "Notification", message);
            console.log("Notified", acc.displayName, ":", message);
            return;
        }

        if (cmd === "say" || cmd === "announce" || cmd === "broadcast" || cmd === "global") {
            const message = args.slice(1).join(" ");
            if (!message) return console.log("Usage: say <message>");
            const host = getHostDisplayName();
            const ok = broadcastGlobalChat(message, host);
            console.log(ok ? (`Global (${host}): ` + message) : "Failed to broadcast (no XMPP clients?)");
            return;
        }

        
        // ---------- quest / level / battle star ----------
        if (["xp", "level", "stars", "battlestars", "quests", "completequest", "resetquests", "questweek"].includes(cmd)) {
            const qs = require("./questSystem.js");
            const show = (label, r) => {
                if (!r || !r.ok) return console.log("Failed:", (r && r.error) || "unknown error");
                console.log(`OK ${label} -> level ${r.level.from} -> ${r.level.to}, xp ${r.xp.current}/${r.xp.toNext}, ` +
                    `stars ${r.battleStars.total} (+${r.battleStars.gained}, ${r.battleStars.towardNextTier}/${r.battleStars.starsPerTier} to next tier)`);
            };

            if (cmd === "questweek") {
                const n = parseInt(args[1], 10);
                if (!n) return console.log("Usage: questweek <1-10>");
                return console.log("Weekly quests unlocked up to week", qs.setCurrentWeek(n), "(applies on each player's next login / match)");
            }

            const acc = resolveAccount(args[1]);
            if (!acc) return console.log("Account not found:", args[1]);
            const n = parseInt(args[2], 10);

            if (cmd === "xp") {
                if (!n) return console.log("Usage: xp <user> <amount>");
                return show(`+${n} xp to ${acc.displayName}`, qs.addXp(acc.accountId, n));
            }
            if (cmd === "level") {
                if (!n) return console.log("Usage: level <user> <n>");
                return show(`${acc.displayName} set to level ${n}`, qs.setLevel(acc.accountId, n));
            }
            if (cmd === "stars" || cmd === "battlestars") {
                if (!n) return console.log("Usage: stars <user> <n>");
                return show(`+${n} battle stars to ${acc.displayName}`, qs.addStars(acc.accountId, n));
            }
            if (cmd === "resetquests") {
                return show(`quests reset for ${acc.displayName}`, qs.resetQuests(acc.accountId));
            }
            if (cmd === "completequest") {
                if (!args[2]) return console.log("Usage: completequest <user> <questId>");
                return show(`completed ${args[2]} for ${acc.displayName}`, qs.completeQuest(acc.accountId, args[2]));
            }
            // quests <user>
            const r = qs.summary(acc.accountId);
            if (!r.ok) return console.log("Failed:", r.error);
            console.log(`${r.displayName}: level ${r.level}/${r.maxLevel}  xp ${r.xp}/${r.xpToNext}  ` +
                `stars ${r.battleStars.total} (${r.battleStars.towardNextTier}/${r.battleStars.starsPerTier})  ` +
                `hidden stars [${r.battleStars.hiddenCollected.join(",")}]  matches ${r.matches}  wins ${r.lifetimeWins}`);
            for (const q of r.quests) {
                const prog = q.objectives.map((o) => `${o.progress}/${o.count}`).join(" ");
                console.log(`  [${q.state.padEnd(9)}] ${q.type.padEnd(6)} ${q.id.padEnd(20)} ${prog.padEnd(9)} ${q.name}`);
            }
            return;
        }

        if (cmd === "points" || cmd === "skillpoints" || cmd === "hbpoints") {
            const acc = resolveAccount(args[1]);
            if (!acc) return console.log("Account not found:", args[1]);
            const qty = parseInt(args[2], 10) || 10;
            const result = addItemToProfile(acc.accountId, "campaign", "Token:homebasepoints", qty);
            try { addItemToProfile(acc.accountId, "profile0", "Token:homebasepoints", qty); } catch (e) {}
            console.log(`OK ${qty} skill points (Token:homebasepoints) -> ${acc.displayName}`);
            return;
        }

        if (cmd === "gift" || cmd === "give") {
            const acc = resolveAccount(args[1]);
            if (!acc) return console.log("Account not found:", args[1]);

            let templateId;
            let qty = 1;
            const kind = (args[2] || "").toLowerCase();

            if (kind === "hero") {
                templateId = resolveHeroTemplate(args[3]);
                qty = parseInt(args[4], 10) || 1;
            } else if (kind === "schematic") {
                templateId = args[3];
                if (templateId && !templateId.includes(":")) templateId = "Schematic:" + templateId;
                qty = parseInt(args[4], 10) || 1;
            } else if (kind === "llama" || kind === "cardpack") {
                templateId = args[3] && args[3].includes(":") ? args[3] : "CardPack:cardpack_bronze";
                qty = parseInt(args[3] && !args[3].includes(":") ? args[3] : args[4], 10) || 1;
            } else if (kind === "resource") {
                templateId = args[3];
                if (templateId && !templateId.includes(":")) templateId = "AccountResource:" + templateId;
                qty = parseInt(args[4], 10) || 1;
            } else {
                templateId = args[2];
                qty = parseInt(args[3], 10) || 1;
            }

            if (!templateId) return console.log("Usage: gift <user> <templateId> [qty]");

            const profileId = pickProfileId(templateId);
            const result = addItemToProfile(acc.accountId, profileId, templateId, qty);
            pushQuestCompleteStyle(
                acc.accountId,
                "Quest complete",
                `You received ${qty}x ${templateId}`
            );
            console.log(
                `OK gifted ${qty}x ${templateId} -> ${acc.displayName} (${result.profileId}` +
                `${result.stacked ? ", stacked" : ", new item " + result.itemId})`
            );
            console.log("  Player may need to re-open inventory / relog for it to show.");
            return;
        }

        if (cmd === "exit" || cmd === "quit") {
            console.log("Console closed (server still running).");
            if (rl) rl.close();
            return;
        }

        console.log("Unknown command. Type help");
    } catch (e) {
        console.log("Error:", e.message || e);
    }
}

let rl = null;

function start() {
    try {
        accountManager = require("./accountManager.js");
        functions = require("./functions.js");
    } catch (e) {
        console.log("[AdminConsole] failed to load deps:", e.message);
        return;
    }

    if (!process.stdin.isTTY) {
        console.log("[AdminConsole] stdin is not a TTY — console disabled (still OK in background).");
        return;
    }

    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "lawin> "
    });

    console.log("[AdminConsole] Ready. Type help for commands.");
    rl.prompt();
    rl.on("line", (line) => {
        handleLine(line);
        if (rl) rl.prompt();
    });
    rl.on("close", () => {
        // do not exit process
    });
}

module.exports = { start, handleLine, addItemToProfile, resolveAccount };
