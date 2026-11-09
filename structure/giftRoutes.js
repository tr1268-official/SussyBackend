/**
 * Gift item routes
 * POST /api/gameserver/gift - Game server can gift items to players
 */
const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const iniparser = require("ini");
const accountManager = require("./accountManager.js");

// Load config
let config;
try {
    config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());
} catch (e) {
    config = { Config: {}, Api: { bApiKey: "default_key", reasons: {} } };
}

/**
 * Gift an item to a player's athena profile (cosmetics)
 * @param {string} accountId - The account ID
 * @param {string} templateId - The template ID of the item to gift
 * @param {number} quantity - The quantity to gift
 * @returns {Object} - Result object with success status and profile changes
 */
function giftItem(accountId, templateId, quantity = 1) {
    quantity = Number(quantity) || 1;
    if (quantity <= 0) {
        return { success: false, error: "Invalid quantity" };
    }
    
    try {
        console.log("[Gift] Looking for account:", accountId);
        // Get or find account
        let account = accountManager.findAccount({ accountId: accountId });
        if (!account) {
            account = accountManager.findAccount({ username: accountId });
        }
        
        if (!account) {
            console.log("[Gift] Account not found:", accountId);
            return { success: false, error: "Account not found" };
        }
        
        const targetAccountId = account.accountId;
        console.log("[Gift] Found account:", targetAccountId);
        
        // Update athena profile (cosmetics)
        let athena = accountManager.readProfile(targetAccountId, "athena");
        if (!athena) {
            console.log("[Gift] Athena profile not found for:", targetAccountId);
            return { success: false, error: "athena profile not found" };
        }
        
        console.log("[Gift] Athena profile loaded, items count:", Object.keys(athena.items || {}).length);
        
        // Check if item already exists
        let existingItemId = null;
        for (var key in athena.items) {
            if (athena.items[key].templateId.toLowerCase() === templateId.toLowerCase()) {
                existingItemId = key;
                break;
            }
        }
        
        const purchaseId = existingItemId || require("./functions.js").MakeID();
        
        if (existingItemId) {
            console.log("[Gift] Item already exists:", existingItemId);
            // Update quantity if item exists (for stackable items)
            if (athena.items[existingItemId].quantity !== undefined) {
                athena.items[existingItemId].quantity += quantity;
            }
        } else {
            console.log("[Gift] Creating new item:", templateId, "with ID:", purchaseId);
            // Create new cosmetic item
            athena.items[purchaseId] = {
                templateId: templateId,
                attributes: {
                    max_level_bonus: 0,
                    level: 1,
                    item_seen: false,
                    xp: 0,
                    variants: [],
                    favorite: false
                },
                quantity: quantity
            };
        }
        
        athena.rvn = (athena.rvn || 0) + 1;
        athena.commandRevision = (athena.commandRevision || 0) + 1;
        athena.updated = new Date().toISOString();
        
        // Prepare profile changes
        const ApplyProfileChanges = [
            {
                changeType: existingItemId ? "itemQuantityChanged" : "itemAdded",
                itemId: purchaseId,
                templateId: templateId,
                quantity: athena.items[purchaseId].quantity
            }
        ];
        
        // Write the updated athena profile
        accountManager.writeProfile(targetAccountId, "athena", athena);
        console.log("[Gift] Profile written successfully");
        
        return {
            success: true,
            profileRevision: athena.rvn,
            profileCommandRevision: athena.commandRevision,
            profileChanges: ApplyProfileChanges,
            itemId: purchaseId,
            newQuantity: athena.items[purchaseId].quantity
        };
        
    } catch (err) {
        console.error("[Gift] Error gifting item:", err);
        return { success: false, error: "Server error: " + err.message };
    }
}

// API endpoint to gift items (for game server) - accepts both GET and POST
express.all("/api/gameserver/gift", async (req, res) => {
    const { apikey, username, templateId, quantity } = req.query;
    
    // Validate API key (if configured)
    if (config.Api && config.Api.bApiKey && (!apikey || apikey !== config.Api.bApiKey)) {
        return res.status(401).json({ code: "401", error: "Invalid or missing API key." });
    }
    
    if (!username) {
        return res.status(400).json({ code: "400", error: "Missing username." });
    }
    
    if (!templateId) {
        return res.status(400).json({ code: "400", error: "Missing templateId." });
    }
    
    const giftQuantity = Number(quantity) || 1;
    if (isNaN(giftQuantity) || giftQuantity <= 0) {
        return res.status(400).json({ code: "400", error: "Invalid quantity." });
    }
    
    const targetUsername = username.trim().toLowerCase();
    
    try {
        console.log("[Gift] Attempting to gift", templateId, "to", targetUsername, "quantity:", giftQuantity);
        const result = giftItem(targetUsername, templateId, giftQuantity);
        
        if (!result.success) {
            console.log("[Gift] Failed:", result.error);
            return res.status(200).json({ message: result.error });
        }
        
        console.log("[Gift] Success:", result);
        return res.status(200).json(result);
        
    } catch (err) {
        console.error("[Gift] API error:", err);
        return res.status(500).json({ code: "500", error: "Server error. Check console logs for more details." });
    }
});

module.exports = express;