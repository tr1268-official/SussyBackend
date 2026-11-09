// ---------------------------------------------------------------------------
// templateId -> display name / description lookup for the item shop.
//
// makeCatalogEntry() used to derive every shop tile's title, devName and
// description from the raw template id ("AthenaCharacter:CID_009_Athena_Commando_M"
// -> "CID_009_Athena_Commando_M"), which is why the lobby showed ids instead of
// cosmetic names. responses/cosmetic_names.json is a flat map of
// lowercased cosmetic id -> { n: name, d: description, r: rarity, t: type, s: set }
// covering every BR cosmetic, loaded once at require time.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");

let DB = {};
try {
    DB = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "responses", "cosmetic_names.json"), "utf8"));
    console.log("[Cosmetics] loaded", Object.keys(DB).length, "cosmetic names");
} catch (e) {
    console.log("[Cosmetics] responses/cosmetic_names.json missing - shop will fall back to ids:", e.message);
    DB = {};
}

// "AthenaCharacter:CID_009_Athena_Commando_M" -> "cid_009_athena_commando_m"
function idPart(templateId) {
    let t = String(templateId || "").trim();
    if (t.includes(":")) t = t.split(":").pop();
    return t.toLowerCase();
}

// Last-resort readable name for an id that isn't in the database.
function humanize(rawId) {
    let t = String(rawId || "");
    if (t.includes(":")) t = t.split(":").pop();
    t = t.replace(/^(CID|EID|BID|GID|LSID|SID|TID|Pickaxe_ID|Glider_ID|Wrap|MusicPack|Contrail|Emoji|Spray|Toy|Backpack|Character|Petcarrier)[_-]?/i, "");
    t = t.replace(/^\d+[_-]?/, "");
    t = t.replace(/_?(Athena|Commando|Item|Default)_?/gi, " ");
    t = t.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return String(rawId || "");
    return t.replace(/\b\w/g, c => c.toUpperCase());
}

// Returns { name, description, rarity, type, set } - never null.
function lookup(templateId) {
    const hit = DB[idPart(templateId)];
    if (hit) {
        // Source data carries trailing spaces on a lot of names/descriptions
        // ("Pathfinder ", "Uncommon pathfinder outfit. ").
        const clean = v => String(v || "").replace(/\s+/g, " ").trim();
        return {
            name: clean(hit.n) || humanize(templateId),
            description: clean(hit.d) || clean(hit.s) || "",
            rarity: hit.r || "",
            type: hit.t || "",
            set: hit.s || "",
            known: true
        };
    }
    return { name: humanize(templateId), description: "", rarity: "", type: "", set: "", known: false };
}

// True when a string still looks like a raw asset id rather than a display name.
function looksLikeRawId(value) {
    const v = String(value || "");
    if (!v) return true;
    if (/^(CID|EID|BID|GID|LSID|SID|TID|Pickaxe_ID|Glider_ID|Wrap|MusicPack|Contrail|Emoji|Spray|Toy|Backpack|Character)[_\d]/i.test(v)) return true;
    if (v.includes(":")) return true;
    if (!v.includes(" ") && v.includes("_")) return true;
    return false;
}

const SLOT_LABELS = {
    AthenaCharacter: "Outfit",
    AthenaBackpack: "Back Bling",
    AthenaPickaxe: "Harvesting Tool",
    AthenaGlider: "Glider",
    AthenaDance: "Emote",
    AthenaItemWrap: "Wrap",
    AthenaSkyDiveContrail: "Contrail",
    AthenaLoadingScreen: "Loading Screen",
    AthenaMusicPack: "Music"
};

// Rewrites a catalog entry in place so the lobby shows names, not ids.
function decorateEntry(entry) {
    if (!entry || !Array.isArray(entry.itemGrants) || !entry.itemGrants.length) return entry;

    const grants = entry.itemGrants.map(g => (typeof g === "string" ? g : g && g.templateId)).filter(Boolean);
    if (!grants.length) return entry;

    const infos = grants.map(lookup);
    const primary = infos[0];
    const name = infos.length > 1 ? infos.map(i => i.name).join(" + ") : primary.name;

    if (looksLikeRawId(entry.title)) entry.title = name;
    if (looksLikeRawId(entry.devName)) entry.devName = name;

    if (!entry.description || looksLikeRawId(entry.description)) {
        entry.description = primary.description || primary.set || name;
    }
    if (!entry.shortDescription && primary.type) {
        entry.shortDescription = SLOT_LABELS[primary.type] || "";
    }
    return entry;
}

function decorateCatalog(catalog) {
    try {
        for (const sf of (catalog && catalog.storefronts) || []) {
            for (const entry of sf.catalogEntries || []) decorateEntry(entry);
        }
    } catch (e) {
        console.log("[Cosmetics] decorate failed:", e.message);
    }
    return catalog;
}

module.exports = { lookup, decorateEntry, decorateCatalog, looksLikeRawId, humanize, size: () => Object.keys(DB).length };
