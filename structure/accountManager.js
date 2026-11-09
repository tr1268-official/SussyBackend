const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ACCOUNTS_FILE = path.join(__dirname, "..", "Config", "accounts.json");
const TEMPLATES_DIR = path.join(__dirname, "..", "profiles");
const ACCOUNTS_PROFILES_DIR = path.join(__dirname, "..", "profiles", "accounts");
const FRIENDS_DIR = path.join(__dirname, "..", "Config", "friends");

function ensureDirs() {
    if (!fs.existsSync(path.dirname(ACCOUNTS_FILE))) fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
    if (!fs.existsSync(ACCOUNTS_PROFILES_DIR)) fs.mkdirSync(ACCOUNTS_PROFILES_DIR, { recursive: true });
    if (!fs.existsSync(FRIENDS_DIR)) fs.mkdirSync(FRIENDS_DIR, { recursive: true });
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: [] }, null, 2));
    }
}

function loadAccounts() {
    ensureDirs();
    try {
        return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    } catch {
        return { accounts: [] };
    }
}

function saveAccounts(data) {
    ensureDirs();
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}

function sanitizeAccountId(id) {
    if (id == null) return "";
    let s = String(id).trim();

    // Game server often sends a fixed-width zero-padded hex of the *lowercase* account string
    // e.g. "tr1268_v2" → "0000007472313236385F763200"
    if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 8 && s.length % 2 === 0) {
        try {
            const decoded = Buffer.from(s, "hex")
                .toString("utf8")
                .replace(/\0/g, "")   // strip padding nulls
                .trim();
            // Only accept if it looks like a real account id
            if (decoded && /^[a-zA-Z0-9_@.\-]+$/.test(decoded)) {
                s = decoded;
            }
        } catch (_) {
            // keep original hex string if decode fails
        }
    }

    // strip email domain if present
    if (s.includes("@")) s = s.split("@")[0];

    // ALWAYS lowercase — this is what the game server hex-encodes
    return s.toLowerCase();
}

function findAccount({ email, username, accountId, discordId }) {
    const data = loadAccounts();
    const cleanId = accountId != null ? sanitizeAccountId(accountId) : null;
    const cleanUser = username != null ? String(username).toLowerCase() : null;
    const cleanEmail = email != null ? String(email).toLowerCase() : null;

    return data.accounts.find(a => {
        // match by accountId (handles both plain + hex forms because of sanitize)
        if (cleanId && a.accountId === cleanId) return true;

        if (cleanEmail && a.email && a.email.toLowerCase() === cleanEmail) return true;

        if (cleanUser && a.displayName && a.displayName.toLowerCase() === cleanUser) return true;
        if (cleanUser && a.email && a.email.toLowerCase() === cleanUser) return true;
        if (cleanUser && a.accountId && a.accountId === cleanUser) return true;

        if (discordId && a.discordId && String(a.discordId) === String(discordId)) return true;

        return false;
    }) || null;
}

function getAccountDir(accountId) {
    return path.join(ACCOUNTS_PROFILES_DIR, sanitizeAccountId(accountId));
}

function listTemplateProfiles() {
    if (!fs.existsSync(TEMPLATES_DIR)) return [];
    return fs.readdirSync(TEMPLATES_DIR).filter(f => {
        const full = path.join(TEMPLATES_DIR, f);
        try {
            return f.endsWith(".json") && fs.statSync(full).isFile();
        } catch {
            return false;
        }
    });
}

