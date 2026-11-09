/**
 * OT6.5 game data loader (from Fortify-Alpha common/game_data)
 * Place Fortify-Alpha's common/ folder at LawinServer/common/
 */
const fs = require("fs");
const path = require("path");

const GAME_DATA_FOLDER = path.join(__dirname, "..", "common", "game_data");
const gameData = {};
const tables = {};
let loaded = false;
let loadError = null;

function walkDir(dir, onFile) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (st.isDirectory()) walkDir(full, onFile);
        else if (st.isFile() && name.endsWith(".json")) onFile(full);
    }
}

function generateTemplateId(data) {
    if (!data || !data.Name || !data.Type) return null;
    const name = String(data.Name).toLowerCase();
    switch (data.Type) {
        case "FortQuestItemDefinition": return `Quest.${name}`;
        case "FortWeaponMeleeItemDefinition": return `Weapon.${name}`;
        case "FortWeaponRangedItemDefinition": return `Weapon.${name}`;
        case "FortEditToolItemDefinition": return `Weapon.${name}`;
        case "FortBuildingItemDefinition": return `Weapon.${name}`;
        case "FortPersistentResourceItemDefinition": return `AccountResource.${name}`;
        case "MyTownBuildingDefinitionData": return `MyFortBuilding.${data.Name}`;
        case "FortSchematicItemDefinition": return `Schematic.${name}`;
        case "FortTokenType": return `Token.${name}`;
        case "FortIngredientItemDefinition": return `Ingredient.${name}`;
        case "FortConsumableItemDefinition": return `Food.${name}`;
        case "FortHeroType": return `Hero.${name}`;
        case "FortCardPackItemDefinition": return `CardPack.${name}`;
        case "FortBadgeItemDefinition": return `Badge.${name}`;
        case "FortAlterationItemDefinition": return `Alteration.${name}`;
        case "FortWorkerType": return `Worker.${name}`;
        case "FortResourceItemDefinition": return `Resource.${name}`;
        case "FortCurrencyItemDefinition": return `Currency.${name}`;
        case "FortGadgetItemDefinition": return `Gadget.${name}`;
        case "FortTrapItemDefinition": return `Trap.${name}`;
        default: return null;
    }
}

function loadGameData() {
    if (loaded) return;
    loaded = true;
    if (!fs.existsSync(GAME_DATA_FOLDER)) {
        loadError = "common/game_data not found — copy from Fortify-Alpha common/";
        console.log("[OT65] " + loadError);
        return;
    }
    let count = 0;
    walkDir(GAME_DATA_FOLDER, (filePath) => {
        let json;
        try {
            json = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (e) {
            return;
        }
        // Fortify files are objects keyed by export name, or arrays
        const entries = Array.isArray(json) ? json : Object.values(json);
        for (const data of entries) {
            if (!data || !data.Type) continue;
            if (String(data.Type).endsWith("Table")) {
                tables[data.Name] = data;
                continue;
            }
            const templateId = generateTemplateId(data);
            if (!templateId) continue;
            data.templateId = templateId;
            data.prefix = templateId.split(".")[0];
            gameData[templateId] = data;
            count++;
        }
    });
    console.log("[OT65] game_data loaded:", count, "items,", Object.keys(tables).length, "tables");
}

function getItem(name) {
    loadGameData();
    if (!name) return null;
    if (gameData[name]) return gameData[name];
    let n = name;
    if (n.includes("/") && n.includes(".")) n = n.split(".")[1];
    const lower = String(n).toLowerCase();
    for (const key in gameData) {
        if (gameData[key].Name && gameData[key].Name.toLowerCase() === lower) return gameData[key];
        if (gameData[key].templateId && gameData[key].templateId.toLowerCase() === String(name).toLowerCase()) return gameData[key];
    }
    return null;
}

function getItemsStartingWith(prefix) {
    loadGameData();
    const items = [];
    for (const key in gameData) {
        if (key.startsWith(prefix) || (gameData[key].prefix && gameData[key].prefix === prefix)) items.push(gameData[key]);
    }
    return items;
}

function getAllItems(typeOrPrefix) {
    loadGameData();
    const items = [];
    for (const key in gameData) {
        if (gameData[key].Type === typeOrPrefix || gameData[key].prefix === typeOrPrefix || key.startsWith(typeOrPrefix + ".")) {
            items.push(gameData[key]);
        }
    }
    return items;
}

function getTable(name) {
    loadGameData();
    return tables[name] || null;
}

function generateAttributes(templateId) {
    let attributes = {
        max_level_bonus: 0,
        level: 1,
        item_seen: false,
        bItemSeen: 0,
        xp: 0,
        variants: [],
        favorite: false
    };
    const prefix = String(templateId || "").split(".")[0];
    switch (prefix) {
        case "Quest":
            attributes.bSentNewNotification = false;
            attributes.bAllObjectivesComplete = false;
            attributes.quest_pool = "";
            attributes.quest_state = "Active";
            attributes.state = "Active";
            attributes.last_state_change_time = new Date().toISOString();
            attributes.quest_rarity = "uncommon";
            attributes.level = -1;
            break;
        case "MyFortBuilding":
            attributes.level = 0;
            attributes.buildingState = "Locked";
            attributes.managerInstanceId = "";
            attributes.workerInstanceIds = ["", "", "", "", "", ""];
            attributes.parentBuildingId = "";
            break;
        case "Trap":
        case "Weapon":
        case "Food":
            attributes.alterationDefinitions = [];
            attributes.durability = 375;
            attributes.inventory_overflow_date = false;
            attributes.itemSource = null;
            attributes.level = 1;
            attributes.loadedAmmo = 0;
            break;
        case "Hero":
            attributes.hero_name = "Default Hero Name";
            attributes.gender = 1;
            attributes.mode_loadouts = [];
            break;
        case "Worker":
            attributes.personality = "Default";
            break;
        default:
            break;
    }
    return attributes;
}

function isReady() {
    loadGameData();
    return Object.keys(gameData).length > 0;
}

module.exports = {
    loadGameData,
    getItem,
    getTable,
    generateAttributes,
    getAllItems,
    getItemsStartingWith,
    isReady,
    gameData,
    tables
};
