/**
 * TCP_XMPP.js — flexible STARTTLS + plain PLAIN
 * Banner: [TCP-XMPP] *** FLEX MODE ***
 *
 * After features:
 *  - client may send <starttls/>  → we proceed + TLS wrap
 *  - client may send TLS ClientHello (0x16) → we TLS wrap
 *  - client may send <auth/> plain → we SASL without TLS
 */
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const XMLParser = require("xml-parser");

const functions = require("./functions.js");
const accountManager = require("./accountManager.js");

const EMBED_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1wlB+8Ir1v5VSWrJ6VHn5uh4SETcL8gfI89H5jv5GB9uvkuH\nntYnAK/ImWysKSkBCOXtUldXd81f/WPT4I0SdrUSWZAep97HI9VjhIbnFZyq5ROO\ntwHu+304jDOivFYKEULNuWG8WZ3jZ6OCGAHwiJXyBSYarnEC0+JhU95hkJ25vD3m\n1A514I5TRyfbpb9E0BkXzwGiuXJ6l82qycQK0LI6vTX67jKagM7wiWeCCGIy/4qX\njZ+xMobspjSjYXTT4PMlepeRBGqKcNh8MsMRkIAVp1j/w8cbt85O6DdFj6/Mie6v\npzNanY/tmUxhostVRWNh+xn5xew+lRcxJRJItQIDAQABAoIBACBvi43rqIw5+ehk\nnMc+bRIF/9q61FG6yIOwyQIgCr9KQnyezPq3B9QRL9uAqmlc/4R1ljok5ZMzHecN\nT1DgRqg0QOvUkuM0depgTi4X4TR/2MFMFWtidcdmiIiRY1swST14S6rKZMxJxhsE\nbWOsqzkXERYYvM6SSmBmldK+SQ40jYhpLFssaw2vAGQrSxDmHk3ugghbzw3Dny8D\nRTcOznb6R/SMD2pOjNuQdoD2UR/LEeIDVB5wGG3BuG7UfXIPkSHHVsLE8Tydjl/9\ntQt8yGxhcVbBrtzWyuCKMKDLfRt4Jn8YK3p8Iy6OKaRfMAREsWfkLPL7mOY57EjF\nyDhrRSMCgYEA9pw+SLmthkB2rnfBiEy75PpsA6MU9AjzN6LPIDxvpqQr/MjtuGI0\nzgURIeBFWGrxYOHYaQZyWoUPOKVsCqkNG74EcS9j65/PobId7Dcpu3vF3z6yO34X\nLJ44e1BZXi5bs9046Mt/MvfJ+ieWtb/62o4JzO0LWLpv+HqqDAjxDtcCgYEA3zlB\nVgYoyVkBR7vRMcSVIKv5gBX36SlxNsuMUZjdsazB72ofu53ScZi5aoICKkkT6ZbL\nrGdyxUXC2ZPdZbPwC+cZa2e8BFdQB5Yo5MNRPh9ZMtEkr3a7MYDBV1432E87rUaE\nouJKmKr7g0XEhqXf231DDnDTQ632+/TZSfs3L1MCgYAY+m5ck2H+DR14Qmz5zzvg\nz3SNUcFXjmiEJBtymmx8pnhGHFvnpxrOGzlHAx5C/GICfB2dVafTf1KxXB/7XHAV\ndUOh6zjlrsQrDo11VYkGklzSZdlLqVPTkxsJcnP61Bs5tpiDC8mQcgSlL8lWE2Hn\nLSfU99WEYS3iLxp2KZmw9QKBgQC6jA23B2S0h+ZS/Xng3olGCZJz4WgR+ek8QrUc\nR+UVo+ta2lR0pXsGJfzmLooCrpmuf6/sf3Nhu2AQFstSQCLev531rXZqJlGiVXIN\nY9EUWnxfxHqlDFN6FkD9c6a15dlYgHM98GEo3tNcLEUFxb+jnTYZ7l4P1GVwwHmK\nox/GMwKBgGYH29E3mTzz/4G/ME90ja/i+s1or7HJpUQTh7e3AQMVGr2sHr017OpJ\nXYEImP3K6qbj66gJ0tynSXs/sdebo5wrX0aPwhtdcUU4LOceElx9MxsKswefNYcT\nnkmjm0dAbG938THkg1MCuMy4beaDjynoBMXIOA69RJRK0yqlxuWE\n-----END RSA PRIVATE KEY-----\n';
const EMBED_CERT = '-----BEGIN CERTIFICATE-----\nMIIDAzCCAeugAwIBAgIUAeFU+krIUVcCX/HRyjz1AkM41MEwDQYJKoZIhvcNAQEL\nBQAwIDEeMBwGA1UEAwwVcHJvZC5vbC5lcGljZ2FtZXMuY29tMB4XDTI2MDgyNTEy\nNTMxOFoXDTM2MDgyMzEyNTMxOFowIDEeMBwGA1UEAwwVcHJvZC5vbC5lcGljZ2Ft\nZXMuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1wlB+8Ir1v5V\nSWrJ6VHn5uh4SETcL8gfI89H5jv5GB9uvkuHntYnAK/ImWysKSkBCOXtUldXd81f\n/WPT4I0SdrUSWZAep97HI9VjhIbnFZyq5ROOtwHu+304jDOivFYKEULNuWG8WZ3j\nZ6OCGAHwiJXyBSYarnEC0+JhU95hkJ25vD3m1A514I5TRyfbpb9E0BkXzwGiuXJ6\nl82qycQK0LI6vTX67jKagM7wiWeCCGIy/4qXjZ+xMobspjSjYXTT4PMlepeRBGqK\ncNh8MsMRkIAVp1j/w8cbt85O6DdFj6/Mie6vpzNanY/tmUxhostVRWNh+xn5xew+\nlRcxJRJItQIDAQABozUwMzAxBgNVHREEKjAoghVwcm9kLm9sLmVwaWNnYW1lcy5j\nb22CCWxvY2FsaG9zdIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEAApPMkuVvhVB1\n7bhCMZvHy1J4IQnkXuERXdFW5a0hepPFOo9XW73XK7hGsNqOYcwNyjJ/AyrfU6t2\nq/8kEnlYtZJKNAvwlk6bls5N/n3INBt93+y/Wm+nXw14/+fdRDl/Y0iFg079z9NM\nXXhNBjxwRxfdUxYlOKjNS2alnKU9390Oh16Yno/gPGddvHCkMsaqQlpMGVod5ZC6\nqBeH3O5AgzVa0/Z9l02GD0ND5dhROW/A/GxoxtgyM9IDtZpEjiMJn9C5JxF+d6OW\nGqwKrYMdhIF4YQz/zgtw38Omh5zxx0V/LuROp4JUJHfHUYUriNrvPcf+I/ZKaF2E\nRT3Cu01h7g==\n-----END CERTIFICATE-----\n';