function ensureAccountProfiles(accountId) {
    accountId = sanitizeAccountId(accountId);
    const dir = getAccountDir(accountId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    for (const file of listTemplateProfiles()) {
        const dest = path.join(dir, file);
        if (fs.existsSync(dest)) continue;
        const src = path.join(TEMPLATES_DIR, file);
        try {
            const profile = JSON.parse(fs.readFileSync(src, "utf8"));
            profile.accountId = accountId;
            profile.created = profile.created || new Date().toISOString();
            profile.updated = new Date().toISOString();
            fs.writeFileSync(dest, JSON.stringify(profile, null, 2));
        } catch (e) {
            console.log("[Accounts] Failed to copy template", file, e.message);
        }
    }
    ensureFriends(accountId);
    return dir;
}

function ensureShape(profile) {
    if (!profile) return profile;
    if (!profile.rvn) profile.rvn = 0;
    if (!profile.items) profile.items = {};
    if (!profile.stats) profile.stats = {};
    if (!profile.stats.attributes) profile.stats.attributes = {};
    if (!profile.commandRevision) profile.commandRevision = 0;
    return profile;
}

function enrichPublicStwFields(accountId, profileId, profile) {
    if (!profile) return profile;
    if (!profile.stats) profile.stats = {};
    if (!profile.stats.attributes) profile.stats.attributes = {};
    const attrs = profile.stats.attributes;
    const acc = findAccount({ accountId }) || { displayName: accountId };
    const displayName = (acc && acc.displayName) || accountId;

    // Always set accountId on profile for public queries
    profile.accountId = accountId;
    profile.profileId = profileId;

    if (profileId === "common_public") {
        // Prefer existing values, else defaults + display name
        if (!attrs.homebase_name || attrs.homebase_name === "") {
            attrs.homebase_name = displayName;
        }
        if (!attrs.banner_icon || attrs.banner_icon === "") {
            attrs.banner_icon = "StandardBanner1";
        }
        if (!attrs.banner_color || attrs.banner_color === "") {
            attrs.banner_color = "DefaultColor1";
        }
    }

    if (profileId === "profile0") {
        if (!attrs.homebase || typeof attrs.homebase !== "object") {
            attrs.homebase = {
                townName: displayName,
                bannerIconId: "StandardBanner1",
                bannerColorId: "DefaultColor1",
                flagPattern: -1,
                flagColor: -1
            };
        } else {
            if (!attrs.homebase.townName) attrs.homebase.townName = displayName;
            if (!attrs.homebase.bannerIconId) attrs.homebase.bannerIconId = "StandardBanner1";
            if (!attrs.homebase.bannerColorId) attrs.homebase.bannerColorId = "DefaultColor1";
        }
    }

    if (profileId === "campaign" || profileId === "profile0") {
        if (!attrs.research_levels || typeof attrs.research_levels !== "object") {
            attrs.research_levels = { fortitude: 1, offense: 1, resistance: 1, technology: 1 };
        }
        const rl = attrs.research_levels;
        for (const k of ["fortitude", "offense", "resistance", "technology"]) {
            if (rl[k] === undefined || rl[k] === null) rl[k] = 1;
            // Mirror onto top-level attrs — STW party cards often read these
            if (attrs[k] === undefined || attrs[k] === null) attrs[k] = rl[k];
        }
        if (attrs.level === undefined || attrs.level === null) attrs.level = 1;
        if (attrs.xp === undefined || attrs.xp === null) attrs.xp = 0;
    }

    return profile;
}

/** Public STW snapshot used by party UI / presence */
function getStwPublicInfo(accountId) {
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);
    const acc = findAccount({ accountId }) || { displayName: accountId };
    let pub = null;
    let camp = null;
    try { pub = readProfile(accountId, "common_public"); } catch (e) {}
    try { camp = readProfile(accountId, "campaign"); } catch (e) {}
    const pa = (pub && pub.stats && pub.stats.attributes) || {};
    const ca = (camp && camp.stats && camp.stats.attributes) || {};
    const rl = ca.research_levels || { fortitude: 1, offense: 1, resistance: 1, technology: 1 };
    return {
        accountId,
        displayName: acc.displayName || accountId,
        homebase_name: pa.homebase_name || acc.displayName || accountId,
        banner_icon: pa.banner_icon || "StandardBanner1",
        banner_color: pa.banner_color || "DefaultColor1",
        level: ca.level || 1,
        fortitude: rl.fortitude || ca.fortitude || 1,
        offense: rl.offense || ca.offense || 1,
        resistance: rl.resistance || ca.resistance || 1,
        technology: rl.technology || ca.technology || 1
    };
}

function readProfile(accountId, profileId) {
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);
    const file = path.join(getAccountDir(accountId), `${profileId}.json`);
    if (!fs.existsSync(file)) {
        ensureAccountProfiles(accountId);
    }
    if (!fs.existsSync(file)) return null;
    let profile = ensureShape(JSON.parse(fs.readFileSync(file, "utf8")));
    profile.accountId = accountId;
    return enrichPublicStwFields(accountId, profileId, profile);
}

function writeProfile(accountId, profileId, profile) {
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);
    const file = path.join(getAccountDir(accountId), `${profileId}.json`);
    profile.accountId = accountId;
    profile.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
}

function friendsPath(accountId) {
    return path.join(FRIENDS_DIR, `${sanitizeAccountId(accountId)}.json`);
}

