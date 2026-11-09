/**
 * mmQueue.js — shared live matchmaking queue state.
 *
 * Flow for old builds (v1.11 era):
 *   1. Client GETs /fortnite/api/game/v2/matchmakingservice/ticket/player/<accountId>?bucketId=...
 *      → matchmaking.js parses the playlist out of the bucketId and registers a ticket here.
 *   2. Client opens the matchmaker WebSocket (serviceUrl) → matchmaker.js claims the oldest
 *      pending ticket so the queued connection is counted under the right playlist.
 *   3. While queued, the matchmaker polls the game server ip:port for that playlist and only
 *      sends SessionAssignment/Play once the port actually answers.
 *   4. Queued clients periodically receive a refreshed "Queued" status whose queuedPlayers
 *      is the REAL number of players currently queued for the same playlist.
 *
 * The live numbers are also exposed over HTTP for dashboards:
 *   GET /matchmaking/queue  or  /fortnite/api/matchmaking/queue
 */
const net = require("net");
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");
const iniparser = require("ini");

let cfg = {};
try {
    cfg = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini"), "utf8"));
} catch (e) {}

const MM_CFG = cfg.Matchmaker || {};

function cfgBool(value, dflt) {
    if (value === undefined || value === "") return dflt;
    return String(value).toLowerCase() !== "false" && String(value) !== "0";
}

function cfgNum(value, dflt) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : dflt;
}

const settings = {
    // Wait for the game server port to be open before assigning a session (false = old instant behavior)
    waitForPort: cfgBool(MM_CFG.bWaitForPort, true),
    // Which probe decides a port is "open": tcp | udp | both | off
    // UE dedicated servers (fortmp/rift/...) listen on UDP, TCP proxies answer TCP, so "both" covers both.
    // NOTE: Windows does not report ICMP port-unreachable for UDP (Node lacks SIO_UDP_CONNRESET),
    // so the udp part of the probe is optimistic there (assumes open unless an error is seen).
    probe: String(process.env.MATCHMAKER_PROBE || MM_CFG.probe || "both").toLowerCase(),
    checkIntervalMs: cfgNum(MM_CFG.checkIntervalMs, 2000),
    statusIntervalMs: cfgNum(MM_CFG.statusIntervalMs, 5000),
    probeTimeoutMs: cfgNum(MM_CFG.probeTimeoutMs, 1500),
    // What an unanswered UDP probe means once probeTimeoutMs elapses with no ICMP error.
    // On Windows, Node cannot see ICMP port-unreachable at all (SIO_UDP_CONNRESET), so a
    // closed port and a silent-but-open port look IDENTICAL there — this setting is a guess,
    // not a real detection. true = old behavior (assume open, can load into a server that
    // isn't actually up yet). false = assume NOT open until something proves otherwise
    // (safer default if the matchmaker seems to be sending Play too early).
    udpAssumeOpenOnTimeout: cfgBool(MM_CFG.udpAssumeOpenOnTimeout, true),
    // How long an HTTP ticket waits for its matchmaker WebSocket before expiring
    ticketTtlMs: cfgNum(MM_CFG.ticketTtlMs, 120000),
    // Port the matchmaker WebSocket listens on (must match xmpp.js so serviceUrl is correct)
    wsPort: cfgNum(process.env.XMPP_PORT || MM_CFG.wsPort, 80),
    // If the backend and the game server run on the SAME machine, probing your own
    // Tailscale/LAN-facing IP can behave very differently from probing 26.155.48.164 —
    // loopback is much more reliably readable by Node/Windows. Set this to override
    // just the address the liveness PROBE connects to; the address handed to remote
    // clients (targetFor / the session response) is untouched. Leave blank/unset to
    // probe the real target ip as before (needed if the game server is on a different
    // machine than this backend).
    probeHost: String(process.env.MATCHMAKER_PROBE_HOST || MM_CFG.probeHost || "").trim()
};

if (!global.mmQueueState) global.mmQueueState = { playlists: {}, pending: [] };
const lastProbes = global.mmLastProbes || (global.mmLastProbes = {});

const KNOWN_REGIONS = new Set([
    "nae", "naw", "na", "eu", "br", "asia", "oce", "me", "default",
    "northamerica", "europe", "brazil", "asia", "oceania", "middleeast"
]);

/**
 * Extract a playlist name from a bucketId. bucketIds look different across builds, e.g.
 *   "0:0:EU:Playlist_DefaultSolo:Athena" (BR)
 *   "0:0:0:DEFAULT:Athena" (older)
 *   "611750138:0:NA:2" (v1.11 style — build:?:region:playlistIndex)
 * Preference: a "Playlist_..." segment, otherwise a non-digit non-region segment,
 * otherwise fall back to "Playlist_DefaultSolo".
 */