let cfg = {};
try {
    const iniparser = require("ini");
    cfg = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini"), "utf8"));
} catch (e) {}

const XMPP_CFG = cfg.XMPP || {};
const TCP_PORT = Number(process.env.XMPP_TCP_PORT || XMPP_CFG.tcpPort || 5222);
const XMPP_DOMAIN = String(XMPP_CFG.domain || process.env.XMPP_DOMAIN || "prod.ol.epicgames.com");
const WIRE_LOG = String(XMPP_CFG.wireLog || process.env.XMPP_WIRE_LOG || "true").toLowerCase() !== "false";
// offerStarttls:
//   true  = STARTTLS (use with ZeroSSL cert OR with XMPPCertBypass.dll + self-signed)
//   false = pure plaintext PLAIN (many 1.11 clients disconnect; for experiments only)
// Default true so DLL / cert setups work out of the box.
const OFFER_STARTTLS = String(XMPP_CFG.offerStarttls != null ? XMPP_CFG.offerStarttls : (process.env.XMPP_OFFER_STARTTLS || "true")).toLowerCase() !== "false";
// requireTls=true: <required/> inside STARTTLS (only if offerStarttls=true)
const REQUIRE_TLS = String(XMPP_CFG.requireTls || process.env.XMPP_REQUIRE_TLS || "false").toLowerCase() === "true";

global.xmppDomain = XMPP_DOMAIN;

// ---------------------------------------------------------------------------
// Domain-agnostic mode.
//
// The old build sends the host it was pointed at in the <stream:stream to="...">
// header. That can be a hostname (prod.ol.epicgames.com via a hosts entry) OR a
// bare IP address. Instead of forcing every reply to the domain in config.ini we
// mirror back whatever the client asked for, and build its JID against the same
// value. That is what lets XMPP work over a raw IP with no domain and no hosts
// file entry at all.
//
// Set lockDomain=true under [XMPP] in config.ini to go back to the old
// force-the-config-domain behaviour.
// ---------------------------------------------------------------------------
const os = require("os");
const DOMAIN_LOCKED = String(XMPP_CFG.lockDomain || process.env.XMPP_LOCK_DOMAIN || "false").toLowerCase() === "true";

// Accept hostnames AND bare IPv4 so clients can use just IP:port
// with no hosts file and no domain. AthenaOG-style flexible addressing.
function sanitizeDomain(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    if (s.includes("@")) s = s.split("@").pop();
    s = s.split("/")[0];
    // strip trailing :port (IPv4); keep simple hostnames/IPs
    if (s.startsWith("[") && s.includes("]")) {
        s = s.slice(1, s.indexOf("]"));
    } else {
        s = s.replace(/:(\d+)$/, "");
    }
    // allow letters, digits, dots, dashes, underscores (IPs + hostnames)
    if (!/^[A-Za-z0-9._\-]+$/.test(s)) return "";
    if (s.toLowerCase().startsWith("muc.")) s = s.slice(4);
    return s;
}

function adoptDomain(raw) {
    const d = sanitizeDomain(raw);
    if (!d || DOMAIN_LOCKED) return global.xmppDomain;
    if (global.xmppDomain !== d) {
        console.log("[TCP-XMPP] client addressed us as \"" + d + "\" - serving that instead of \"" + global.xmppDomain + "\"");
        global.xmppDomain = d;              // keep MUC/roster JIDs consistent server-wide
    }
    return d;
}

// Default presence body that early clients (v1.7–v1.11) actually render as "Online"
const DEFAULT_PRESENCE_STATUS = JSON.stringify({
    Status: "Online",
    bIsPlaying: false,
    bIsJoinable: false,
    bHasVoiceSupport: false,
    ProductName: "Fortnite",
    SessionId: ""
});

function localIPv4s() {
    const out = [];
    try {
        const ifs = os.networkInterfaces();
        for (const name of Object.keys(ifs)) {
            for (const a of ifs[name] || []) {
                const fam = a && (a.family === "IPv4" || a.family === 4);
                if (fam && a.address) out.push(a.address);
            }
        }
    } catch (e) {}
    if (out.indexOf("127.0.0.1") === -1) out.push("127.0.0.1");
    return out.filter((v, i) => out.indexOf(v) === i);
}

const CERT_DIR = path.join(__dirname, "..", "Config");
const CERT_PAIRS = [
    ["tls/fullchain.pem", "tls/privkey.pem"],
    ["fullchain.pem", "privkey.pem"],
    ["xmpp-cert.pem", "xmpp-key.pem"]
];