function ensureFriends(accountId) {
    accountId = sanitizeAccountId(accountId);
    ensureDirs();
    const fp = friendsPath(accountId);
    if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp, JSON.stringify({
            accountId,
            list: { accepted: [], incoming: [], outgoing: [], blocked: [] }
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(fp, "utf8"));
}

function saveFriends(accountId, data) {
    ensureDirs();
    fs.writeFileSync(friendsPath(accountId), JSON.stringify(data, null, 2));
}

function createAccount(email, displayName, password, discordId) {
    ensureDirs();
    const data = loadAccounts();
    email = (email || displayName || "user").toLowerCase();
    displayName = displayName || email.split("@")[0];
    if (data.accounts.find(a => a.email === email || a.displayName.toLowerCase() === displayName.toLowerCase())) {
        return { error: "Account already exists" };
    }
    // Optional: reject if this Discord ID is already linked to another account
    const discord = discordId ? String(discordId).trim() : "";
    if (discord) {
        const taken = data.accounts.find(a => a.discordId && String(a.discordId) === discord);
        if (taken) return { error: "Discord ID already linked to another account" };
    }
    let accountId = sanitizeAccountId(displayName);
    let n = 1;
    while (data.accounts.find(a => a.accountId === accountId)) {
        accountId = sanitizeAccountId(displayName) + (n++);
    }
    const account = {
        accountId,
        email,
        displayName,
        password: String(password || "password"),
        discordId: discord || null,
        created: new Date().toISOString()
    };
    data.accounts.push(account);
    saveAccounts(data);
    ensureAccountProfiles(accountId);
    ensureFriends(accountId);
    try { ensureStarterWorkers(accountId); } catch (e) {}
    try { ensureDefaultHero(accountId); } catch (e) {}
    try {
        ensureOt65Profiles(accountId);
    } catch (e) {
        console.log("[OT65] ensure on create failed:", e.message);
    }
    try {
        const questManager = require("./questManager.js");
        // Initialize quest progress for account
        questManager.handleQuestProgress(account.accountId, "play_matches", 0);
    } catch (e) {
        console.log("[Quests] ensure failed:", e.message);
    }
    return { account };
}

function validateLogin(usernameOrEmail, password) {
    const data = loadAccounts();
    const u = String(usernameOrEmail || "").toLowerCase();
    let account = data.accounts.find(a =>
        (a.email && a.email.toLowerCase() === u) ||
        (a.displayName && a.displayName.toLowerCase() === u) ||
        (a.accountId && a.accountId.toLowerCase() === u)
    );
    // Do NOT auto-create on login — banned players were evading by new accounts.
    // Use POST /lawin/create-account to register.
    if (!account) {
        return null;
    }
    if (account.password && String(password || "") !== String(account.password)) {
        return null;
    }
    ensureAccountProfiles(account.accountId);
    ensureFriends(account.accountId);
    try { ensureStarterWorkers(account.accountId); } catch (e) {}
    try { ensureDefaultHero(account.accountId); } catch (e) {}
    try { ensureSkillPoints(account.accountId, 10); } catch (e) {}
    try { ensureSkillTreeTiers(account.accountId, 15); } catch (e) {}
    // Create OT6.5 progression folder if missing (same account, separate profiles)
    try {
        ensureOt65Profiles(account.accountId);
    } catch (e) {
        console.log("[OT65] ensure on login failed:", e.message);
    }
    try {
        const questManager = require("./questManager.js");
        // Initialize quest progress for account
        questManager.handleQuestProgress(account.accountId, "play_matches", 0);
    } catch (e) {
        console.log("[Quests] ensure failed:", e.message);
    }
    return account;
}

function tokenFor(account) {
    return Buffer.from(`lawin:${account.accountId}:${account.displayName}`).toString("base64");
}

function accountFromToken(token) {
    if (!token) return null;
    token = String(token).replace(/^bearer\s+/i, "");
    try {
        const raw = Buffer.from(token, "base64").toString("utf8");
        if (raw.startsWith("lawin:")) {
            const parts = raw.split(":");
            const accountId = parts[1];
            const acc = findAccount({ accountId });
            if (acc) return acc;
            return { accountId, displayName: parts[2] || accountId, email: `${accountId}@Frost.dev` };
        }
    } catch {}
    return null;
}

function accountIdFromRequest(req) {
    const url = req.originalUrl || req.url || "";
    let m = url.match(/\/profile\/([^\/\?]+)\/(client|dedicated_server)/i);
    if (m) return sanitizeAccountId(decodeURIComponent(m[1]));
    if (req.params) {
        const p = req.params.accountId || req.params[0] || req.params["0"];
        if (p && String(p).length > 0 && String(p) !== "client") {
            return sanitizeAccountId(String(p).split("/")[0]);
        }
    }
    const auth = req.headers["authorization"] || req.headers["Authorization"];
    if (auth) {
        const acc = accountFromToken(auth);
        if (acc) return sanitizeAccountId(acc.accountId);
    }
    return "default";
}


// --- OT6.5 separate progression (same account / friends) ---
const OT65_TEMPLATES_DIR = path.join(__dirname, "..", "profiles", "ot65");

function getOt65Dir(accountId) {
    // profiles/accounts/<id>/ot/  — same account folder, separate progression
    return path.join(getAccountDir(accountId), "ot");
}

function ensureOt65Profiles(accountId) {
    accountId = sanitizeAccountId(accountId);
    const dir = getOt65Dir(accountId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const files = fs.existsSync(OT65_TEMPLATES_DIR)
        ? fs.readdirSync(OT65_TEMPLATES_DIR).filter(f => f.endsWith(".json"))
        : ["profile0.json", "theater0.json"];
    for (const file of files) {
        const dest = path.join(dir, file);
        if (fs.existsSync(dest)) continue;
        const src = path.join(OT65_TEMPLATES_DIR, file);
        if (!fs.existsSync(src)) continue;
        try {
            const profile = JSON.parse(fs.readFileSync(src, "utf8"));
            profile.accountId = accountId;
            profile.created = profile.created || new Date().toISOString();
            profile.updated = new Date().toISOString();
            // Seed buildings/resources from Fortify game_data if present (profile0 only)
            if (file === "profile0.json") {
                try {
                    const gd = require("./ot65GameData.js");
                    gd.loadGameData();
                    if (gd.isReady()) {
                        const addAll = (type, qty) => {
                            for (const item of gd.getAllItems(type)) {
                                const tid = item.templateId;
                                if (Object.values(profile.items).some(i => i.templateId === tid)) continue;
                                const attrs = gd.generateAttributes(tid);
                                if (type === "MyFortBuilding" || item.prefix === "MyFortBuilding") {
                                    attrs.buildingState = "CanBuild";
                                    if (item.Name === "Building_CommandCenter") {
                                        attrs.level = 1;
                                        attrs.buildingState = "Idle";
                                    }
                                }
                                const id = require("crypto").randomUUID ? require("crypto").randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2));
                                profile.items[id] = { templateId: tid, attributes: attrs, quantity: qty };
                            }
                        };
                        addAll("MyFortBuilding", 1);
                        addAll("Currency", 100000);
                        addAll("AccountResource", 100000);
                        addAll("Resource", 100000);
                        // schematics optional — can be heavy; skip full dump for stability
                        console.log("[OT65] seeded profile0 for", accountId, "items:", Object.keys(profile.items).length);
                    }
                } catch (e) {
                    console.log("[OT65] seed game_data skipped:", e.message);
                }
            }
            fs.writeFileSync(dest, JSON.stringify(profile, null, 2));
        } catch (e) {
            console.log("[OT65] template copy failed", file, e.message);
        }
    }
    return dir;
}

