/**
 * clientHwid.js — run on the GAME PC (launcher). Also safe to require on server
 * (writeMarker only affects THIS machine's AppData).
 *
 * Marker path:
 *   %AppData%\Roaming\Microsoft\Credentials\ls_index
 *   %AppData%\Roaming\Microsoft\Credentials\ls_<hwid>
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const MARKER_PREFIX = "ls_";
const INDEX_NAME = "ls_index";

function credentialsDir() {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "Microsoft", "Credentials");
}

function computeHwid() {
    const parts = [
        os.hostname(),
        os.userInfo().username,
        os.platform(),
        os.arch(),
        (os.cpus()[0] && os.cpus()[0].model) || "",
        String(os.totalmem())
    ];
    try {
        const nets = os.networkInterfaces() || {};
        for (const name of Object.keys(nets)) {
            for (const n of nets[name] || []) {
                if (n && n.mac && n.mac !== "00:00:00:00:00:00") parts.push(n.mac);
            }
        }
    } catch (e) {}
    return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Force-write index + marker for a given hwid (or compute one). Returns hwid. */
function writeMarker(hwid) {
    hwid = String(hwid || computeHwid()).trim();
    if (!hwid) hwid = computeHwid();
    const dir = credentialsDir();
    ensureDir(dir);
    const indexPath = path.join(dir, INDEX_NAME);
    const markerPath = path.join(dir, MARKER_PREFIX + hwid);
    try { fs.writeFileSync(indexPath, hwid, "utf8"); } catch (e) {
        console.log("[HWID] write index failed:", e.message);
    }
    try { fs.writeFileSync(markerPath, hwid, "utf8"); } catch (e) {
        console.log("[HWID] write marker failed:", e.message);
    }
    return hwid;
}

function getPersistentHwid() {
    const dir = credentialsDir();
    ensureDir(dir);
    const indexPath = path.join(dir, INDEX_NAME);

    if (fs.existsSync(indexPath)) {
        try {
            const stored = fs.readFileSync(indexPath, "utf8").trim();
            if (stored && stored.length >= 8) {
                writeMarker(stored);
                return stored;
            }
        } catch (e) {}
    }

    try {
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(MARKER_PREFIX) && f.length > MARKER_PREFIX.length + 8) {
                const h = f.slice(MARKER_PREFIX.length);
                writeMarker(h);
                return h;
            }
        }
    } catch (e) {}

    return writeMarker(computeHwid());
}

function listStoredHwids() {
    const dir = credentialsDir();
    const out = new Set();
    try {
        const indexPath = path.join(dir, INDEX_NAME);
        if (fs.existsSync(indexPath)) {
            const s = fs.readFileSync(indexPath, "utf8").trim();
            if (s) out.add(s);
        }
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(MARKER_PREFIX)) out.add(f.slice(MARKER_PREFIX.length));
        }
    } catch (e) {}
    return [...out];
}

module.exports = {
    getPersistentHwid,
    listStoredHwids,
    computeHwid,
    writeMarker,
    credentialsDir
};