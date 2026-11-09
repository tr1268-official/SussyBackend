const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const iniparser = require("ini");
const accountManager = require("./accountManager.js");

const config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());

console.log("[QuestManager] Module loaded");

const API_BASE = "http://localhost:3551/api";
const API_KEY = config.Api.bApiKey;
const ACCOUNTS_PROFILES_DIR = path.join(__dirname, "..", "profiles", "accounts");

// ── XP curve ─────────────────────────────────────────────────────────────────
const XP_CURVE = {
  1:100,  2:250,  3:300,  4:350,  5:700,  6:750,  7:800,  8:850,  9:900,
  10:1000, 11:1050, 12:1100, 13:1150, 14:1200, 15:1250, 16:1300, 17:1350,
  18:1400, 19:1450, 20:1500, 21:1550, 22:1600, 23:1650, 24:1700, 25:1750,
  26:1800, 27:1850, 28:1900, 29:1950, 30:2000, 31:2100, 32:2200, 33:2300,
  34:2400, 35:2500, 36:2600, 37:2700, 38:2800, 39:2900, 40:3000, 41:3200,
  42:3400, 43:3600, 44:3800, 45:4000, 46:4200, 47:4400, 48:4600, 49:4800,
  50:5000, 51:5300, 52:5600, 53:5900, 54:6200, 55:6500, 56:6800, 57:7100,
  58:7400, 59:7700, 60:8000, 61:8400, 62:8800, 63:9200, 64:9600, 65:10000,
  66:10400, 67:10800, 68:11200, 69:11600, 70:12000, 71:12500, 72:13000,
  73:13500, 74:14000, 75:14500, 76:15000, 77:15500, 78:16000, 79:16500,
  80:17000, 81:18000, 82:19000, 83:20000, 84:21000, 85:22000, 86:23000,
  87:24000, 88:25000, 89:26000, 90:28000, 91:30000, 92:32000, 93:34000,
  94:36000, 95:38000, 96:40000, 97:43000, 98:46000, 99:50000,
};

const MAX_LEVEL         = 99;
const BP_STARS_PER_TIER = 10;
const MAX_BOOKLEVEL     = 69;

// Quest rewards configuration
const QUEST_REWARDS = {
  eliminations: { xp: 100, battlestars: 2, vbucks: 0, threshold: 5 },    // 5 eliminations = rewards
  play_matches: { xp: 50, battlestars: 1, vbucks: 10, threshold: 1 },    // 1 match = rewards
  wins: { xp: 200, battlestars: 5, vbucks: 50, threshold: 1 },            // 1 win = rewards
  default: { xp: 500, battlestars: 5, vbucks: 50, threshold: 1 }         // Default quest rewards
};


// ── Resolve username from accountId ──────────────────────────────────────────

async function getUsername(accountId) {
  console.log(`[QuestManager] Resolving username for accountId: ${accountId}`);

  const account = accountManager.findAccount({ accountId });
  if (!account) throw new Error(`[QuestManager] Could not find account for accountId: ${accountId}`);

  console.log(`[QuestManager] Resolved username: ${account.displayName}`);
  return account.displayName;
}


// ── Profile helpers ───────────────────────────────────────────────────────────

async function getAthenaStats(accountId) {
  const account = accountManager.findAccount({ accountId });
  if (!account) throw new Error(`[QuestManager] Account not found for accountId: ${accountId}`);

  const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "athena.json");
  if (!fs.existsSync(profilePath)) throw new Error(`[QuestManager] Profile not found for accountId: ${accountId}`);

  const profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const stats = profileData.stats?.attributes;
  if (!stats) throw new Error(`[QuestManager] Athena stats not found for accountId: ${accountId}`);

  console.log(`[QuestManager] Loaded athena stats — level: ${stats.level}, xp: ${stats.xp}, book_level: ${stats.book_level}, book_xp: ${stats.book_xp}`);
  return stats;
}