function readOt65Profile(accountId, profileId) {
    accountId = sanitizeAccountId(accountId);
    ensureOt65Profiles(accountId);
    const file = path.join(getOt65Dir(accountId), `${profileId}.json`);
    if (!fs.existsSync(file)) {
        // create empty shell
        const shell = {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            rvn: 1,
            wipeNumber: 1,
            accountId,
            profileId,
            version: "ot65",
            items: {},
            stats: { templateId: "profile_v2", attributes: { level: 1, xp: 0 } },
            commandRevision: 1
        };
        fs.writeFileSync(file, JSON.stringify(shell, null, 2));
        return shell;
    }
    let profile = ensureShape(JSON.parse(fs.readFileSync(file, "utf8")));
    profile.accountId = accountId;
    profile.profileId = profileId;
    if (profileId === "profile0") {
        const acc = findAccount({ accountId }) || { displayName: accountId };
        if (!profile.stats) profile.stats = { attributes: {} };
        if (!profile.stats.attributes) profile.stats.attributes = {};
        if (!profile.stats.attributes.homebase) {
            profile.stats.attributes.homebase = { townName: acc.displayName || accountId, flagPattern: 0, flagColor: 0.5 };
        } else if (!profile.stats.attributes.homebase.townName) {
            profile.stats.attributes.homebase.townName = acc.displayName || accountId;
        }
    }
    return profile;
}

function writeOt65Profile(accountId, profileId, profile) {
    accountId = sanitizeAccountId(accountId);
    ensureOt65Profiles(accountId);
    profile.accountId = accountId;
    profile.profileId = profileId;
    profile.updated = new Date().toISOString();
    fs.writeFileSync(path.join(getOt65Dir(accountId), `${profileId}.json`), JSON.stringify(profile, null, 2));
}






