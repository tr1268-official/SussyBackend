/**
 * End-to-end test for the v1.11-era matchmaker (live queue + port wait) and
 * the TCP XMPP server (party flows).
 *
 * Run:  node tests/e2e_matchmaker_xmpp.js
 *
 * It boots the real server on test ports and asserts:
 *   1. Ticket endpoint returns a ws:// serviceUrl that honors XMPP_PORT/GAMESERVER_IP env.
 *   2. Matchmaker WS sends Connecting/Waiting/Queued with the REAL per-playlist queue size.
 *   3. Queued players stay queued (no Play) while the game server port is closed.
 *   4. As soon as the port opens, everyone gets SessionAssignment + Play and leaves the queue.
 *   5. TCP XMPP: SASL login, MUC party-room join (self + broadcast presence),
 *      groupchat relay, JSON party-message relay, and com.epicgames.party.memberexited
 *      broadcast when a party member disconnects.
 */
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const WebSocket = require("ws");

const HTTP_PORT = 3571;
const WS_PORT = 8090;
const XMPP_TCP_PORT = 5223;
const GS_PORT = 7777;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

const results = [];
function check(name, ok, extra) {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : "  -> " + extra}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeout, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        const v = fn();
        if (v) return v;
        await sleep(40);
    }
    throw new Error("timeout waiting for " + label);
}

// ---------------------------------------------------------------- matchmaker ws
function openMatchmakerWs(accountId) {
    return new Promise(async (resolve, reject) => {
        const frames = [];
        const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/`);
        const timer = setTimeout(() => reject(new Error("matchmaker ws handshake timeout")), 8000);
        ws.on("error", (e) => { clearTimeout(timer); reject(e); });
        ws.on("message", (m) => {
            try { frames.push(JSON.parse(m.toString())); } catch (e) {}
        });
        ws.on("open", () => { clearTimeout(timer); resolve({ ws, frames }); });
    });
}

function stateFrames(frames, state) {
    return frames.filter((f) => f.name === "StatusUpdate" && f.payload && f.payload.state === state);
}

// ---------------------------------------------------------------- xmpp tcp client
class XmppClient {
    constructor(label) {
        this.label = label;
        this.data = "";
        this.closed = false;
        this.socket = null;
    }
    connect() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${this.label}: tcp connect timeout`)), 8000);
            this.socket = net.connect(XMPP_TCP_PORT, "127.0.0.1", () => { clearTimeout(timer); resolve(); });
            this.socket.setNoDelay(true);
            this.socket.on("data", (d) => { this.data += d.toString("utf8"); });
            this.socket.on("close", () => { this.closed = true; });
            this.socket.on("error", () => {});
        });
    }
    send(str) { this.socket.write(str); }
    destroy() { try { this.socket.destroy(); } catch (e) {} }
    async wait(pred, timeout, label) {
        return waitUntil(() => (this.closed ? null : (pred(this.data) || null)), timeout, `${this.label}: ${label}`);
    }
}

function substr(s) {
    return (data) => (data.includes(s) ? s : null);
}

async function loginXmpp(client, user, pass) {
    client.send(`<?xml version="1.0"?><stream:stream to="prod.ol.epicgames.com" version="1.0" xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams">`);
    await client.wait(substr("<stream:stream"), 8000, "stream open");
    await client.wait(substr("xmpp-sasl"), 8000, "stream features");

    const b64 = Buffer.from(`\u0000${user}\u0000${pass}`).toString("base64");
    client.send(`<auth mechanism="PLAIN" xmlns="urn:ietf:params:xml:ns:xmpp-sasl">${b64}</auth>`);
    await client.wait(substr("<success"), 8000, "sasl success");

    client.send(`<?xml version="1.0"?><stream:stream to="prod.ol.epicgames.com" version="1.0" xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams">`);
    await client.wait(substr("xmpp-bind"), 8000, "bind feature");

    client.send(`<iq id="_xmpp_bind1" type="set"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>V2:Fortnite:WIN</resource></bind></iq>`);
    await client.wait(substr(`<jid>${user}@prod.ol.epicgames.com/V2:Fortnite:WIN</jid>`), 8000, "bind result");

    client.send(`<iq id="_xmpp_session1" type="set"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>`);
    await client.wait(substr(`id="_xmpp_session1"`), 8000, "session result");
}

