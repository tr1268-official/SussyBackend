const Express = require("express");
const express = Express.Router();
const accountManager = require("./accountManager.js");
const functions = require("./functions.js");

function notifyFriendRequest(fromId, toId, status) {
    const ts = new Date().toISOString();
    try {
        functions.sendXmppMessageToAll({
            type: "FRIENDSHIP_REQUEST",
            timestamp: ts,
            from: fromId,
            to: toId,
            status: status || "PENDING"
        });
        functions.sendXmppMessageToAll({
            payload: {
                accountId: fromId,
                status: status || "PENDING",
                direction: "INBOUND",
                created: ts,
                favorite: false
            },
            type: "com.epicgames.friends.core.apiobjects.Friend",
            timestamp: ts
        });
        // targeted-style duplicate for clients that filter by account
        functions.sendXmppMessageToAll({
            payload: {
                accountId: toId,
                status: status || "PENDING",
                direction: "OUTBOUND",
                created: ts,
                favorite: false
            },
            type: "com.epicgames.friends.core.apiobjects.Friend",
            timestamp: ts
        });
    } catch (e) {
        console.log("[Friends] XMPP notify failed:", e.message);
    }
}

function notifyFriendship(a, b) {
    const ts = new Date().toISOString();
    try {
        functions.sendXmppMessageToAll({
            type: "FRIENDSHIP_REQUEST",
            timestamp: ts,
            from: a,
            to: b,
            status: "ACCEPTED"
        });
        functions.sendXmppMessageToAll({
            payload: {
                accountId: a,
                status: "ACCEPTED",
                direction: "OUTBOUND",
                created: ts,
                favorite: false
            },
            type: "com.epicgames.friends.core.apiobjects.Friend",
            timestamp: ts
        });
        functions.sendXmppMessageToAll({
            payload: {
                accountId: b,
                status: "ACCEPTED",
                direction: "OUTBOUND",
                created: ts,
                favorite: false
            },
            type: "com.epicgames.friends.core.apiobjects.Friend",
            timestamp: ts
        });
        // AthenaOG-style: immediately exchange presence so both sides show Online
        if (typeof functions.exchangePresence === "function") {
            functions.exchangePresence(a, b);
        }
    } catch (e) {
        console.log("[Friends] XMPP notify failed:", e.message);
    }
}

function resolveFriendId(raw) {
    let acc = accountManager.findAccount({ accountId: raw });
    if (!acc) acc = accountManager.findAccount({ username: raw });
    if (!acc) acc = accountManager.findAccount({ email: raw });
    return acc;
}

function ensureLists(doc) {
    doc.list = doc.list || {};
    doc.list.accepted = doc.list.accepted || [];
    doc.list.incoming = doc.list.incoming || [];
    doc.list.outgoing = doc.list.outgoing || [];
    doc.list.blocked = doc.list.blocked || [];
    return doc;
}

