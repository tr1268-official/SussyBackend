/**
 * matchmaker.js — v1.11 matchmaker
 *
 * v1.11 CLIENT REQUIREMENT:
 *   Must send Connecting → Waiting early or the client closes the socket (code 1000).
 *   There is no way around this — the client protocol demands it.
 *
 * After that we can stay on Queued with the REAL player count while the
 * gameserver port is closed, then SessionAssignment → Play once it opens.
 *
 * In-game UI will briefly flash "Waiting for server..." then show the queue.
 * When the port opens it progresses into the session.
 */
const functions = require("./functions.js");
const mmQueue = require("./mmQueue.js");

module.exports = async (ws) => {
  ws.on("message", () => {});
  ws.on("error", (err) => {
    console.log(`[Matchmaker] socket error:`, err && err.message);
  });

  const ticket = mmQueue.claimTicket();
  const playlist = (ticket && ticket.playlist) || "Playlist_DefaultSolo";
  const bucketId = (ticket && ticket.bucketId) || "";
  const accountId = (ticket && ticket.accountId) || "";

  const ticketId = functions.MakeID().replace(/-/gi, "");
  const matchId = functions.MakeID().replace(/-/gi, "");
  const sessionId = functions.MakeID().replace(/-/gi, "");

  let inQueue = false;
  let assigned = false;
  let closed = false;

  function onClosed(code, reason) {
    if (closed) return;
    closed = true;
    if (inQueue && !assigned) {
      mmQueue.leaveQueue(playlist);
      console.log(
        `[Matchmaker] ${accountId || "anon"} left ${playlist}` +
        ` (${mmQueue.getQueueSize(playlist)} left)` +
        (code != null ? ` close=${code}` : "") +
        (reason ? ` reason=${String(reason)}` : "")
      );
    }
  }

  ws.on("close", (code, reason) => onClosed(code, reason));

  const queueSize = mmQueue.joinQueue(playlist);
  inQueue = true;

  console.log(
    `[Matchmaker] ${accountId || "anon"} queued for ${playlist}` +
    (bucketId ? ` (${bucketId})` : "") +
    ` — ${queueSize} in queue`
  );

  await functions.sleep(100);
  if (closed) return;

  function alive() {
    return !closed && ws.readyState === 1;
  }

  function send(name, payload) {
    if (!alive()) return false;
    try {
      ws.send(JSON.stringify({ name, payload }));
      console.log(`[Matchmaker] >> ${name} ${JSON.stringify(payload).slice(0, 160)}`);
      return true;
    } catch (e) {
      console.log(`[Matchmaker] send error:`, e && e.message);
      onClosed();
      return false;
    }
  }

  function status(payload) {
    return send("StatusUpdate", payload);
  }

  function liveCount() {
    return Math.max(mmQueue.getQueueSize(playlist), 1);
  }

  // 1. Connecting  (required)
  if (!status({ state: "Connecting" })) return;
  await functions.sleep(700);
  if (closed) return;

  // 2. Waiting  (REQUIRED by v1.11 — skipping this = client close 1000)
  //    This is the brief "Waiting for server..." flash. Unavoidable.
  if (!status({
    totalPlayers: liveCount(),
    connectedPlayers: liveCount(),
    state: "Waiting"
  })) return;
  await functions.sleep(700);
  if (closed) return;

  // 3. Queued with REAL player count
  function sendQueued(waitedSec) {
    return status({
      ticketId: ticketId,
      queuedPlayers: liveCount(),
      estimatedWaitSec: Math.max(0, Math.round(45 - (waitedSec || 0))),
      status: {},
      state: "Queued"
    });
  }

  if (!sendQueued(0)) return;
  await functions.sleep(400);
  if (closed) return;

  // 4. Hold on Queued while gameserver port is CLOSED
  const target = mmQueue.targetFor(playlist);
  let waitedSec = 0;
  let portConfirmedOpen = !mmQueue.settings.waitForPort; // waitForPort=false keeps old instant behavior

  if (mmQueue.settings.waitForPort) {
    // No hard cutoff here on purpose: a stale timeout used to fall through to
    // SessionAssignment/Play even though the port was never actually confirmed
    // open, which sent players into a match that didn't exist yet. Now we only
    // ever leave this loop once isPortOpen() genuinely reports true, or the
    // socket closes (player left the queue).
    while (!closed) {
      let open = false;
      try {
        open = await mmQueue.isPortOpen(playlist);
      } catch (e) {
        console.log(`[Matchmaker] probe error:`, e && e.message);
      }

      if (open) {
        portConfirmedOpen = true;
        console.log(`[Matchmaker] port open ${target.ip}:${target.port}`);
        break;
      }

      waitedSec += mmQueue.settings.checkIntervalMs / 1000;
      sendQueued(waitedSec);
      console.log(
        `[Matchmaker] still queued — ${target.ip}:${target.port} closed` +
        ` (${playlist}, ${liveCount()} in queue, waited ${waitedSec}s)`
      );
      await functions.sleep(mmQueue.settings.checkIntervalMs);
    }
  }

  if (closed) return;
  if (!portConfirmedOpen) {
    // Shouldn't be reachable given the loop above, but guard against ever
    // assigning a session without a confirmed-open port.
    console.log(`[Matchmaker] refusing to assign — port never confirmed open for ${playlist}`);
    return;
  }

  // 5. SessionAssignment
  if (!status({ matchId: matchId, state: "SessionAssignment" })) return;
  await functions.sleep(2000);
  if (closed) return;

  // 6. Play  (sent the same way as the simple matchmaker's Join())
  assigned = true;
  mmQueue.leaveQueue(playlist);

  ws.send(JSON.stringify({
    "payload": {
      "matchId": matchId,
      "sessionId": sessionId,
      "joinDelaySec": 1
    },
    "name": "Play"
  }));
  console.log(`[Matchmaker] >> Play sent (readyState=${ws.readyState}) matchId=${matchId} sessionId=${sessionId}`);

  // The client only started fetching the session once this socket closed
  // (seen when the backend was restarted right after a Play). Close it
  // ourselves shortly after Play so the client moves on.
  setTimeout(() => {
    try { ws.close(1000); } catch (e) {}
  }, 500);

  console.log(
    `[Matchmaker] ${accountId || "anon"} → session ${sessionId}` +
    ` on ${target.ip}:${target.port} (${playlist})`
  );
};
