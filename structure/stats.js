// ---------------------------------------------------------------------------
// Real, persistent player stats + leaderboards.
//
// Previously every leaderboard route in main.js invented its numbers:
//   /fortnite/api/game/v2/leaderboards/cohort/:accountId  -> hardcoded names
//        ("Lawin", "TI93", "PRO100KatYT", "Playeereq", "Matteoki")
//   /fortnite/api/leaderboards/type/global/stat/...        -> heroNames.json
//        (STW hero names, not accounts) with Math.random() values
//   /fortnite/api/leaderboards/type/group/stat/...         -> Math.random()
//   /api/v1/leaderboards/Fortnite/...                      -> score 69 - index
//   /fortnite/api/statsv2/account/:accountId               -> stats: {}
//
// None of those ids were real accounts, so the client could not resolve display
// names for them, and the values changed on every request.
//
// This module keeps one persistent store, Config/stats.json, keyed by real
// accountId. Every registered account is included at zero, so the board is
// populated from the first launch and only moves when a match is recorded.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");

const STATS_FILE = path.join(__dirname, "..", "Config", "stats.json");

// Fortnite's playlist tokens and the placement tiers each one tracks.
// p2 = solo, p10 = duo, p9 = squad.
const PLAYLISTS = {
    p2:  { label: "solo",  tiers: [1, 10, 25] },
    p10: { label: "duo",   tiers: [1, 5, 12] },
    p9:  { label: "squad", tiers: [1, 3, 6] }
};

const COUNTERS = ["score", "kills", "matchesplayed", "minutesplayed", "playersoutlived"];
const DEFAULT_PLATFORM = "pc";

// br_placetop1_pc_m0_p2 and friends.
function key(stat, playlist, platform) {
    return `br_${stat}_${platform || DEFAULT_PLATFORM}_m0_${playlist}`;
}

// Every key the leaderboard UI can ask for, all at zero.
function zeroedStats(platform) {
    const out = {};
    for (const pl of Object.keys(PLAYLISTS)) {
        for (const c of COUNTERS) out[key(c, pl, platform)] = 0;
        for (const t of PLAYLISTS[pl].tiers) out[key("placetop" + t, pl, platform)] = 0;
        out[key("lastmodified", pl, platform)] = 0;
    }
    return out;
}

// --- store -----------------------------------------------------------------

let store = { version: 1, accounts: {} };

function load() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
            if (parsed && typeof parsed === "object" && parsed.accounts) store = parsed;
        }
    } catch (e) {
        console.log("[Stats] Config/stats.json unreadable, starting fresh:", e.message);
        store = { version: 1, accounts: {} };
    }
}
load();

let dirty = false;
let flushTimer = null;

function save() {
    dirty = true;
    if (flushTimer) return;
    // Coalesce bursts of writes; a match report touches many keys at once.
    flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!dirty) return;
        dirty = false;
        // Direct write: renameSync over an existing destination throws EPERM on
        // Windows, which would have silently dropped every save after the first.
        try {
            fs.writeFileSync(STATS_FILE, JSON.stringify(store, null, 2));
        } catch (e) {
            console.log("[Stats] failed to save:", e.message);
        }
    }, 250);
}

function flushNow() {
    if (!dirty) return;
    dirty = false;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    try { fs.writeFileSync(STATS_FILE, JSON.stringify(store, null, 2)); } catch (e) {
        console.log("[Stats] failed to flush on exit:", e.message);
    }
}
for (const sig of ["exit", "SIGINT", "SIGTERM"]) {
    process.on(sig, () => { flushNow(); if (sig !== "exit") process.exit(0); });
}

function accountManager() {
    // Lazy to keep the require graph acyclic.
    try { return require("./accountManager.js"); } catch { return null; }
}

// Every account the server knows about, whether or not it has played yet.
function knownAccountIds() {
    const ids = new Set(Object.keys(store.accounts));
    const am = accountManager();
    try {
        const data = am && am.loadAccounts ? am.loadAccounts() : null;
        for (const a of (data && data.accounts) || []) if (a && a.accountId) ids.add(a.accountId);
    } catch (e) {
        console.log("[Stats] could not list accounts:", e.message);
    }
    return [...ids];
}

function displayNameFor(accountId) {
    const am = accountManager();
    try {
        const acc = am && am.findAccount ? am.findAccount({ accountId }) : null;
        if (acc && acc.displayName) return acc.displayName;
    } catch {}
    return accountId;
}

function isBanned(accountId) {
    const am = accountManager();
    try {
        if (!am || !am.isBanned) return false;
        const info = am.isBanned({ accountId });
        return !!(info && info.banned === true);
    } catch { return false; }
}

// --- reads -----------------------------------------------------------------

function ensure(accountId) {
    if (!accountId) return null;
    if (!store.accounts[accountId]) {
        store.accounts[accountId] = { stats: zeroedStats(), matches: 0, firstSeen: new Date().toISOString(), lastMatch: null };
        save();
    }
    const rec = store.accounts[accountId];
    if (!rec.stats) rec.stats = zeroedStats();
    return rec;
}

// Full stat map with the zero baseline filled in, so a key the player has never
// scored in still reads 0 instead of being absent.
function statsFor(accountId) {
    const rec = ensure(accountId);
    return Object.assign(zeroedStats(), rec ? rec.stats : {});
}

function value(accountId, statName) {
    const rec = store.accounts[accountId];
    const v = rec && rec.stats ? rec.stats[statName] : undefined;
    return typeof v === "number" ? v : 0;
}