let TLS_OPTS = null;
function getTlsOptions() {
    if (TLS_OPTS) return TLS_OPTS;
    // 2017-era clients only speak old TLS and old ciphers.
    const base = { isServer: true, rejectUnauthorized: false, requestCert: false, honorCipherOrder: true };
    try { base.minVersion = "TLSv1"; base.ciphers = "DEFAULT:@SECLEVEL=0"; } catch (e) {}
    for (const pair of CERT_PAIRS) {
        const c = path.join(CERT_DIR, pair[0]);
        const k = path.join(CERT_DIR, pair[1]);
        try {
            if (fs.existsSync(c) && fs.existsSync(k)) {
                const opts = Object.assign({}, base, { cert: fs.readFileSync(c, "utf8"), key: fs.readFileSync(k, "utf8") });
                console.log("[TCP-XMPP] TLS certificate: Config/" + pair[0]);
                TLS_OPTS = opts;
                return TLS_OPTS;
            }
        } catch (e) {}
    }
    console.log("[TCP-XMPP] TLS certificate: built-in fallback");
    TLS_OPTS = Object.assign({}, base, { key: EMBED_KEY, cert: EMBED_CERT });
    return TLS_OPTS;
}

// Generates Config/xmpp-cert.pem with EVERY local IPv4 address in subjectAltName,
// so a client that connects to 192.168.x.x / 26.x.x.x over TLS still gets a cert
// whose SAN matches the address it dialled. Skipped if a real cert is present.
async function ensureXmppCert() {
    try {
        for (const pair of CERT_PAIRS.slice(0, 2)) {
            if (fs.existsSync(path.join(CERT_DIR, pair[0])) && fs.existsSync(path.join(CERT_DIR, pair[1]))) return;
        }
        const certPath = path.join(CERT_DIR, "xmpp-cert.pem");
        const keyPath = path.join(CERT_DIR, "xmpp-key.pem");
        const stampPath = path.join(CERT_DIR, "xmpp-cert.sans.json");
        const ips = localIPv4s();
        const want = JSON.stringify({ domain: XMPP_DOMAIN, ips: ips.slice().sort() });
        if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(stampPath)) {
            if (fs.readFileSync(stampPath, "utf8") === want) return;
        }
        const selfsigned = require("selfsigned");
        const dnsNames = [XMPP_DOMAIN, "muc." + XMPP_DOMAIN, "localhost"].filter(Boolean);
        const altNames = dnsNames.map((v) => ({ type: 2, value: v })).concat(ips.map((v) => ({ type: 7, ip: v })));
        const pems = await selfsigned.generate(
            [{ name: "commonName", value: XMPP_DOMAIN }],
            { days: 3650, keySize: 2048, algorithm: "sha256", extensions: [{ name: "subjectAltName", altNames }] }
        );
        if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
        fs.writeFileSync(certPath, pems.cert);
        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(stampPath, want);
        TLS_OPTS = null;
        console.log("[TCP-XMPP] generated Config/xmpp-cert.pem for " + dnsNames.join(", ") + " + IP " + ips.join(", "));
    } catch (e) {
        console.log("[TCP-XMPP] could not generate an XMPP cert (" + (e && e.message) + ") - using the built-in one");
    }
}

if (!global.Clients) global.Clients = [];
if (!global.MUCs) global.MUCs = {};

function tryExtractStreamOpen(buffer) {
    let trimmed = buffer.replace(/^\s*(<\?xml[^>]*\?>)?\s*/i, "");
    const lead = buffer.length - trimmed.length;
    if (!trimmed.startsWith("<stream:stream")) return null;
    const end = trimmed.indexOf(">");
    if (end === -1) return null;
    const header = trimmed.slice(0, end + 1);
    const toMatch = header.match(/\bto\s*=\s*["']([^"']*)["']/i);
    return { consumed: lead + end + 1, to: toMatch ? toMatch[1] : "" };
}

function extractStanza(buffer) {
    let trimmed = buffer.replace(/^\s+/, "");
    const lead = buffer.length - trimmed.length;
    if (!trimmed.startsWith("<")) return null;
    if (trimmed.startsWith("</stream:stream>")) {
        return { xml: "</stream:stream>", consumed: lead + "</stream:stream>".length };
    }
    const m = trimmed.match(/^<([a-zA-Z0-9:_-]+)/);
    if (!m) return null;
    const tag = m[1];
    const openEnd = trimmed.indexOf(">");
    if (openEnd === -1) return null;
    const openTag = trimmed.slice(0, openEnd + 1);
    if (openTag.endsWith("/>")) return { xml: openTag, consumed: lead + openTag.length };
    const closeTag = `</${tag}>`;
    let depth = 1;
    let i = openEnd + 1;
    while (depth > 0) {
        const nOpen = trimmed.indexOf(`<${tag}`, i);
        const nClose = trimmed.indexOf(closeTag, i);
        if (nClose === -1) return null;
        if (nOpen !== -1 && nOpen < nClose) {
            const e = trimmed.indexOf(">", nOpen);
            if (e === -1) return null;
            if (trimmed[e - 1] !== "/") depth++;
            i = e + 1;
        } else {
            depth--;
            i = nClose + closeTag.length;
        }
    }
    return { xml: trimmed.slice(0, i), consumed: lead + i };
}

function getMUCmember(roomName, displayName, accountId, resource) {
    return `${roomName}@muc.${global.xmppDomain}/${encodeURI(displayName)}:${accountId}:${resource}`;
}