function playlistFromBucketId(bucketId) {
    const parts = String(bucketId || "").split(":").map(s => s.trim()).filter(s => s.length);

    // Explicit Playlist_... name
    for (let i = parts.length - 1; i >= 0; i--) {
        if (/^playlist/i.test(parts[i])) return parts[i];
    }

    // Non-digit, non-region segment (e.g. DEFAULT, Athena, etc.)
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (/^\d+$/.test(p)) continue;
        if (KNOWN_REGIONS.has(p.toLowerCase())) continue;
        return p;
    }

    // v1.11 style last number often maps to playlist index. This table was only ever a
    // guess ("map common ones") — confirmed wrong for build 611750138: index 2 is Solo,
    // not Squad, which is why the client showed "ready for squads" while queued for solo.
    // Only put an index here once you've actually confirmed it (queue for that mode, check
    // this log line's bucketId, e.g. "[Matchmaker] ... queued for X (bucketId)").
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
        const map = {
            "2": "Playlist_DefaultSolo"
        };
        if (map[last]) return map[last];
        console.log(`[mmQueue] unconfirmed playlist index "${last}" in bucketId "${bucketId}" — defaulting to Playlist_DefaultSolo. Queue for the mode you actually picked and report this line so the index can be mapped correctly.`);
    }

    return "Playlist_DefaultSolo";
}

/** ip:port the matchmaker should probe/assign for a playlist ([GameServer], overridable per playlist). */
function targetFor(playlist) {
    let ip = process.env.GAMESERVER_IP || (cfg.GameServer && cfg.GameServer.ip) || "26.155.48.164";
    let port = Number(process.env.GAMESERVER_PORT || (cfg.GameServer && cfg.GameServer.port) || 7777);

    // Per-playlist overrides in [Matchmaker]:  PlaylistName=ip:port  (or just port)
    const settingKeys = new Set(["bwaitforport", "probe", "checkintervalms", "statusintervalms", "probetimeoutms", "ticketttlms", "wsport"]);
    const key = String(playlist || "").toLowerCase();
    for (const k in MM_CFG) {
        if (!key || settingKeys.has(k.toLowerCase())) continue;
        if (k.toLowerCase() !== key) continue;
        const v = String(MM_CFG[k]);
        if (v.includes(":")) {
            ip = v.split(":")[0];
            port = Number(v.split(":")[1]) || port;
        } else {
            port = Number(v) || port;
        }
    }
    return { ip, port: Number(port) };
}

// --- HTTP ticket registration (called by matchmaking.js on the ticket endpoint) ---

function pruneTickets() {
    const now = Date.now();
    global.mmQueueState.pending = global.mmQueueState.pending.filter(t => now - t.ts < settings.ticketTtlMs);
}

function registerTicket(info) {
    pruneTickets();
    // A re-requested ticket replaces the player's older pending one
    global.mmQueueState.pending = global.mmQueueState.pending.filter(t => t.accountId !== info.accountId);
    const entry = {
        accountId: String(info.accountId || ""),
        playlist: info.playlist || "unknown",
        bucketId: String(info.bucketId || ""),
        ts: Date.now()
    };
    global.mmQueueState.pending.push(entry);
    return entry;
}

function claimTicket() {
    pruneTickets();
    return global.mmQueueState.pending.shift() || null;
}

// --- Live queue counting (one entry per live matchmaker WebSocket) ---

function joinQueue(playlist) {
    const p = playlist || "unknown";
    global.mmQueueState.playlists[p] = (global.mmQueueState.playlists[p] || 0) + 1;
    return getQueueSize(p);
}

function leaveQueue(playlist) {
    const p = playlist || "unknown";
    global.mmQueueState.playlists[p] = Math.max(0, (global.mmQueueState.playlists[p] || 0) - 1);
    if (global.mmQueueState.playlists[p] === 0) delete global.mmQueueState.playlists[p];
    return getQueueSize(p);
}

function getQueueSize(playlist) {
    return global.mmQueueState.playlists[playlist || "unknown"] || 0;
}

// --- Explicit readiness override (bypasses ICMP-guessing entirely) ---
// Call markReady(ip, port) once you know for certain the dedicated server is
// actually accepting connections (e.g. from a launcher script that tails the
// server's own log for its "ready"/"listening" line, or a manual admin action).
// isPortOpen() checks this FIRST, before falling back to the unreliable probe.
if (!global.mmReadyOverrides) global.mmReadyOverrides = {};

function readyKey(ip, port) {
    return `${ip}:${port}`;
}

function markReady(ip, port) {
    global.mmReadyOverrides[readyKey(ip, port)] = true;
    console.log(`[mmQueue] marked ${ip}:${port} as READY (explicit override)`);
}