function ensureSkillTreeTiers(accountId, tiers) {
    tiers = typeof tiers === "number" ? tiers : 15;
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);

    // Full Tier-1 homebase skill tree nodes (Main + Research)
    let t1Nodes = [];
    try {
        const listPath = path.join(__dirname, "..", "responses", "t1_skill_nodes.json");
        const altPath = path.join(__dirname, "t1_skill_nodes.json");
        const fs = require("fs");
        if (fs.existsSync(listPath)) t1Nodes = JSON.parse(fs.readFileSync(listPath, "utf8"));
        else if (fs.existsSync(altPath)) t1Nodes = JSON.parse(fs.readFileSync(altPath, "utf8"));
    } catch (e) {}

    for (const profileId of ["campaign", "profile0"]) {
        let profile = readProfile(accountId, profileId);
        if (!profile) continue;
        if (!profile.items) profile.items = {};
        if (!profile.stats) profile.stats = { attributes: {} };
        if (!profile.stats.attributes) profile.stats.attributes = {};
        const attrs = profile.stats.attributes;

        attrs.research_levels = {
            fortitude: tiers,
            offense: tiers,
            resistance: tiers,
            technology: tiers
        };
        attrs.fortitude = Math.max(Number(attrs.fortitude) || 0, tiers);
        attrs.offense = Math.max(Number(attrs.offense) || 0, tiers);
        attrs.resistance = Math.max(Number(attrs.resistance) || 0, tiers);
        attrs.technology = Math.max(Number(attrs.technology) || 0, tiers);
        if (!attrs.level || attrs.level < tiers) attrs.level = tiers;

        // Grant every Tier-1 skill tree node if missing
        const have = new Set();
        for (const item of Object.values(profile.items)) {
            if (item && item.templateId) have.add(String(item.templateId));
        }
        const crypto = require("crypto");
        let added = 0;
        for (const tid of t1Nodes) {
            if (have.has(tid)) continue;
            const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2) + added);
            profile.items[id] = {
                templateId: tid,
                attributes: { item_seen: true, level: 1, xp: 0, favorite: false, max_level_bonus: 0 },
                quantity: 1
            };
            added++;
        }

        if (!attrs.node_costs || typeof attrs.node_costs !== "object") attrs.node_costs = {};
        attrs.node_costs.t1_main_nodepage_layer1 = { "Token:homebasepoints": 0 };
        attrs.node_costs.homebase_node_default_page = { "Token:homebasepoints": 0 };
        attrs.node_costs.research_node_default_page = { "Token:collectionresource_nodegatetoken01": 0 };

        writeProfile(accountId, profileId, profile);
        if (added) console.log("[Accounts] granted", added, "T1 skill nodes on", profileId, accountId);
    }
}

function ensureSkillPoints(accountId, amount) {
    amount = typeof amount === "number" ? amount : 10;
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);
    for (const profileId of ["campaign", "profile0"]) {
        let profile = readProfile(accountId, profileId);
        if (!profile || !profile.items) continue;
        let found = null;
        for (const [id, item] of Object.entries(profile.items)) {
            if (item && String(item.templateId || "").toLowerCase() === "token:homebasepoints") {
                found = id;
                break;
            }
        }
        if (found) {
            // Only top up if below amount (don't wipe higher balances)
            const q = profile.items[found].quantity || 0;
            if (q < amount) profile.items[found].quantity = amount;
        } else {
            const crypto = require("crypto");
            const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2));
            profile.items[id] = {
                templateId: "Token:homebasepoints",
                attributes: { level: 1, item_seen: true, xp: 0, favorite: false },
                quantity: amount
            };
        }
        writeProfile(accountId, profileId, profile);
    }
}