// ---------------------------------------------------------------- main
(async () => {
    let server = null;
    let gameServer = null;
    const cleanupFns = [];

    try {
        // ---- boot the backend on test ports
        server = spawn(process.execPath, ["index.js"], {
            cwd: path.join(__dirname, ".."),
            env: Object.assign({}, process.env, {
                PORT: String(HTTP_PORT),
                XMPP_PORT: String(WS_PORT),
                XMPP_TCP_PORT: String(XMPP_TCP_PORT),
                GAMESERVER_IP: "127.0.0.1",
                GAMESERVER_PORT: String(GS_PORT),
                MATCHMAKER_PROBE: "tcp"
            }),
            stdio: ["ignore", "pipe", "pipe"]
        });
        let serverLog = "";
        server.stdout.on("data", (d) => { serverLog += d.toString(); });
        server.stderr.on("data", (d) => { serverLog += d.toString(); });
        cleanupFns.push(() => { try { server.kill(); } catch (e) {} });

        await waitUntil(() => serverLog.includes("started listening"), 20000, "backend boot");

        // ---- 1. ticket endpoint
        const ticketRes = await fetch(`${BASE}/fortnite/api/game/v2/matchmakingservice/ticket/player/qa-player?bucketId=0:0:EU:Playlist_DefaultSolo`);
        const ticket = await ticketRes.json();
        check("ticket serviceUrl honors XMPP_PORT", ticket.serviceUrl === `ws://127.0.0.1:${WS_PORT}`, "got " + ticket.serviceUrl);

        // ---- 2. first matchmaker connection: real queue size
        const m1 = await openMatchmakerWs("qa1");
        cleanupFns.push(() => { try { m1.ws.close(); } catch (e) {} });
        await waitUntil(() => stateFrames(m1.frames, "Queued").length > 0, 10000, "m1 Queued");
        const q1 = stateFrames(m1.frames, "Queued").pop();
        check("m1 Queued shows queuedPlayers=1", q1.payload.queuedPlayers === 1, JSON.stringify(q1.payload));
        check("m1 got Connecting+Waiting first", stateFrames(m1.frames, "Connecting").length === 1 && stateFrames(m1.frames, "Waiting").length === 1);

        // ---- 3. second player joins the same playlist queue
        await fetch(`${BASE}/fortnite/api/game/v2/matchmakingservice/ticket/player/qa2?bucketId=0:0:EU:Playlist_DefaultSolo`);
        const m2 = await openMatchmakerWs("qa2");
        cleanupFns.push(() => { try { m2.ws.close(); } catch (e) {} });
        await waitUntil(() => stateFrames(m2.frames, "Queued").length > 0, 10000, "m2 Queued");
        const q2 = stateFrames(m2.frames, "Queued").pop();
        check("m2 Queued shows queuedPlayers=2 (live count)", q2.payload.queuedPlayers === 2, JSON.stringify(q2.payload));

        const snap = await (await fetch(`${BASE}/matchmaking/queue`)).json();
        check("queue endpoint reports 2 for Playlist_DefaultSolo", snap.playlists.Playlist_DefaultSolo === 2 && snap.total === 2, JSON.stringify(snap.playlists));

        // ---- 4. port closed => nobody is released
        await sleep(6000);
        check("no Play while game port is closed", stateFrames(m1.frames, "SessionAssignment").length === 0 && stateFrames(m1.frames, "Play").length === 0, JSON.stringify(m1.frames));
        const refreshed = stateFrames(m1.frames, "Queued");
        check("m1 receives refreshed live queue statuses", refreshed.length >= 2, "got " + refreshed.length);
        check("refreshed status still shows real count", refreshed[refreshed.length - 1].payload.queuedPlayers === 2);

        // ---- 5. game server port opens => everyone is released
        gameServer = net.createServer(() => {});
        await new Promise((r) => gameServer.listen(GS_PORT, "127.0.0.1", r));
        cleanupFns.push(() => { try { gameServer.close(); } catch (e) {} });

        await waitUntil(() => m1.frames.some((f) => f.name === "Play") && m2.frames.some((f) => f.name === "Play"), 10000, "Play frames");
        const play1 = m1.frames.find((f) => f.name === "Play");
        check("Play has matchId+sessionId after port opens", !!(play1.payload.matchId && play1.payload.sessionId));
        check("SessionAssignment preceded Play", stateFrames(m1.frames, "SessionAssignment").length > 0);

        await sleep(300);
        const snap2 = await (await fetch(`${BASE}/matchmaking/queue`)).json();
        check("queue empties after assignment", snap2.total === 0, JSON.stringify(snap2.playlists));
        m1.ws.close();
        m2.ws.close();
        await sleep(300);
        const snap3 = await (await fetch(`${BASE}/matchmaking/queue`)).json();
        check("closing sockets after assignment doesn't double-count", snap3.total === 0, JSON.stringify(snap3.playlists));

        // ---- 6. TCP XMPP party flows
        const A = new XmppClient("A(test)");
        const B = new XmppClient("B(LawinServer)");
        cleanupFns.push(() => { A.destroy(); B.destroy(); });
        await A.connect();
        await B.connect();

        await loginXmpp(A, "test", "test");
        await loginXmpp(B, "LawinServer", "password");
        check("TCP XMPP SASL login for both clients", A.data.includes("<success") && B.data.includes("<success"));

        // A sets party presence and joins the party MUC room
        A.send(`<presence xmlns="jabber:client"><status>{"Status":"lobby","bIsAway":false,"Properties":{"party.joininfo":{"buildUniqueId":"0","partyId":"P-E2E-1"}}}</status></presence>`);
        A.send(`<presence to="party-e2eroom@muc.prod.ol.epicgames.com" xmlns="jabber:client"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
        await A.wait(substr("code=\"110\""), 8000, "A self muc presence");
        check("A joins party room (110 self presence)", true);

        // B joins the same room => A receives B's join broadcast, B receives A as existing member
        B.send(`<presence to="party-e2eroom@muc.prod.ol.epicgames.com" xmlns="jabber:client"><x xmlns="http://jabber.org/protocol/muc"/></presence>`);
        await A.wait(substr(`party-e2eroom@muc.prod.ol.epicgames.com/${encodeURI("LawinServer")}`), 8000, "A sees B join");
        await B.wait(substr(`party-e2eroom@muc.prod.ol.epicgames.com/${encodeURI("test")}`), 8000, "B sees A as member");
        check("MUC join presence exchanged both ways", true);

        // Party chat (groupchat) from B reaches A (and echoes to B)
        B.send(`<message to="party-e2eroom@muc.prod.ol.epicgames.com" type="groupchat" xmlns="jabber:client"><body>hello-party</body></message>`);
        await A.wait(substr("hello-party"), 8000, "A receives groupchat");
        check("groupchat (party chat) relayed to room members", A.data.includes("hello-party"));

        // JSON party message (e.g. invite) A -> B, id preserved
        A.send(`<message to="LawinServer@prod.ol.epicgames.com" id="INVITE1" xmlns="jabber:client"><body>{"type":"com.epicgames.party.invite","payload":{"partyId":"P-E2E-1"}}</body></message>`);
        await B.wait(substr("com.epicgames.party.invite"), 8000, "B receives party invite");
        check("JSON party message relayed with id", B.data.includes("INVITE1"));

        // A disconnects => B gets unavailable presence + memberexited with the partyId
        A.destroy();
        await B.wait(substr("com.epicgames.party.memberexited"), 8000, "B receives memberexited");
        const exitedOk = B.data.includes("com.epicgames.party.memberexited") && B.data.includes("P-E2E-1");
        check("disconnect broadcasts com.epicgames.party.memberexited", exitedOk);
        await B.wait(substr(`type="unavailable"`), 8000, "B sees A unavailable");
        check("disconnect sends unavailable presence", true);

        B.destroy();
    } catch (err) {
        console.log("FAIL  unexpected: " + (err && err.stack || err));
        results.push({ name: "no unexpected error", ok: false });
    } finally {
        cleanupFns.reverse().forEach((f) => { try { f(); } catch (e) {} });
        await sleep(400);
        try { if (server) server.kill(); } catch (e) {}
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
})();