function clearReady(ip, port) {
    delete global.mmReadyOverrides[readyKey(ip, port)];
    console.log(`[mmQueue] cleared ready override for ${ip}:${port}`);
}

function isMarkedReady(ip, port) {
    return !!global.mmReadyOverrides[readyKey(ip, port)];
}

// --- Port probing ---

function tcpProbe(ip, port, timeoutMs) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { s.destroy(); } catch (e) {}
            resolve(ok);
        };
        const s = net.connect({ host: ip, port: Number(port) });
        s.setTimeout(timeoutMs, () => finish(false));
        s.once("connect", () => finish(true));
        s.once("error", () => finish(false));
    });
}

/**
 * UDP probe: a UDP "connection" always succeeds locally, so instead we send a datagram and
 * listen for an ICMP error (port unreachable). No error within the timeout => assume open.
 * This detects UE dedicated servers (UDP-only) as "hosting" on Linux; on Windows ICMP errors
 * are swallowed by the OS, so this probe is optimistic there.
 */
function udpProbe(ip, port, timeoutMs) {
    return new Promise((resolve) => {
        let done = false;
        let pings = 0;
        const s = dgram.createSocket("udp4");
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearInterval(pingTimer);
            try { s.close(); } catch (e) {}
            resolve(ok);
        };
        const timer = setTimeout(() => {
            if (settings.udpAssumeOpenOnTimeout) {
                console.log(`[mmQueue] udpProbe ${ip}:${port} — no ICMP error within ${timeoutMs}ms, ASSUMING open (udpAssumeOpenOnTimeout=true)`);
            } else {
                console.log(`[mmQueue] udpProbe ${ip}:${port} — no response within ${timeoutMs}ms, treating as NOT open (udpAssumeOpenOnTimeout=false)`);
            }
            finish(!!settings.udpAssumeOpenOnTimeout);
        }, timeoutMs);
        const pingTimer = setInterval(() => {
            if (done || ++pings > 4) return clearInterval(pingTimer);
            sendPing();
        }, Math.max(100, Math.floor(timeoutMs / 5)));
        function sendPing() {
            try {
                s.send(Buffer.from([0x00]), (err) => { if (err) finish(false); });
            } catch (e) { finish(false); }
        }
        s.once("error", () => finish(false));
        s.once("connect", () => {
            s.once("message", () => finish(true));
            sendPing();
        });
        try { s.connect(Number(port), ip); } catch (e) { finish(false); }
    });
}

function cacheProbe(target, open) {
    const key = `${target.ip}:${target.port}`;
    lastProbes[key] = { open, ts: new Date().toISOString() };
    return open;
}

/** True when the game server for this playlist is reachable on its ip:port. */
async function isPortOpen(playlist) {
    const target = targetFor(playlist);
    if (isMarkedReady(target.ip, target.port)) return cacheProbe(target, true);
    if (settings.probe === "off") return cacheProbe(target, true);

    // Probe a different host than the one clients connect to, if configured
    // (e.g. probeHost=26.155.48.164 when this backend and the server share a machine).
    const probeIp = settings.probeHost || target.ip;
    if (probeIp !== target.ip) {
        console.log(`[mmQueue] probing ${probeIp}:${target.port} on behalf of ${target.ip}:${target.port} (probeHost override)`);
    }

    if (settings.probe === "tcp" || settings.probe === "both") {
        const tcpOpen = await tcpProbe(probeIp, target.port, settings.probeTimeoutMs);
        if (tcpOpen) return cacheProbe(target, true);
        if (settings.probe === "tcp") return cacheProbe(target, false);
    }
    const udpOpen = await udpProbe(probeIp, target.port, settings.probeTimeoutMs);
    return cacheProbe(target, udpOpen);
}

/** Live snapshot for dashboards / the admin console. */
function snapshot() {
    pruneTickets();
    const playlists = {};
    let total = 0;
    for (const p in global.mmQueueState.playlists) {
        const n = global.mmQueueState.playlists[p] || 0;
        if (n <= 0) continue;
        playlists[p] = n;
        total += n;
    }
    return {
        gameServer: targetFor(""),
        probe: settings.probe,
        waitForPort: settings.waitForPort,
        ports: lastProbes,
        pendingTickets: global.mmQueueState.pending.length,
        playlists: playlists,
        total: total,
        updatedAt: new Date().toISOString()
    };
}

module.exports = {
    settings,
    playlistFromBucketId,
    targetFor,
    registerTicket,
    claimTicket,
    joinQueue,
    leaveQueue,
    getQueueSize,
    isPortOpen,
    markReady,
    clearReady,
    isMarkedReady,
    snapshot
};