function ensureDefaultHero(accountId) {
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);
    const RAMIREZ = "Hero:HID_Commando_Assault_C_T01";
    const LOADOUT_ID = "CampaignHeroLoadout1";
    const makeId = () => crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2));

    for (const profileId of ["campaign", "profile0"]) {
        let profile = readProfile(accountId, profileId);
        if (!profile || !profile.items) continue;
        if (!profile.stats) profile.stats = { attributes: {} };
        if (!profile.stats.attributes) profile.stats.attributes = {};
        const attrs = profile.stats.attributes;
        let changed = false;

        function isHeroItem(item) {
            return item && String(item.templateId || "").toLowerCase().startsWith("hero:");
        }
        function looksLikeGuid(id) {
            return id && !String(id).includes(":") && String(id).length >= 8;
        }

        let heroId = null;
        const preferredLoadoutKey = attrs.selected_hero_loadout || attrs.last_applied_loadout || LOADOUT_ID;
        const preferredLoadout = profile.items[preferredLoadoutKey];
        if (preferredLoadout && preferredLoadout.attributes && preferredLoadout.attributes.crew_members) {
            const slot = preferredLoadout.attributes.crew_members.commanderslot
                || preferredLoadout.attributes.crew_members.command_slot
                || "";
            if (slot && looksLikeGuid(slot) && isHeroItem(profile.items[slot])) {
                heroId = slot;
            }
        }
        if (!heroId && attrs.defaultHeroId && looksLikeGuid(attrs.defaultHeroId) && isHeroItem(profile.items[attrs.defaultHeroId])) {
            heroId = attrs.defaultHeroId;
        }
        if (!heroId) {
            for (const [id, item] of Object.entries(profile.items)) {
                if (looksLikeGuid(id) && isHeroItem(item)) {
                    heroId = id;
                    break;
                }
            }
        }
        if (!heroId) {
            for (const [id, item] of Object.entries(profile.items)) {
                if (isHeroItem(item)) {
                    heroId = id;
                    break;
                }
            }
        }

        if (!heroId) {
            heroId = makeId();
            profile.items[heroId] = {
                templateId: RAMIREZ,
                attributes: {
                    gender: 1,
                    level: 1,
                    item_seen: true,
                    max_level_bonus: 0,
                    xp: 0,
                    favorite: false,
                    outfitvariants: [],
                    backblingvariants: [],
                    refundable: false,
                    squad_id: "",
                    squad_slot_idx: -1
                },
                quantity: 1
            };
            changed = true;
            console.log("[Accounts] added default Ramirez", accountId, profileId);
        }

        // Migrate templateId-as-key heroes to GUID keys (fixes broken commanderslot)
        if (heroId && !looksLikeGuid(heroId) && isHeroItem(profile.items[heroId])) {
            const old = profile.items[heroId];
            const newId = makeId();
            profile.items[newId] = old;
            delete profile.items[heroId];
            for (const item of Object.values(profile.items)) {
                if (!item || !item.attributes || !item.attributes.crew_members) continue;
                const cm = item.attributes.crew_members;
                if (cm.commanderslot === heroId) cm.commanderslot = newId;
                if (cm.command_slot === heroId) cm.command_slot = newId;
            }
            if (attrs.defaultHeroId === heroId) attrs.defaultHeroId = newId;
            heroId = newId;
            changed = true;
            console.log("[Accounts] migrated hero key to GUID", accountId, profileId);
        }

        let loadout = profile.items[LOADOUT_ID];
        if (!loadout || !String(loadout.templateId || "").toLowerCase().includes("heroloadout")) {
            profile.items[LOADOUT_ID] = {
                templateId: "CampaignHeroLoadout:loadouthero",
                attributes: {
                    team_perk: "",
                    loadout_name: "Default",
                    crew_members: {
                        followerslot1: "",
                        followerslot2: "",
                        followerslot3: "",
                        followerslot4: "",
                        followerslot5: "",
                        commanderslot: heroId
                    },
                    gadgets: ["", ""]
                },
                quantity: 1
            };
            changed = true;
        } else {
            loadout.attributes = loadout.attributes || {};
            loadout.attributes.crew_members = loadout.attributes.crew_members || {
                followerslot1: "", followerslot2: "", followerslot3: "",
                followerslot4: "", followerslot5: "", commanderslot: ""
            };
            const cm = loadout.attributes.crew_members;
            if (cm.command_slot && !cm.commanderslot) {
                cm.commanderslot = cm.command_slot;
                changed = true;
            }
            if (!cm.commanderslot || cm.commanderslot === "" || !profile.items[cm.commanderslot]) {
                cm.commanderslot = heroId;
                changed = true;
            }
        }

        if (!attrs.selected_hero_loadout) {
            attrs.selected_hero_loadout = preferredLoadoutKey || LOADOUT_ID;
            changed = true;
        }
        if (!attrs.last_applied_loadout) {
            attrs.last_applied_loadout = attrs.selected_hero_loadout || LOADOUT_ID;
            changed = true;
        }
        if (attrs.hero_slots_unlocked == null) { attrs.hero_slots_unlocked = 1; changed = true; }
        if (attrs.unlocked_hero_slots == null) { attrs.unlocked_hero_slots = 1; changed = true; }
        if (attrs.primary_hero_unlocked == null) { attrs.primary_hero_unlocked = true; changed = true; }
        if (attrs.tutorial_completed == null) { attrs.tutorial_completed = true; changed = true; }
        if (attrs.has_completed_tutorial == null) { attrs.has_completed_tutorial = true; changed = true; }
        if (!Array.isArray(attrs.loadouts)) {
            attrs.loadouts = [attrs.selected_hero_loadout || LOADOUT_ID];
            changed = true;
        }
        if (!attrs.defaultHeroId) {
            attrs.defaultHeroId = heroId;
            changed = true;
        }
        if (attrs.default_hero_squad_id == null) attrs.default_hero_squad_id = "";

        if (changed) {
            writeProfile(accountId, profileId, profile);
            console.log("[Accounts] hero loadout ensured", accountId, profileId, "hero=", heroId);
        }
    }
}