// statsv2-shaped payload.
function statsV2(accountId) {
    return {
        startTime: 0,
        endTime: 0,
        stats: statsFor(accountId),
        accountId: accountId
    };
}

// --- leaderboards ----------------------------------------------------------

// Sorted, ranked, real accounts. Everyone appears, ties broken by display name
// so the ordering is stable between requests instead of reshuffling.
function leaderboard(statName, limit) {
    const rows = knownAccountIds()
        .filter(id => !isBanned(id))
        .map(id => ({ accountId: id, displayName: displayNameFor(id), value: value(id, statName) }));

    rows.sort((a, b) => (b.value - a.value) || a.displayName.localeCompare(b.displayName));
    rows.forEach((r, i) => { r.rank = i + 1; });

    return typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows;
}

// Values for a specific set of accounts, in the order the client asked for them.
function valuesFor(accountIds, statName) {
    return (accountIds || []).filter(Boolean).map(id => ({ accountId: id, value: value(id, statName) }));
}

// The client compares itself against its cohort. Real accounts only: self first,
// then friends, then anyone else on the server, capped so the payload stays small.
function cohort(accountId, max) {
    const cap = max || 50;
    const out = [];
    const push = id => { if (id && !out.includes(id)) out.push(id); };

    push(accountId);

    const am = accountManager();
    try {
        const friends = am && am.ensureFriends ? am.ensureFriends(accountId) : null;
        const list = (friends && (friends.friends || friends.accepted || friends.list)) || [];
        for (const f of list) push(typeof f === "string" ? f : (f && (f.accountId || f.id)));
    } catch {}

    for (const id of knownAccountIds()) {
        if (out.length >= cap) break;
        if (!isBanned(id)) push(id);
    }
    return out.slice(0, cap);
}

// --- writes ----------------------------------------------------------------

// Apply raw key deltas: { "br_kills_pc_m0_p2": 3 }
function addStats(accountId, deltas) {
    const rec = ensure(accountId);
    if (!rec || !deltas) return null;
    for (const [k, d] of Object.entries(deltas)) {
        const n = Number(d);
        if (!Number.isFinite(n)) continue;
        rec.stats[k] = (typeof rec.stats[k] === "number" ? rec.stats[k] : 0) + n;
    }
    save();
    return rec;
}

// Overwrite raw keys outright (admin / correction).
function setStats(accountId, values) {
    const rec = ensure(accountId);
    if (!rec || !values) return null;
    for (const [k, v] of Object.entries(values)) {
        const n = Number(v);
        if (Number.isFinite(n)) rec.stats[k] = n;
    }
    save();
    return rec;
}

// The normal ingestion path: one finished match.
//   playlist: "p2" | "p10" | "p9" (or "solo" | "duo" | "squad")
//   placement: finishing position, 1 = win
function recordMatch(accountId, match) {
    const m = match || {};
    let playlist = String(m.playlist || "p2").toLowerCase();
    const byLabel = Object.keys(PLAYLISTS).find(p => PLAYLISTS[p].label === playlist);
    if (byLabel) playlist = byLabel;
    if (!PLAYLISTS[playlist]) playlist = "p2";

    const platform = String(m.platform || DEFAULT_PLATFORM).toLowerCase();
    const placement = Number(m.placement) > 0 ? Number(m.placement) : 0;
    const kills = Math.max(0, Number(m.kills) || 0);
    const minutes = Math.max(0, Number(m.minutesPlayed) || 0);
    const outlived = Math.max(0, Number(m.playersOutlived) || 0);
    // Epic's own formula is opaque; kills plus a placement bonus tracks it closely
    // enough for a private server and stays monotonic.
    const score = m.score !== undefined
        ? Math.max(0, Number(m.score) || 0)
        : kills * 10 + (placement === 1 ? 50 : placement > 0 ? Math.max(0, 30 - placement) : 0);

    const deltas = {};
    deltas[key("matchesplayed", playlist, platform)] = 1;
    deltas[key("kills", playlist, platform)] = kills;
    deltas[key("score", playlist, platform)] = score;
    if (minutes) deltas[key("minutesplayed", playlist, platform)] = minutes;
    if (outlived) deltas[key("playersoutlived", playlist, platform)] = outlived;

    if (placement > 0) {
        for (const t of PLAYLISTS[playlist].tiers) {
            if (placement <= t) deltas[key("placetop" + t, playlist, platform)] = 1;
        }
    }

    const rec = addStats(accountId, deltas);
    if (rec) {
        rec.stats[key("lastmodified", playlist, platform)] = Math.floor(Date.now() / 1000);
        rec.matches = (rec.matches || 0) + 1;
        rec.lastMatch = new Date().toISOString();
        save();
    }
    return rec;
}

function reset(accountId) {
    if (accountId) {
        store.accounts[accountId] = { stats: zeroedStats(), matches: 0, firstSeen: new Date().toISOString(), lastMatch: null };
    } else {
        store = { version: 1, accounts: {} };
    }
    save();
}

// Make sure every registered account has a row, so a brand new server still
// returns a full board of zeroes rather than an empty one.
function seedAllAccounts() {
    for (const id of knownAccountIds()) ensure(id);
    return Object.keys(store.accounts).length;
}

module.exports = {
    PLAYLISTS, key, zeroedStats,
    ensure, statsFor, statsV2, value,
    leaderboard, valuesFor, cohort,
    addStats, setStats, recordMatch, reset,
    knownAccountIds, displayNameFor, seedAllAccounts, flushNow
};