/** Core: send request or accept if reverse pending */
function sendOrAccept(senderId, receiverId) {
    senderId = accountManager.sanitizeAccountId(senderId);
    receiverId = accountManager.sanitizeAccountId(receiverId);
    if (senderId === receiverId) return { ok: false, reason: "self" };

    const a = ensureLists(accountManager.ensureFriends(senderId));
    const b = ensureLists(accountManager.ensureFriends(receiverId));
    const now = new Date().toISOString();

    // already friends
    if (a.list.accepted.find(f => f.accountId === receiverId)) {
        return { ok: true, status: "ACCEPTED" };
    }

    // receiver already sent us a request -> accept both ways
    const pendingFromThem = a.list.incoming.find(f => f.accountId === receiverId);
    if (pendingFromThem) {
        a.list.incoming = a.list.incoming.filter(f => f.accountId !== receiverId);
        b.list.outgoing = b.list.outgoing.filter(f => f.accountId !== senderId);
        a.list.outgoing = a.list.outgoing.filter(f => f.accountId !== receiverId);
        b.list.incoming = b.list.incoming.filter(f => f.accountId !== senderId);
        if (!a.list.accepted.find(f => f.accountId === receiverId)) {
            a.list.accepted.push({ accountId: receiverId, created: now, favorite: false });
        }
        if (!b.list.accepted.find(f => f.accountId === senderId)) {
            b.list.accepted.push({ accountId: senderId, created: now, favorite: false });
        }
        accountManager.saveFriends(senderId, a);
        accountManager.saveFriends(receiverId, b);
        notifyFriendship(senderId, receiverId);
        console.log("[Friends] ACCEPTED", senderId, "<->", receiverId);
        return { ok: true, status: "ACCEPTED" };
    }

    // create pending
    if (!a.list.outgoing.find(f => f.accountId === receiverId)) {
        a.list.outgoing.push({ accountId: receiverId, created: now });
    }
    if (!b.list.incoming.find(f => f.accountId === senderId)) {
        b.list.incoming.push({ accountId: senderId, created: now });
    }
    accountManager.saveFriends(senderId, a);
    accountManager.saveFriends(receiverId, b);
    notifyFriendRequest(senderId, receiverId, "PENDING");
    console.log("[Friends] REQUEST", senderId, "->", receiverId);
    return { ok: true, status: "PENDING" };
}

function removeFriendship(senderId, receiverId) {
    senderId = accountManager.sanitizeAccountId(senderId);
    receiverId = accountManager.sanitizeAccountId(receiverId);
    const a = ensureLists(accountManager.ensureFriends(senderId));
    const b = ensureLists(accountManager.ensureFriends(receiverId));
    for (const key of ["accepted", "incoming", "outgoing"]) {
        a.list[key] = a.list[key].filter(f => f.accountId !== receiverId);
        b.list[key] = b.list[key].filter(f => f.accountId !== senderId);
    }
    accountManager.saveFriends(senderId, a);
    accountManager.saveFriends(receiverId, b);
    console.log("[Friends] REMOVED", senderId, receiverId);
}

express.get("/friends/api/v1/*/settings", async (req, res) => {
    res.json({ acceptInvites: "public" });
});

express.get("/friends/api/v1/*/blocklist", async (req, res) => {
    res.json([]);
});

express.get("/friends/api/public/blocklist/*", async (req, res) => {
    res.json({ blockedUsers: [] });
});

express.get("/friends/api/public/list/fortnite/*/recentPlayers", async (req, res) => {
    res.json([]);
});

express.get("/friends/api/v1/:accountId/blocklist", async (req, res) => {
    res.json([]);
});

// Legacy list: accepted + pending (inbound/outbound)
express.get("/friends/api/public/friends/:accountId", async (req, res) => {
    const accountId = accountManager.sanitizeAccountId(req.params.accountId);
    const doc = ensureLists(accountManager.ensureFriends(accountId));
    const out = [];

    for (const f of doc.list.accepted) {
        out.push({
            accountId: f.accountId,
            status: "ACCEPTED",
            direction: "OUTBOUND",
            created: f.created || new Date().toISOString(),
            favorite: !!f.favorite
        });
    }
    for (const f of doc.list.incoming) {
        out.push({
            accountId: f.accountId,
            status: "PENDING",
            direction: "INBOUND",
            created: f.created || new Date().toISOString(),
            favorite: false
        });
    }
    for (const f of doc.list.outgoing) {
        out.push({
            accountId: f.accountId,
            status: "PENDING",
            direction: "OUTBOUND",
            created: f.created || new Date().toISOString(),
            favorite: false
        });
    }
    res.json(out);
});