function ensureStarterWorkers(accountId) {
    accountId = sanitizeAccountId(accountId);
    ensureAccountProfiles(accountId);
    let profile = readProfile(accountId, "campaign");
    if (!profile || !profile.items) return;
    const hasWorker = Object.values(profile.items).some(i => i && String(i.templateId || "").startsWith("Worker:"));
    if (hasWorker) return;
    const crypto = require("crypto");
    const starters = [
        ["Worker:workerbasic_c_t01", "1"],
        ["Worker:workerbasic_c_t01", "2"],
        ["Worker:workerbasic_uc_t01", "1"],
        ["Worker:workerbasic_uc_t01", "2"],
        ["Worker:workerbasic_r_t01", "1"],
        ["Worker:workerbasic_r_t01", "2"],
        ["Worker:managersoldier_c_t01", "1"],
        ["Worker:managertrainer_uc_t01", "2"]
    ];
    for (const [tid, gender] of starters) {
        const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2));
        profile.items[id] = {
            templateId: tid,
            attributes: {
                gender, level: 1, item_seen: true, squad_slot_idx: -1,
                max_level_bonus: 0, personality: "", squad_id: "", xp: 0,
                slotted_building_id: "", building_slot_used: -1, favorite: false
            },
            quantity: 1
        };
    }
    writeProfile(accountId, "campaign", profile);
    console.log("[Accounts] seeded starter workers for squads:", accountId);
}


function setDiscordId(usernameOrId, discordId) {
    const data = loadAccounts();
    const acc = findAccount({ username: usernameOrId }) ||
                findAccount({ accountId: usernameOrId }) ||
                findAccount({ email: usernameOrId });
    if (!acc) return { ok: false, error: "Account not found" };

    const discord = discordId ? String(discordId).trim() : "";
    if (discord) {
        const taken = data.accounts.find(a =>
            a.discordId && String(a.discordId) === discord && a.accountId !== acc.accountId
        );
        if (taken) return { ok: false, error: "Discord ID already linked to another account" };
    }

    const target = data.accounts.find(a => a.accountId === acc.accountId);
    if (!target) return { ok: false, error: "Account not found" };
    target.discordId = discord || null;
    saveAccounts(data);
    return { ok: true, account: target };
}

function clearDiscordId(usernameOrId) {
    return setDiscordId(usernameOrId, null);
}

// ---------- Ban system ----------
function banAccount(usernameOrId, reason, hwid) {
    const data = loadAccounts();
    const acc = findAccount({ username: usernameOrId }) ||
                findAccount({ accountId: usernameOrId }) ||
                findAccount({ email: usernameOrId });
    if (!acc) return { ok: false, error: "Account not found" };

    const target = data.accounts.find(a => a.accountId === acc.accountId);
    if (!target) return { ok: false, error: "Account not found" };

    target.banned = true;
    target.banReason = reason || "Banned by admin";
    target.bannedAt = new Date().toISOString();
    if (!Array.isArray(target.hwids)) target.hwids = [];
    // Accept single hwid or array
    const extra = Array.isArray(hwid) ? hwid : (hwid ? [hwid] : []);
    for (const h of extra) {
        const n = normalizeHwid(h);
        if (n && !target.hwids.includes(n)) target.hwids.push(n);
    }

    saveAccounts(data);
    console.log("[Ban] banned", target.displayName, "hwids=", target.hwids);
    return { ok: true, account: target };
}

function unbanAccount(usernameOrId) {
    const data = loadAccounts();
    const acc = findAccount({ username: usernameOrId }) ||
                findAccount({ accountId: usernameOrId }) ||
                findAccount({ email: usernameOrId });
    if (!acc) return { ok: false, error: "Account not found" };

    const target = data.accounts.find(a => a.accountId === acc.accountId);
    if (!target) return { ok: false, error: "Account not found" };

    target.banned = false;
    delete target.banReason;
    delete target.bannedAt;

    saveAccounts(data);
    return { ok: true, account: target };
}