async function updateAthenaStats(accountId, stats) {
  const account = accountManager.findAccount({ accountId });
  if (!account) throw new Error(`[QuestManager] Account not found for accountId: ${accountId}`);

  const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "athena.json");
  if (!fs.existsSync(profilePath)) throw new Error(`[QuestManager] Profile not found for accountId: ${accountId}`);

  const profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  
  // Update stats
  if (stats.level !== undefined) profileData.stats.attributes.level = stats.level;
  if (stats.xp !== undefined) profileData.stats.attributes.xp = stats.xp;
  if (stats.book_level !== undefined) profileData.stats.attributes.book_level = stats.book_level;
  if (stats.book_xp !== undefined) profileData.stats.attributes.book_xp = stats.book_xp;
  
  profileData.updated = new Date().toISOString();
  profileData.rvn = (profileData.rvn || 0) + 1;
  
  fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
  console.log(`[QuestManager] Updated profile for ${accountId}: level=${stats.level}, xp=${stats.xp}, book_level=${stats.book_level}, book_xp=${stats.book_xp}`);
}

async function getCommonCoreStats(accountId) {
  const account = accountManager.findAccount({ accountId });
  if (!account) throw new Error(`[QuestManager] Account not found for accountId: ${accountId}`);

  const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "common_core.json");
  if (!fs.existsSync(profilePath)) throw new Error(`[QuestManager] common_core profile not found for accountId: ${accountId}`);

  const profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  return profileData;
}

async function updateCommonCoreStats(accountId, profileData) {
  const account = accountManager.findAccount({ accountId });
  if (!account) throw new Error(`[QuestManager] Account not found for accountId: ${accountId}`);

  const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "common_core.json");
  if (!fs.existsSync(profilePath)) throw new Error(`[QuestManager] common_core profile not found for accountId: ${accountId}`);

  profileData.updated = new Date().toISOString();
  profileData.rvn = (profileData.rvn || 0) + 1;
  
  fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
  console.log(`[QuestManager] Updated common_core profile for ${accountId}`);
}


// ── Direct profile updates ───────────────────────────────────────────────────

async function apiSetXp(accountId, xp) {
  console.log(`[QuestManager] Setting XP — accountId: ${accountId}, xp: ${xp}`);
  const stats = await getAthenaStats(accountId);
  stats.xp = xp;
  await updateAthenaStats(accountId, stats);
  return "XP updated";
}

async function apiSetLevel(accountId, level) {
  console.log(`[QuestManager] Setting Level — accountId: ${accountId}, level: ${level}`);
  const stats = await getAthenaStats(accountId);
  stats.level = level;
  await updateAthenaStats(accountId, stats);
  return "Level updated";
}

async function apiSetBookXp(accountId, battlestars) {
  console.log(`[QuestManager] Setting Book XP — accountId: ${accountId}, battlestars: ${battlestars}`);
  const stats = await getAthenaStats(accountId);
  stats.book_xp = battlestars;
  await updateAthenaStats(accountId, stats);
  return "Book XP updated";
}

async function apiSetBookLevel(accountId, booklevel) {
  console.log(`[QuestManager] Setting Book Level — accountId: ${accountId}, booklevel: ${booklevel}`);
  const stats = await getAthenaStats(accountId);
  stats.book_level = booklevel;
  await updateAthenaStats(accountId, stats);
  return "Book level updated";
}

async function apiSetVbucks(accountId, amount) {
  console.log(`[QuestManager] Setting V-Bucks — accountId: ${accountId}, amount: ${amount}`);
  
  const profileData = await getCommonCoreStats(accountId);
  
  // Add V-Bucks to the currency
  if (!profileData.stats.attributes.currency) {
    profileData.stats.attributes.currency = {};
  }
  
  const currencyKey = "MtxCurrency";
  if (!profileData.stats.attributes.currency[currencyKey]) {
    profileData.stats.attributes.currency[currencyKey] = {
      quantity: 0
    };
  }
  
  profileData.stats.attributes.currency[currencyKey].quantity += amount;
  await updateCommonCoreStats(accountId, profileData);
  
  console.log(`[QuestManager] Awarded ${amount} V-Bucks to ${accountId}`);
  return "V-Bucks updated";
}

async function apiSendQuestNotification(accountId, questTemplate) {
  console.log(`[QuestManager] Quest notification — accountId: ${accountId}, quest: ${questTemplate}`);
  // For now, just log the notification
  return "Quest notification sent";
}


// ── XP logic ──────────────────────────────────────────────────────────────────

