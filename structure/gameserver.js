const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const accountManager = require("./accountManager.js");
const iniparser = require("ini");

const ACCOUNTS_FILE = path.join(__dirname, "..", "Config", "accounts.json");
const ACCOUNTS_PROFILES_DIR = path.join(__dirname, "..", "profiles", "accounts");

// Load API key from config.ini
const configPath = path.join(__dirname, "..", "Config", "config.ini");
const config = iniparser.parse(fs.readFileSync(configPath).toString());
const API_KEY = config.Api.bApiKey;

// Load V-Bucks reasons from config
const vbucksReasons = {
  GameRewards: config.Api.GameRewards || 50
};

// Middleware to check API key
function checkApiKey(req, res, next) {
  const providedKey = req.query.apikey || req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

// Award V-Bucks to a player
express.get("/gameserver/vbucks", checkApiKey, (req, res) => {
  try {
    const { username, reason, amount } = req.query;
    
    if (!username || !reason || !amount) {
      return res.status(400).json({ error: "Missing required parameters: username, reason, amount" });
    }

    const account = accountManager.findAccount({ username });
    if (!account) {
      return res.status(404).json({ error: "User not found" });
    }

    const vbucksAmount = parseInt(amount);
    if (isNaN(vbucksAmount) || vbucksAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Check if reason is valid and get multiplier
    const reasonMultiplier = vbucksReasons[reason] || 1;
    const finalAmount = vbucksAmount //* reasonMultiplier;

    // Update common_core profile (where V-Bucks are stored)
    const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "common_core.json");
    if (!fs.existsSync(profilePath)) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    
    // Add V-Bucks to the currency
    if (!profileData.stats.attributes.currency) {
      profileData.stats.attributes.currency = {};
    }
    
    const currencyKey = "MtxCurrency"; // Standard Fortnite currency key
    if (!profileData.stats.attributes.currency[currencyKey]) {
      profileData.stats.attributes.currency[currencyKey] = {
        quantity: 0
      };
    }
    
    profileData.stats.attributes.currency[currencyKey].quantity += finalAmount;
    profileData.updated = new Date().toISOString();
    profileData.rvn = (profileData.rvn || 0) + 1;
    
    fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
    
    console.log(`[GameServer] Awarded ${finalAmount} V-Bucks to ${username} (reason: ${reason}, base: ${vbucksAmount}, multiplier: ${reasonMultiplier})`);
    res.json({ success: true, amount: finalAmount, username, reason });
  } catch (error) {
    console.error("[GameServer] Error in award V-Bucks:", error.message);
    res.status(500).json({ error: "Failed to award V-Bucks" });
  }
});

// Gift items to a player
express.get("/gameserver/gift", checkApiKey, (req, res) => {
  try {
    const { username, templateId, quantity } = req.query;
    
    if (!username || !templateId || !quantity) {
      return res.status(400).json({ error: "Missing required parameters: username, templateId, quantity" });
    }

    const account = accountManager.findAccount({ username });
    if (!account) {
      return res.status(404).json({ error: "User not found" });
    }

    const itemQuantity = parseInt(quantity);
    if (isNaN(itemQuantity) || itemQuantity <= 0) {
      return res.status(400).json({ error: "Invalid quantity" });
    }

    // Update athena profile (where cosmetics are stored)
    const profilePath = path.join(ACCOUNTS_PROFILES_DIR, account.accountId, "athena.json");
    if (!fs.existsSync(profilePath)) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    
    // Check if player already has this item
    const itemId = templateId.replace(/:/g, "_"); // Replace colons with underscores for item IDs
    
    if (profileData.items[itemId]) {
      console.log(`[GameServer] Player ${username} already has ${templateId}, skipping duplicate gift`);
      return res.json({ success: true, alreadyOwned: true, templateId, username, message: "Player already owns this item" });
    }
    
    // Add the item to the profile
    profileData.items[itemId] = {
      templateId: templateId,
      attributes: {
        item_seen: false,
        variants: [],
        favorite: false
      },
      quantity: itemQuantity
    };
    
    profileData.updated = new Date().toISOString();
    profileData.rvn = (profileData.rvn || 0) + 1;
    
    fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
    
    console.log(`[GameServer] Gifted ${itemQuantity}x ${templateId} to ${username}`);
    res.json({ success: true, alreadyOwned: false, templateId, quantity: itemQuantity, username });
  } catch (error) {
    console.error("[GameServer] Error in gift item:", error.message);
    res.status(500).json({ error: "Failed to gift item" });
  }
});

// Receive player stats from gameserver
express.post("/gameserver/stats", checkApiKey, (req, res) => {
  try {
    const statsData = req.body;
    
    if (!statsData || !statsData.players) {
      return res.status(400).json({ error: "Invalid stats data" });
    }

    console.log(`[GameServer] Received stats from server ${statsData.server_ip}:${statsData.server_port} for ${statsData.players.length} players`);
    
    // Process each player's stats
    for (const player of statsData.players) {
      const account = accountManager.findAccount({ username: player.username });
      if (!account) {
        console.log(`[GameServer] Player not found: ${player.username}`);
        continue;
      }

      // You could update player stats here if needed
      console.log(`[GameServer] Player ${player.username}: ${player.kills} kills, won: ${player.won}`);
    }
    
    res.json({ success: true, players_processed: statsData.players.length });
  } catch (error) {
    console.error("[GameServer] Error in process stats:", error.message);
    res.status(500).json({ error: "Failed to process stats" });
  }
});

// Quest match result endpoint
express.post("/match-result", (req, res) => {
  try {
    const questData = req.body;
    
    // Check server key for authentication
    const serverKey = req.headers['x-server-key'];
    const expectedKey = config.Config.gameServerKey;
    
    if (serverKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid server key" });
    }
    
    if (!questData || !questData.accountId) {
      return res.status(400).json({ error: "Invalid quest data" });
    }

    console.log(`[GameServer] Quest match result for ${questData.accountId}: ${questData.kills} kills, won: ${questData.win}`);
    
    // Process quest data - you can integrate with questManager here
    const questManager = require("./questManager.js");
    
    // Award XP for playing the match
    if (questData.kills > 0) {
      questManager.handleQuestProgress(questData.accountId, "eliminations", questData.kills)
        .catch(err => console.error("[GameServer] Quest error:", err.message));
    }
    
    // Award XP for playing matches
    if (questData.quests && questData.quests.play_matches) {
      questManager.handleQuestProgress(questData.accountId, "play_matches", questData.quests.play_matches)
        .catch(err => console.error("[GameServer] Quest error:", err.message));
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("[GameServer] Error in match result:", error.message);
    res.status(500).json({ error: "Failed to process match result" });
  }
});

module.exports = express;