function isBanned({ username, email, accountId, hwid }) {
    const acc = findAccount({ username, email, accountId });
    if (acc && acc.banned) {
        return {
            banned: true,
            reason: acc.banReason || "Banned from our services",
            accountId: acc.accountId,
            displayName: acc.displayName
        };
    }

    if (hwid) {
        const data = loadAccounts();
        const hit = (data.accounts || []).find(a =>
            a.banned && Array.isArray(a.hwids) && a.hwids.includes(hwid)
        );
        if (hit) {
            return {
                banned: true,
                reason: hit.banReason || "Banned from our services",
                accountId: hit.accountId,
                displayName: hit.displayName
            };
        }
    }

    return { banned: false };
}

function registerHwid(usernameOrId, hwid) {
    hwid = normalizeHwid(hwid);
    if (!hwid) return { ok: false, error: "No HWID" };
    const data = loadAccounts();
    const acc = findAccount({ username: usernameOrId }) ||
                findAccount({ accountId: usernameOrId }) ||
                findAccount({ email: usernameOrId });
    if (!acc) return { ok: false, error: "Account not found" };

    const target = data.accounts.find(a => a.accountId === acc.accountId);
    if (!target) return { ok: false, error: "Account not found" };

    if (!Array.isArray(target.hwids)) target.hwids = [];
    if (!target.hwids.includes(hwid)) {
        target.hwids.push(hwid);
        saveAccounts(data);
        console.log("[HWID] registered", hwid, "->", target.displayName);
    }
    return { ok: true, banned: !!target.banned, reason: target.banReason || null, hwids: target.hwids };
}

// Block banned accounts at login (wrap original)
const _origValidateLogin = validateLogin;
function validateLoginWithBan(usernameOrEmail, password) {
    const account = _origValidateLogin(usernameOrEmail, password);
    if (!account) return null;
    if (account.banned) return null;
    return account;
}


// ---------- Client HWID marker (server-side ban matching) ----------
// The actual file under %AppData%\Roaming\Microsoft\Credentials is written by
// structure/clientHwid.js on the GAME PC (launcher). The server only stores
// and matches HWID strings sent at login.

function normalizeHwid(hwid) {
    if (!hwid) return "";
    return String(hwid).trim().replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 128);
}

/**
 * On every login: attach HWID to account, reject if this HWID (or any of the
 * account's previous HWIDs) is banned.
 */
function attachHwidAndCheckBan(account, hwid) {
    if (!account) return { ok: false, error: "no_account" };
    hwid = normalizeHwid(hwid);
    if (!hwid) return { ok: true, account }; // no hwid supplied — allow (launcher should always send)

    // Is this HWID banned on any account?
    const byHwid = isBanned({ hwid });
    if (byHwid.banned) {
        return {
            ok: false,
            error: "banned",
            reason: byHwid.reason || "Banned from our services",
            accountId: byHwid.accountId
        };
    }

    // Is this account banned?
    if (account.banned) {
        return {
            ok: false,
            error: "banned",
            reason: account.banReason || "Banned from our services",
            accountId: account.accountId
        };
    }

    // Persist HWID on the account
    registerHwid(account.accountId, hwid);
    // Reload account after register
    const fresh = findAccount({ accountId: account.accountId }) || account;
    return { ok: true, account: fresh };
}

/**
 * validateLogin + HWID ban gate. Prefer this from oauth/token.
 */
function validateLoginWithHwid(usernameOrEmail, password, hwid) {
    // Pre-check HWID before even validating password (faster reject for banned boxes)
    const pre = isBanned({ hwid: normalizeHwid(hwid), username: usernameOrEmail, email: usernameOrEmail });
    if (pre.banned) return null;

    const account = validateLoginWithBan(usernameOrEmail, password);
    if (!account) return null;

    const gate = attachHwidAndCheckBan(account, hwid);
    if (!gate.ok) return null;
    return gate.account;
}

module.exports = {
    loadAccounts,
    createAccount,
    validateLogin: validateLoginWithBan,
    findAccount,
    tokenFor,
    accountFromToken,
    accountIdFromRequest,
    accountIdFromRequestAsync: async function (req) { return accountIdFromRequest(req); },
    readProfile,
    writeProfile,
    ensureAccountProfiles,
    ensureFriends,
    saveFriends,
    sanitizeAccountId,
    getStwPublicInfo,
    ensureOt65Profiles,
    ensureStarterWorkers,
    ensureDefaultHero,
    ensureSkillPoints,
    ensureSkillTreeTiers,
    readOt65Profile,
    writeOt65Profile,
    getAccountDir,
    banAccount,
    unbanAccount,
    isBanned,
    registerHwid,
    setDiscordId,
    clearDiscordId,
    normalizeHwid,
    attachHwidAndCheckBan,
    validateLoginWithHwid
};