async function applyXp(accountId, stats, amount) {
  stats.xp += amount;
  console.log(`[QuestManager] Applying ${amount} XP — total: ${stats.xp}`);

  while (stats.level < MAX_LEVEL) {
    const needed = XP_CURVE[stats.level];
    if (!needed || stats.xp < needed) break;

    stats.xp -= needed;
    stats.level += 1;
    console.log(`[QuestManager] Levelled up to ${stats.level} (remaining XP: ${stats.xp})`);
    await apiSetLevel(accountId, stats.level);
  }

  await apiSetXp(accountId, stats.xp);
}


// ── Battle pass logic ─────────────────────────────────────────────────────────

async function applyBattlestars(accountId, stats, amount) {
  stats.book_xp += amount;
  console.log(`[QuestManager] Applying ${amount} battlestars — book_xp total: ${stats.book_xp}`);

  while (stats.book_level < MAX_BOOKLEVEL) {
    if (stats.book_xp < BP_STARS_PER_TIER) break;

    stats.book_xp -= BP_STARS_PER_TIER;
    stats.book_level += 1;
    console.log(`[QuestManager] Book-levelled up to tier ${stats.book_level} (remaining stars: ${stats.book_xp})`);
    await apiSetBookLevel(accountId, stats.book_level);
  }

  await apiSetBookXp(accountId, stats.book_xp);
}


// ── Main quest handler ────────────────────────────────────────────────────────

async function handleQuestProgress(accountId, questTemplate, amount) {
  console.log(`[QuestManager] handleQuestProgress — accountId: ${accountId}, quest: ${questTemplate}, amount: ${amount}`);

  const account = accountManager.findAccount({ accountId });
  if (!account) throw new Error(`[QuestManager] Account not found for accountId: ${accountId}`);

  const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "athena.json");
  if (!fs.existsSync(profilePath)) throw new Error(`[QuestManager] Profile not found for accountId: ${accountId}`);

  const profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  
  // Initialize quest_manager if not exists
  if (!profileData.stats.attributes.quest_manager) {
    profileData.stats.attributes.quest_manager = {};
  }
  
  // Update quest progress
  const questManager = profileData.stats.attributes.quest_manager;
  const currentAmount = questManager[questTemplate] || 0;
  const newAmount = parseInt(amount);
  
  questManager[questTemplate] = currentAmount + newAmount;
  profileData.updated = new Date().toISOString();
  profileData.rvn = (profileData.rvn || 0) + 1;
  
  fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
  
  console.log(`[QuestManager] Updated quest ${questTemplate} for ${accountId} by ${amount} (total: ${questManager[questTemplate]})`);
  
  // Get reward configuration for this quest type
  const rewardConfig = QUEST_REWARDS[questTemplate] || QUEST_REWARDS.default;
  const threshold = rewardConfig.threshold;
  
  // Check if quest is completed and calculate how many times
  const completions = Math.floor(questManager[questTemplate] / threshold);
  const previousCompletions = Math.floor(currentAmount / threshold);
  const newCompletions = completions - previousCompletions;
  
  if (newCompletions > 0) {
    console.log(`[QuestManager] Quest COMPLETED ${newCompletions} time(s) — awarding rewards`);

    const stats = await getAthenaStats(accountId);

    await apiSendQuestNotification(accountId, questTemplate);
    await applyXp(accountId, stats, rewardConfig.xp * newCompletions);
    await applyBattlestars(accountId, stats, rewardConfig.battlestars * newCompletions);
    
    if (rewardConfig.vbucks > 0) {
      await apiSetVbucks(accountId, rewardConfig.vbucks * newCompletions);
    }

    console.log(`[QuestManager] Done — all rewards applied (${rewardConfig.xp * newCompletions} XP, ${rewardConfig.battlestars * newCompletions} battlestars, ${rewardConfig.vbucks * newCompletions} V-Bucks)`);
  } else {
    console.log(`[QuestManager] Quest progress updated, not yet completed (${questManager[questTemplate]}/${threshold})`);
  }
}

module.exports = { 
  handleQuestProgress,
  getAthenaStats,
  updateAthenaStats,
  apiSetXp,
  apiSetLevel,
  apiSetBookXp,
  apiSetBookLevel,
  apiSetVbucks
};