function xmlEscape(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function isJSONObject(str) {
    try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch (e) {
        return false;
    }
}

function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// MUC member records from the WebSocket server only carry { accountId }; resolve the
// full identity from the shared client list so both servers interop in the same rooms.
function resolveMUCMember(member) {
    if (member && member.jid && member.displayName && member.resource) return member;
    const client = global.Clients.find((c) => c.accountId === member.accountId);
    if (client) return client;
    const resource = (member && member.resource) || "V2:Fortnite:WIN";
    return {
        accountId: member.accountId,
        displayName: (member && member.displayName) || member.accountId,
        resource: resource,
        jid: `${member.accountId}@${global.xmppDomain}/${resource}`
    };
}

function mucPresenceXML(roomName, member, toJid, opts) {
    const m = resolveMUCMember(member);
    const nick = getMUCmember(roomName, m.displayName, m.accountId, m.resource);
    const itemJid = m.jid || `${m.accountId}@${global.xmppDomain}`;
    const type = opts && opts.type ? ` type="${opts.type}"` : "";
    const role = opts && opts.type === "unavailable" ? "none" : "participant";
    const codes = ((opts && opts.statuses) || []).map((c) => `<status code="${c}"/>`).join("");
    return `<presence to="${toJid}" from="${nick}" xmlns="jabber:client"${type}><x xmlns="http://jabber.org/protocol/muc#user"><item jid="${itemJid}" affiliation="member" role="${role}"/>${codes}</x></presence>`;
}

function RemoveClient(clientRef, joinedMUCs) {
    if (!clientRef) return;
    const idx = global.Clients.findIndex((c) => c.client === clientRef);
    if (idx === -1) return;
    const data = global.Clients[idx];
    global.Clients.splice(idx, 1);
    global.Clients.forEach((other) => {
        try {
            other.client.send(
                `<presence to="${other.jid}" from="${data.jid}" xmlns="jabber:client" type="unavailable"/>`
            );
        } catch (e) {}
    });
    (joinedMUCs || []).forEach((roomName) => {
        const room = global.MUCs[roomName];
        if (!room) return;
        const m = room.members.findIndex((x) => x.accountId === data.accountId);
        if (m !== -1) room.members.splice(m, 1);
    });

    // Parties: if the disconnecting player had a party joininfo in their presence,
    // tell everyone else the member exited (same behavior as the WebSocket server).
    let partyId = "";
    try {
        const status = JSON.parse(data.lastPresenceUpdate.status || "{}");
        const props = status.Properties || status.properties;
        if (isObject(props)) {
            for (const key in props) {
                if (key.toLowerCase().startsWith("party.joininfo") && isObject(props[key])) {
                    partyId = props[key].partyId;
                }
            }
        }
    } catch (e) {}

    if (partyId && typeof partyId === "string") {
        const payload = xmlEscape(JSON.stringify({
            type: "com.epicgames.party.memberexited",
            payload: {
                partyId: partyId,
                memberId: data.accountId,
                wasKicked: false
            },
            timestamp: new Date().toISOString()
        }));
        global.Clients.forEach((other) => {
            try {
                other.client.send(
                    `<message id="${functions.MakeID().replace(/-/ig, "").toUpperCase()}" from="${data.jid}" xmlns="jabber:client" to="${other.jid}"><body>${payload}</body></message>`
                );
            } catch (e) {}
        });
    }
}

function pushPresenceTo(sendFn, accountId, jid) {
    const me = global.Clients.find((c) => c.accountId === accountId);
    const myStatus = (me && me.lastPresenceUpdate && me.lastPresenceUpdate.status) || DEFAULT_PRESENCE_STATUS;
    const myAway = me && me.lastPresenceUpdate && me.lastPresenceUpdate.away;

    // 1. Send every other online client’s presence to the new joiner
    global.Clients.forEach((c) => {
        if (c.accountId === accountId) return;
        if (c.isVirtualHost && !c.jid) return;
        const st = (c.lastPresenceUpdate && c.lastPresenceUpdate.status) || DEFAULT_PRESENCE_STATUS;
        const away = c.lastPresenceUpdate && c.lastPresenceUpdate.away;
        try {
            const show = away ? "<show>away</show>" : "";
            sendFn(
                `<presence to="${jid}" from="${c.jid}" xmlns="jabber:client" type="available">${show}<status>${st}</status></presence>`
            );
        } catch (e) {}
    });

    // 2. Critical for old clients: send the joiner their OWN presence
    //    (this is what stops “myself is offline”)
    try {
        sendFn(
            `<presence to="${jid}" from="${jid}" xmlns="jabber:client" type="available"><status>${myStatus}</status></presence>`
        );
    } catch (e) {}

    // 3. Announce the new joiner to everyone already online (so friends light up
    //    even if the client never sends its own <presence/> stanza yet)
    if (me && me.jid) {
        const show = myAway ? "<show>away</show>" : "";
        global.Clients.forEach((c) => {
            if (c.accountId === accountId || c.isVirtualHost) return;
            try {
                c.client.send(
                    `<presence to="${c.jid}" from="${me.jid}" xmlns="jabber:client" type="available">${show}<status>${myStatus}</status></presence>`
                );
            } catch (e) {}
        });
    }
}

function fanoutPresence(clientRef, body, away, offline) {
    const me = global.Clients.find((c) => c.client === clientRef);
    if (!me) return;
    const statusBody = (body && body !== "{}") ? body : DEFAULT_PRESENCE_STATUS;
    me.lastPresenceUpdate = { away: !!away, status: statusBody };

    global.Clients.forEach((c) => {
        if (c.accountId === me.accountId) return;
        if (c.isVirtualHost) return; // virtual hosts have no real socket
        try {
            if (offline) {
                c.client.send(
                    `<presence to="${c.jid}" from="${me.jid}" xmlns="jabber:client" type="unavailable"/>`
                );
            } else {
                const show = away ? "<show>away</show>" : "";
                c.client.send(
                    `<presence to="${c.jid}" from="${me.jid}" xmlns="jabber:client" type="available">${show}<status>${statusBody}</status></presence>`
                );
            }
        } catch (e) {}
    });

    // Also echo the presence back to the sender (some old clients need this)
    try {
        const show = away ? "<show>away</show>" : "";
        const type = offline ? ' type="unavailable"' : ' type="available"';
        clientRef.send(
            `<presence to="${me.jid}" from="${me.jid}" xmlns="jabber:client"${type}>${show}<status>${statusBody}</status></presence>`
        );
    } catch (e) {}
}

// AthenaOG-style helpers: force-send one player's current presence to another.
// Called when friendship is accepted so both sides light up immediately.
function sendPresenceTo(toAccountId, fromAccountId) {
    const to = global.Clients.find((c) => c.accountId === toAccountId && !c.isVirtualHost);
    const from = global.Clients.find((c) => c.accountId === fromAccountId);
    if (!to || !from || !to.client || !to.client.send) return;
    const lp = from.lastPresenceUpdate || { away: false, status: DEFAULT_PRESENCE_STATUS };
    const show = lp.away ? "<show>away</show>" : "";
    try {
        to.client.send(
            `<presence to="${to.jid}" from="${from.jid}" xmlns="jabber:client" type="available">${show}<status>${lp.status || DEFAULT_PRESENCE_STATUS}</status></presence>`
        );
    } catch (e) {}
}

function exchangePresence(accountIdA, accountIdB) {
    sendPresenceTo(accountIdA, accountIdB);
    sendPresenceTo(accountIdB, accountIdA);
}

function start() {
    console.log("[TCP-XMPP] *** FLEX MODE *** (optional STARTTLS + plain PLAIN)");
    ensureXmppCert().then(() => getTlsOptions()).catch(() => {});

    const server = net.createServer((rawSocket) => {
        console.log(
            "[TCP-XMPP] Connection from",
            rawSocket.remoteAddress + ":" + rawSocket.remotePort
        );
        rawSocket.setNoDelay(true);

        let socket = rawSocket;
        let buffer = "";
        let streamOpened = false;
        let Authenticated = false;
        let tlsUpgraded = false;
        let ID = "";
        let accountId = "";
        let displayName = "";
        let token = "";
        let resource = "";
        let jid = "";
        let clientExists = false;
        let closed = false;
        const joinedMUCs = [];
        let waitingForTLS = false;
        let streamDomain = global.xmppDomain;

        const clientRef = {
            send(data) {
                doSend(data);
            },
            close() {
                try {
                    socket.end();
                } catch (e) {}
            }
        };

        function doSend(data) {
            if (closed) return;
            try {
                if (WIRE_LOG) {
                    const p = String(data).length > 220 ? String(data).slice(0, 220) + "…" : data;
                    console.log("[TCP-XMPP] >>> SEND:", String(p).replace(/\n/g, "\\n"));
                }
                socket.write(typeof data === "string" ? data : String(data));
            } catch (e) {}
        }

        // Registers the bound client in the shared client list. Old builds that skip
        // the <session/> IQ (bind → presence directly) must still be visible, so this
        // runs right after bind instead of only in the session handler.
        function ensureRegistered() {
            if (clientExists || !Authenticated || !accountId || !jid) return;
            global.Clients = global.Clients.filter((c) => {
                if (c.accountId === accountId) {
                    try { c.client.close(); } catch (e) {}
                    return false;
                }
                return true;
            });
            global.Clients.push({
                client: clientRef,
                accountId,
                displayName,
                jid,
                resource,
                token,
                lastPresenceUpdate: { away: false, status: DEFAULT_PRESENCE_STATUS }
            });
            clientExists = true;
            console.log("[TCP-XMPP] ONLINE:", displayName, "total=", global.Clients.length);
        }

        function fail(reason) {
            console.log("[TCP-XMPP] auth fail:", reason || "");
            doSend(
                `<stream:error><not-authorized xmlns="urn:ietf:params:xml:ns:xmpp-streams"/></stream:error></stream:stream>`
            );
            try {
                socket.end();
            } catch (e) {}
        }

        function sendStreamOpenReply() {
            if (!ID) ID = functions.MakeID();
            // Stream header always first
            const header =
                `<?xml version="1.0"?><stream:stream xmlns:stream="http://etherx.jabber.org/streams" xmlns="jabber:client" from="${streamDomain}" id="${ID}" version="1.0" xml:lang="en">`;

            if (Authenticated) {
                // Post-auth: bind + session only
                doSend(
                    header +
                        `<stream:features><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></stream:features>`
                );
                return;
            }

            // Pre-auth features.
            // RFC / OG Fortnite behaviour:
            //  - Before TLS: advertise STARTTLS (optionally <required/>). Do NOT offer SASL yet
            //    when TLS is required — otherwise picky 2017 clients disconnect.
            //  - After TLS (or when offerStarttls=false): advertise PLAIN + iq-auth.
            let feat = `<stream:features>`;
            if (!tlsUpgraded && OFFER_STARTTLS) {
                if (REQUIRE_TLS) {
                    feat += `<starttls xmlns="urn:ietf:params:xml:ns:xmpp-tls"><required/></starttls>`;
                } else {
                    // Offer STARTTLS but also allow plaintext PLAIN (AthenaOG dual-mode).
                    feat += `<starttls xmlns="urn:ietf:params:xml:ns:xmpp-tls"/>`;
                    feat += `<mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>PLAIN</mechanism></mechanisms>`;
                    feat += `<auth xmlns="http://jabber.org/features/iq-auth"/>`;
                }
            } else {
                // Already on TLS, or plaintext-only mode
                feat += `<mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>PLAIN</mechanism></mechanisms>`;
                feat += `<auth xmlns="http://jabber.org/features/iq-auth"/>`;
            }
            feat += `</stream:features>`;
            doSend(header + feat);
            if (WIRE_LOG) {
                console.log(
                    "[TCP-XMPP] features sent | tls=" +
                        tlsUpgraded +
                        " offerStarttls=" +
                        OFFER_STARTTLS +
                        " requireTls=" +
                        REQUIRE_TLS
                );
            }
        }

        function upgradeToTLS(prefaceBuf) {
            if (tlsUpgraded) return;
            tlsUpgraded = true;
            waitingForTLS = false;
            console.log("[TCP-XMPP] upgrading to TLS…");

            // Pause plain handling
            rawSocket.removeAllListeners("data");

            // Put TLS preface back if we already read ClientHello bytes
            if (prefaceBuf && prefaceBuf.length) {
                try {
                    rawSocket.unshift(prefaceBuf);
                } catch (e) {}
            }

            const secure = new tls.TLSSocket(rawSocket, Object.assign({}, getTlsOptions(), { isServer: true }));
            socket = secure;
            streamOpened = false;
            buffer = "";

            secure.on("data", (buf) => onRawData(buf));
            secure.on("error", (err) => {
                console.log("[TCP-XMPP] TLS error:", err.message);
                console.log(
                    "[TCP-XMPP] HINT: if this is 'unsupported protocol' or handshake failure, the 2017 client needs TLS1.0 + a trusted CA cert (ZeroSSL), not Let's Encrypt / pure self-signed."
                );
            });
            secure.on("secure", () => {
                console.log(
                    "[TCP-XMPP] TLS handshake OK",
                    secure.getProtocol ? secure.getProtocol() : "",
                    secure.getCipher ? (secure.getCipher().name || "") : ""
                );
            });
            secure.on("close", onClose);
            console.log("[TCP-XMPP] STARTTLS/TLS active — waiting for client to re-open stream");
        }

        async function handleStanza(xmlStr) {
            if (xmlStr === "</stream:stream>") {
                try {
                    socket.end();
                } catch (e) {}
                return;
            }
            const msg = XMLParser(xmlStr);
            if (!msg || !msg.root || !msg.root.name) return;
            const name = msg.root.name;

            if (name === "starttls") {
                console.log("[TCP-XMPP] client requested STARTTLS → sending <proceed/>");
                doSend(`<proceed xmlns="urn:ietf:params:xml:ns:xmpp-tls"/>`);
                // Next bytes from client will be TLS ClientHello
                waitingForTLS = true;
                // Upgrade after proceed is flushed. Do NOT parse further plaintext.
                setImmediate(() => upgradeToTLS(null));
                return;
            }

            if (name === "auth") {
                if (!ID || accountId) return;
                if (!msg.root.content) return fail("empty auth");
                let decoded;
                try {
                    decoded = functions.DecodeBase64(msg.root.content);
                } catch (e) {
                    return fail("b64");
                }
                if (!decoded.includes("\u0000")) return fail("no nulls");
                const parts = decoded.split("\u0000");
                const loginName = parts[1] || parts[0] || "";
                const secret = parts[2] != null ? parts[2] : parts[1] || "";

                let account = null;
                try {
                    if (accountManager.accountFromToken)
                        account = await accountManager.accountFromToken(secret);
                } catch (e) {}
                try {
                    if (!account && accountManager.validateLogin)
                        account = await accountManager.validateLogin(loginName, secret);
                } catch (e) {}
                try {
                    if (!account && loginName && accountManager.validateLogin)
                        account = await accountManager.validateLogin(loginName, "");
                } catch (e) {}
                try {
                    if (!account && loginName && accountManager.getAccount)
                        account = accountManager.getAccount(loginName);
                } catch (e) {}
                try {
                    if (!account && loginName && accountManager.findByAccountId)
                        account = accountManager.findByAccountId(loginName);
                } catch (e) {}

                if (!account) return fail("unknown " + loginName);

                global.Clients = global.Clients.filter((c) => {
                    if (c.accountId === account.accountId) {
                        try {
                            c.client.close();
                        } catch (e) {}
                        return false;
                    }
                    return true;
                });

                accountId = account.accountId;
                displayName = account.displayName || account.accountId;
                token =
                    (accountManager.tokenFor && accountManager.tokenFor(account)) ||
                    secret ||
                    accountId;
                try {
                    await accountManager.ensureAccountProfiles(accountId);
                } catch (e) {}

                Authenticated = true;
                console.log("[TCP-XMPP] SASL OK:", displayName, "(" + accountId + ")");
                doSend(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
                streamOpened = false;
                return;
            }

            // Legacy IQ auth
            if (name === "iq") {
                if (!ID) return;
                const iqId = msg.root.attributes.id || "";
                const kids = msg.root.children || [];
                const q = kids.find(
                    (c) => c.name === "query" && (c.attributes.xmlns || "").includes("jabber:iq:auth")
                );
                if (q && (msg.root.attributes.type || "") === "set") {
                    const userEl = (q.children || []).find((c) => c.name === "username");
                    const passEl = (q.children || []).find((c) => c.name === "password");
                    const resEl = (q.children || []).find((c) => c.name === "resource");
                    const loginName = userEl && userEl.content ? userEl.content : "";
                    const secret = passEl && passEl.content ? passEl.content : "";
                    let account = null;
                    try {
                        if (accountManager.validateLogin)
                            account = await accountManager.validateLogin(loginName, secret);
                    } catch (e) {}
                    try {
                        if (!account && accountManager.getAccount)
                            account = accountManager.getAccount(loginName);
                    } catch (e) {}
                    if (!account) return fail("iq-auth unknown " + loginName);
                    accountId = account.accountId;
                    displayName = account.displayName || account.accountId;
                    token = secret || accountId;
                    resource = (resEl && resEl.content) || functions.MakeID();
                    jid = `${accountId}@${streamDomain}/${resource}`;
                    Authenticated = true;
                    clientExists = true;
                    global.Clients.push({
                        client: clientRef,
                        accountId,
                        displayName,
                        jid,
                        resource,
                        token,
                        lastPresenceUpdate: { away: false, status: DEFAULT_PRESENCE_STATUS }
                    });
                    console.log("[TCP-XMPP] IQ-AUTH OK:", displayName, "total=", global.Clients.length);
                    doSend(
                        `<iq type="result" id="${iqId}" xmlns="jabber:client"/>`
                    );
                    pushPresenceTo(doSend, accountId, jid);
                    return;
                }
                if (q && (msg.root.attributes.type || "") === "get") {
                    // fields
                    doSend(
                        `<iq type="result" id="${iqId}" xmlns="jabber:client"><query xmlns="jabber:iq:auth"><username/><password/><resource/></query></iq>`
                    );
                    return;
                }

                if (iqId === "_xmpp_bind1" || kids.some((c) => c.name === "bind")) {
                    if (resource || !accountId) return;
                    let res = functions.MakeID();
                    const bind = kids.find((c) => c.name === "bind");
                    if (bind) {
                        const r = (bind.children || []).find((c) => c.name === "resource");
                        if (r && r.content) res = r.content;
                    }
                    resource = res;
                    jid = `${accountId}@${streamDomain}/${resource}`;
                    doSend(
                        `<iq to="${jid}" id="${iqId || "_xmpp_bind1"}" xmlns="jabber:client" type="result"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>${jid}</jid></bind></iq>`
                    );
                    // Register now (not only on session) so builds that skip the
                    // session IQ still get a presence and appear online to friends.
                    ensureRegistered();
                    if (clientExists) pushPresenceTo(doSend, accountId, jid);
                    return;
                }

                if (iqId === "_xmpp_session1" || kids.some((c) => c.name === "session")) {
                    if (!accountId || !jid) return fail("session before bind");
                    if (!clientExists) {
                        clientExists = true;
                        global.Clients.push({
                            client: clientRef,
                            accountId,
                            displayName,
                            jid,
                            resource,
                            token,
                            lastPresenceUpdate: { away: false, status: DEFAULT_PRESENCE_STATUS }
                        });
                        console.log(
                            "[TCP-XMPP] ONLINE:",
                            displayName,
                            "total=",
                            global.Clients.length
                        );
                    }
                    doSend(
                        `<iq to="${jid}" from="${streamDomain}" id="${iqId || "_xmpp_session1"}" xmlns="jabber:client" type="result"/>`
                    );
                    pushPresenceTo(doSend, accountId, jid);
                    return;
                }

                const roster = kids.find(
                    (c) => c.name === "query" && (c.attributes.xmlns || "").includes("roster")
                );
                if (roster) {
                    doSend(
                        `<iq to="${jid}" from="${streamDomain}" id="${iqId}" xmlns="jabber:client" type="result"><query xmlns="jabber:iq:roster"/></iq>`
                    );
                    return;
                }

                if (clientExists) {
                    doSend(
                        `<iq to="${jid}" from="${streamDomain}" id="${iqId}" xmlns="jabber:client" type="result"/>`
                    );
                }
                return;
            }

            if (name === "presence") {
                if (!clientExists) return;
                const pType = msg.root.attributes.type || "available";
                const to = msg.root.attributes.to || "";

                // --- MUC rooms (party- rooms for parties, global chat rooms) ---
                if (to && (to.includes("@muc.") || to.toLowerCase().startsWith("party-"))) {
                    const roomName = to.split("@")[0];

                    if (pType === "unavailable") {
                        // Leave the room: confirm to self (code 110), inform remaining members
                        const room = global.MUCs[roomName];
                        if (room) {
                            const mi = room.members.findIndex((m) => m.accountId === accountId);
                            if (mi !== -1) room.members.splice(mi, 1);
                        }
                        const ji = joinedMUCs.indexOf(roomName);
                        if (ji !== -1) joinedMUCs.splice(ji, 1);

                        doSend(mucPresenceXML(roomName, { accountId, displayName, resource, jid }, jid, { type: "unavailable", statuses: [110, 100, 170] }));
                        const remaining = global.MUCs[roomName];
                        if (remaining) {
                            remaining.members.forEach((m) => {
                                const c = global.Clients.find((x) => x.accountId === m.accountId);
                                if (!c) return;
                                try {
                                    c.client.send(mucPresenceXML(roomName, { accountId, displayName, resource, jid }, c.jid, { type: "unavailable" }));
                                } catch (e) {}
                            });
                        }
                        return;
                    }

                    const room = global.MUCs[roomName] || (global.MUCs[roomName] = { members: [] });
                    const alreadyIn = !!room.members.find((m) => m.accountId === accountId);
                    if (!alreadyIn) {
                        room.members.push({ accountId, displayName, resource, jid });
                        if (!joinedMUCs.includes(roomName)) joinedMUCs.push(roomName);
                    }

                    const me = { accountId, displayName, resource, jid };

                    // Self presence (status 110 = self, 100/170/201 = room created/non-anon)
                    doSend(mucPresenceXML(roomName, me, jid, { statuses: [110, 100, 170, 201] }));

                    // Existing members' presence back to the joiner
                    room.members.forEach((m) => {
                        if (m.accountId === accountId) return;
                        doSend(mucPresenceXML(roomName, m, jid, {}));
                    });

                    // Broadcast the join to every other member (so their party UI updates)
                    if (!alreadyIn) {
                        room.members.forEach((m) => {
                            if (m.accountId === accountId) return;
                            const c = global.Clients.find((x) => x.accountId === m.accountId);
                            if (!c) return;
                            try {
                                c.client.send(mucPresenceXML(roomName, me, c.jid, {}));
                            } catch (e) {}
                        });
                    }
                    return;
                }

                if (pType === "unavailable") {
                    fanoutPresence(clientRef, "{}", false, true);
                    return;
                }
                const statusEl = (msg.root.children || []).find((c) => c.name === "status");
                const showEl = (msg.root.children || []).find((c) => c.name === "show");
                const body = statusEl && statusEl.content ? statusEl.content : "{}";
                const away = !!(showEl && showEl.content === "away");
                fanoutPresence(clientRef, body, away, false);
                return;
            }

            if (name === "message") {
                if (!clientExists) return;
                const bodyEl = (msg.root.children || []).find((c) => c.name === "body");
                if (!bodyEl || !bodyEl.content) return;
                const body = bodyEl.content;
                const msgType = msg.root.attributes.type || "";
                const to = msg.root.attributes.to || "";
                const msgId = msg.root.attributes.id || functions.MakeID().replace(/-/g, "").toUpperCase();

                // Party/global chat room message
                if (msgType === "groupchat" && to) {
                    const roomName = to.split("@")[0];
                    const room = global.MUCs[roomName];
                    if (!room) return;
                    if (!room.members.find((m) => m.accountId === accountId)) return;
                    const from = getMUCmember(roomName, displayName, accountId, resource);
                    room.members.forEach((m) => {
                        const c = global.Clients.find((x) => x.accountId === m.accountId);
                        if (!c) return;
                        try {
                            c.client.send(
                                `<message to="${c.jid}" from="${from}" id="${msgId}" xmlns="jabber:client" type="groupchat"><body>${xmlEscape(body)}</body></message>`
                            );
                        } catch (e) {}
                    });
                    return;
                }

                // Direct (whisper) chat
                if (msgType === "chat" && to) {
                    const receiver = global.Clients.find(
                        (c) => c.jid.split("/")[0] === to || c.jid === to
                    );
                    if (!receiver || receiver.accountId === accountId) return;
                    try {
                        receiver.client.send(
                            `<message to="${receiver.jid}" from="${jid}" id="${msgId}" xmlns="jabber:client" type="chat"><body>${xmlEscape(body)}</body></message>`
                        );
                    } catch (e) {}
                    return;
                }

                // No/other message type with a JSON body = party service events
                // (invites, joins, kicks, promotes, ...). Relay verbatim to the target JID.
                if (to && isJSONObject(body)) {
                    const parsed = JSON.parse(body);
                    if (!parsed || typeof parsed.type !== "string") return;
                    const receiver = global.Clients.find(
                        (c) => c.jid.split("/")[0] === to || c.jid === to
                    );
                    if (!receiver) return;
                    try {
                        receiver.client.send(
                            `<message to="${receiver.jid}" from="${jid}" id="${msgId}" xmlns="jabber:client"><body>${xmlEscape(body)}</body></message>`
                        );
                    } catch (e) {}
                }
            }
        }

        function processBuffer() {
            while (true) {
                if (!streamOpened) {
                    const r = tryExtractStreamOpen(buffer);
                    if (!r) break;
                    buffer = buffer.slice(r.consumed);
                    streamOpened = true;
                    if (r.to) streamDomain = adoptDomain(r.to);
                    else streamDomain = global.xmppDomain;
                    sendStreamOpenReply();
                    continue;
                }
                // Only parse XML stanzas if buffer looks like XML
                if (buffer.length && buffer.charCodeAt(0) > 0 && buffer[0] !== "<" && buffer.trim()[0] !== "<") {
                    break;
                }
                const r = extractStanza(buffer);
                if (!r) break;
                buffer = buffer.slice(r.consumed);
                handleStanza(r.xml).catch((e) =>
                    console.log("[TCP-XMPP] stanza err:", e.stack || e.message)
                );
            }
        }

        function onRawData(buf) {
            if (closed) return;

            // Detect TLS ClientHello even mid-connection
            if (!tlsUpgraded && Buffer.isBuffer(buf) && buf.length > 0 && buf[0] === 0x16) {
                console.log("[TCP-XMPP] detected TLS ClientHello bytes");
                upgradeToTLS(buf);
                return;
            }

            const str = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
            if (WIRE_LOG) {
                const p = str.length > 220 ? str.slice(0, 220) + "…" : str;
                console.log("[TCP-XMPP] <<< RECV:", JSON.stringify(p));
            }
            buffer += str;
            processBuffer();
        }

        function onClose() {
            if (closed) return;
            closed = true;
            console.log(
                "[TCP-XMPP] closed | accountId:",
                accountId || "(none)",
                "| auth:",
                Authenticated,
                "| tls:",
                tlsUpgraded
            );
            if (!Authenticated) {
                console.log(
                    "[TCP-XMPP] HINT: client left before auth. " +
                        (OFFER_STARTTLS
                            ? "STARTTLS is ON — 2017 clients need a ZeroSSL/Sectigo cert (self-signed usually fails)."
                            : "Plaintext mode (offerStarttls=false). If the client still drops, this build refuses non-TLS XMPP and you need a trusted cert OR a client-side cert-bypass DLL.")
                );
            }
            clientExists = false;
            RemoveClient(clientRef, joinedMUCs);
        }

        rawSocket.on("data", onRawData);
        rawSocket.on("close", onClose);
        rawSocket.on("error", (err) => {
            if (WIRE_LOG) console.log("[TCP-XMPP] sock err:", err.message);
        });
    });

    server.on("error", (err) =>
        console.log("[TCP-XMPP] FAILED port", TCP_PORT, err && err.message)
    );
    server.listen(TCP_PORT, "0.0.0.0", () => {
        console.log(
            "[TCP-XMPP] listening 0.0.0.0:" + TCP_PORT + " domain=" + XMPP_DOMAIN
        );
        console.log(
            "[TCP-XMPP] accepts: STARTTLS | implicit TLS | plain PLAIN | iq-auth | offerStarttls=" +
                OFFER_STARTTLS
        );
        console.log(
            DOMAIN_LOCKED
                ? "[TCP-XMPP] domain locked to " + XMPP_DOMAIN + " (lockDomain=true)"
                : "[TCP-XMPP] domain is flexible - bare IP ServerAddr works (pair with XMPPCertBypass.dll if using self-signed cert)"
        );
    });
    return server;
}

module.exports = {
    start,
    sendPresenceTo,
    exchangePresence,
    pushPresenceTo,
    fanoutPresence,
    DEFAULT_PRESENCE_STATUS
};