// Summary (S7+)
express.get("/friends/api/v1/:accountId/summary", async (req, res) => {
    const accountId = accountManager.sanitizeAccountId(req.params.accountId);
    const doc = ensureLists(accountManager.ensureFriends(accountId));
    const L = doc.list;

    res.json({
        friends: L.accepted.map(f => ({
            accountId: f.accountId,
            groups: f.groups || [],
            mutual: f.mutual || 0,
            alias: f.alias || "",
            note: f.note || "",
            favorite: !!f.favorite,
            created: f.created || new Date().toISOString()
        })),
        incoming: L.incoming.map(f => ({
            accountId: f.accountId,
            groups: [],
            mutual: 0,
            alias: "",
            note: "",
            favorite: false,
            created: f.created || new Date().toISOString()
        })),
        outgoing: L.outgoing.map(f => ({
            accountId: f.accountId,
            groups: [],
            mutual: 0,
            alias: "",
            note: "",
            favorite: false,
            created: f.created || new Date().toISOString()
        })),
        suggested: [],
        blocklist: (L.blocked || []).map(f => ({ accountId: f.accountId })),
        settings: {
            acceptInvites: "public"
        }
    });
});

// Send friend request OR accept if they already requested you
express.post("/friends/api/v1/:accountId/friends/:friendId", async (req, res) => {
    const accountId = accountManager.sanitizeAccountId(req.params.accountId);
    const friendAcc = resolveFriendId(req.params.friendId);
    if (!friendAcc) {
        return res.status(404).json({
            errorCode: "errors.com.epicgames.account.account_not_found",
            errorMessage: "Sorry, we couldn't find an account for " + req.params.friendId,
            numericErrorCode: 18007
        });
    }
    const result = sendOrAccept(accountId, friendAcc.accountId);
    if (!result.ok && result.reason === "self") {
        return res.status(400).json({ error: "cannot friend self" });
    }
    res.status(204).end();
});

// DELETE = remove friend / cancel request / reject
express.delete("/friends/api/v1/:accountId/friends/:friendId", async (req, res) => {
    const accountId = accountManager.sanitizeAccountId(req.params.accountId);
    const friendAcc = resolveFriendId(req.params.friendId);
    const friendId = friendAcc ? friendAcc.accountId : accountManager.sanitizeAccountId(req.params.friendId);
    removeFriendship(accountId, friendId);
    res.status(204).end();
});

// Alternate paths (various seasons)
express.post("/friends/api/*/friends*/:receiverId", async (req, res) => {
    const auth = req.headers["authorization"] || "";
    let me = accountManager.accountFromToken(auth);
    if (!me) {
        // path may include account id
        const parts = String(req.params[0] || "").split("/").filter(Boolean);
        me = { accountId: accountManager.sanitizeAccountId(parts[0] || "default") };
    }
    const friendAcc = resolveFriendId(req.params.receiverId);
    if (!friendAcc) {
        return res.status(404).json({
            errorCode: "errors.com.epicgames.account.account_not_found",
            errorMessage: "Sorry, we couldn't find an account for " + req.params.receiverId,
            numericErrorCode: 18007
        });
    }
    sendOrAccept(me.accountId, friendAcc.accountId);
    res.status(204).end();
});

express.delete("/friends/api/*/friends*/:receiverId", async (req, res) => {
    const auth = req.headers["authorization"] || "";
    let me = accountManager.accountFromToken(auth);
    if (!me) {
        const parts = String(req.params[0] || "").split("/").filter(Boolean);
        me = { accountId: accountManager.sanitizeAccountId(parts[0] || "default") };
    }
    const friendAcc = resolveFriendId(req.params.receiverId);
    const friendId = friendAcc ? friendAcc.accountId : accountManager.sanitizeAccountId(req.params.receiverId);
    removeFriendship(me.accountId, friendId);
    res.status(204).end();
});

// Accept alias used by some builds: PUT or POST on incoming
express.post("/friends/api/v1/:accountId/incoming/:friendId", async (req, res) => {
    sendOrAccept(req.params.accountId, req.params.friendId);
    res.status(204).end();
});

express.put("/friends/api/v1/:accountId/friends/:friendId", async (req, res) => {
    sendOrAccept(req.params.accountId, req.params.friendId);
    res.status(204).end();
});

module.exports = express;
