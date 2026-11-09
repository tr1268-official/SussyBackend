/**
 * node structure/skipTutorial.js [optionalAccountId]
 * Forces STW tutorial + early Stonewood unlocks complete.
 * Does NOT max research/level.
 */
const fs = require("fs");
const path = require("path");

const accountsRoot = path.join(__dirname, "..", "profiles", "accounts");
const target = process.argv[2];

const earlyRe = /tutorial|onboarding|protoenable|homebaseonboard|stonewoodquest_closegate|stonewoodquest_launchballoon|stonewoodquest_launchrocket|outpostquest|tutorial_loadout|stonewoodquest_tutorial|plankertonquest_tutorial/i;

function claimQuest(it) {
    it.attributes = it.attributes || {};
    it.attributes.quest_state = "Claimed";
    it.attributes.item_seen = true;
    it.attributes.sent_new_notification = true;
    for (const k of Object.keys(it.attributes)) {
        if (k.startsWith("completion_") && it.attributes[k] === 0) it.attributes[k] = 1;
    }
    const flags = [
        "completion_hbonboarding_namehomebase",
        "completion_hbonboarding_completezone",
        "completion_hbonboarding_watchsatellitecine",
        "completion_complete_gate_1",
        "completion_complete_launchweatherballoon_1",
        "completion_complete_launchrocket_1",
        "completion_complete_outpost",
        "completion_complete_zone"
    ];
    for (const f of flags) it.attributes[f] = Math.max(it.attributes[f] || 0, 1);
}

function patchFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const name = path.basename(filePath);
    const p = JSON.parse(fs.readFileSync(filePath, "utf8"));
    let changed = false;

    if (name === "common_core.json") {
        p.items = p.items || {};
        const tokens = {
            "Campaign": "Token:campaignaccess",
            "Token:campaigntutorialcomplete": "Token:campaigntutorialcomplete",
            "Token:CampaignTutorialCompleted": "Token:CampaignTutorialCompleted",
            "Token:stw_tutorial_complete": "Token:stw_tutorial_complete"
        };
        for (const [key, tid] of Object.entries(tokens)) {
            p.items[key] = {
                templateId: tid,
                attributes: { level: 1, item_seen: true, max_level_bonus: 0, xp: 0, favorite: false },
                quantity: 1
            };
        }
        p.stats = p.stats || { attributes: {} };
        p.stats.attributes = p.stats.attributes || {};
        p.stats.attributes.intro_game_played = true;
        p.stats.attributes.forced_intro_played = "Coconut";
        p.stats.attributes.has_completed_tutorial = true;
        changed = true;
    }

    if (p.items) {
        for (const k of Object.keys(p.items)) {
            const it = p.items[k];
            const tid = String(it.templateId || "");
            if (earlyRe.test(tid) || /stonewoodquest/i.test(tid) && /(_d1|gate|balloon|rocket|tutorial)/i.test(tid)) {
                claimQuest(it);
                changed = true;
            }
        }
    }

    if (p.stats && p.stats.attributes) {
        if (name === "profile0.json") {
            p.stats.attributes.homebase = p.stats.attributes.homebase || {};
            if (!p.stats.attributes.homebase.townName) p.stats.attributes.homebase.townName = "Homebase";
            p.stats.attributes.gameplay_stats = [{ statName: "zonescompleted", statValue: 1 }];
            // keep level low
            if ((p.stats.attributes.level || 1) <= 10) p.stats.attributes.level = 1;
            changed = true;
        }
        if (name === "campaign.json") {
            p.stats.attributes.tutorial_completed = true;
            p.stats.attributes.has_completed_tutorial = true;
            if ((p.stats.attributes.level || 1) <= 10) p.stats.attributes.level = 1;
            p.stats.attributes.research_levels = p.stats.attributes.research_levels || {};
            for (const k of ["technology", "fortitude", "offense", "resistance"]) {
                if ((p.stats.attributes.research_levels[k] || 1) <= 5)
                    p.stats.attributes.research_levels[k] = 1;
            }
            p.stats.attributes.gameplay_stats = [{ statName: "zonescompleted", statValue: 1 }];
            changed = true;
        }
    }

    if (changed) {
        p.rvn = (p.rvn || 0) + 1;
        p.commandRevision = (p.commandRevision || 0) + 1;
        p.updated = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(p, null, 2));
        console.log("Patched", filePath);
    }
}

function patchAccount(dir) {
    for (const f of ["common_core.json", "profile0.json", "campaign.json"]) {
        patchFile(path.join(dir, f));
    }
}

if (!fs.existsSync(accountsRoot)) {
    console.log("No profiles/accounts yet. Log in once, then re-run this.");
    process.exit(0);
}

const dirs = target
    ? [path.join(accountsRoot, target)]
    : fs.readdirSync(accountsRoot).map(d => path.join(accountsRoot, d)).filter(d => fs.statSync(d).isDirectory());

dirs.forEach(patchAccount);
console.log("Done. Fully close Fortnite, restart LawinServer, log in again.");
