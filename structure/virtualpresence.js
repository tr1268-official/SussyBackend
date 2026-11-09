// virtualPresence.js
// Tracks "online" status for clients that never open a real XMPP (WS) connection —
// i.e. pre-Season 4 builds that use TCP-XMPP or nothing at all.
// Real WS clients (global.Clients from XMPP.js) will see these as normal
// available/unavailable presence pushes.

const XMLBuilder = require("xmlbuilder");

const HEARTBEAT_TIMEOUT_MS = 90 * 1000; // expire if no heartbeat in 90s
const SWEEP_INTERVAL_MS = 15 * 1000;

if (!global.xmppDomain) global.xmppDomain = "prod.ol.epicgames.com";
if (!global.Clients) global.Clients = [];

/**
 * Call this from your login/token-grant handler once you've identified
 * the request is coming from a pre-S4 client and auth succeeded.
 */
function markOnline(accountId, displayName) {
    if (!accountId) return;

    let existing = global.Clients.find(i => i.accountId == accountId);

    // Already has a real XMPP session (WS) — don't shadow it with a virtual one.
    if (existing && !existing.isVirtualHost) {
        return;
    }

    const resource = "V2:Fortnite:WIN::legacy";
    const jid = `${accountId}@${global.xmppDomain}/${resource}`;

    if (existing && existing.isVirtualHost) {
        // Just refresh heartbeat, don't re-broadcast presence spam
        existing.lastSeen = Date.now();
        return;
    }

    const virtualClient = {
        client: { send: () => {} }, // nothing real to deliver to
        accountId,
        displayName: displayName || accountId,
        token: "",
        jid,
        resource,
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
    };

    global.Clients.push(virtualClient);
    broadcastPresence(jid, "available");

    console.log(`[VirtualPresence] ${displayName || accountId} (${accountId}) marked online (legacy client)`);
}

/**
 * Call this on logout, or let the heartbeat sweep handle it automatically.
 */
function markOffline(accountId) {
    let idx = global.Clients.findIndex(i => i.accountId == accountId && i.isVirtualHost);
    if (idx == -1) return;

    let client = global.Clients[idx];
    global.Clients.splice(idx, 1);
    broadcastPresence(client.jid, "unavailable");

    console.log(`[VirtualPresence] ${client.displayName} (${accountId}) marked offline (legacy client)`);
}

/**
 * Call this from any frequently-polled endpoint the legacy client hits
 * (heartbeat, QueryProfile, matchmaking ping, etc.) to keep the entry alive.
 */
function heartbeat(accountId, displayName) {
    let existing = global.Clients.find(i => i.accountId == accountId && i.isVirtualHost);
    if (existing) {
        existing.lastSeen = Date.now();
    } else {
        markOnline(accountId, displayName);
    }
}

function broadcastPresence(fromJid, type) {
    const fromClient = global.Clients.find(c => c.jid == fromJid);
    const status = (fromClient && fromClient.lastPresenceUpdate && fromClient.lastPresenceUpdate.status) ||
        JSON.stringify({
            Status: "Online",
            bIsPlaying: false,
            bIsJoinable: false,
            bHasVoiceSupport: false,
            ProductName: "Fortnite",
            SessionId: ""
        });
    global.Clients.forEach(ClientData => {
        if (ClientData.jid == fromJid || ClientData.isVirtualHost) return;
        if (!ClientData.client || !ClientData.client.send) return;
        try {
            ClientData.client.send(XMLBuilder.create("presence")
                .attribute("to", ClientData.jid)
                .attribute("xmlns", "jabber:client")
                .attribute("from", fromJid)
                .attribute("type", type)
                .element("status", status).up().toString());
        } catch (e) {}
    });
}

// Periodic sweep to expire stale virtual entries (covers clients that
// crash/close without hitting a logout endpoint).
setInterval(() => {
    const now = Date.now();
    const stale = global.Clients.filter(i => i.isVirtualHost && (now - i.lastSeen) > HEARTBEAT_TIMEOUT_MS);
    for (const client of stale) {
        markOffline(client.accountId);
    }
}, SWEEP_INTERVAL_MS);

module.exports = { markOnline, markOffline, heartbeat };