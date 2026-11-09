const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const functions = require("./functions.js");
const accountManager = require("./accountManager.js");
const iniparser = require("ini");

// Load config
let config;
try {
    config = iniparser.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "config.ini")).toString());
} catch (e) {
    config = { Config: {}, Api: { bApiKey: "default_key", reasons: {} } };
}

/**
 * Add V-Bucks to a profile via API
 * @param {string} accountId - The account ID
 * @param {number} amount - The amount of V-Bucks to add
 * @param {string} reason - The reason for adding V-Bucks
 * @param {string} fromAccountId - The account ID that is giving the V-Bucks (optional)
 * @returns {Object} - Result object with success status and profile changes
 */
function addVbucks(accountId, amount, reason, fromAccountId = "[Administrator]") {
    amount = Number(amount) || 0;
    if (amount <= 0) {
        return { success: false, error: "Invalid amount" };
    }
    
    try {
        console.log("[Vbucks] Looking for account:", accountId);
        // Get or find account
        let account = accountManager.findAccount({ accountId: accountId });
        if (!account) {
            account = accountManager.findAccount({ username: accountId });
        }
        
        if (!account) {
            console.log("[Vbucks] Account not found:", accountId);
            return { success: false, error: "Account not found" };
        }
        
        const targetAccountId = account.accountId;
        console.log("[Vbucks] Found account:", targetAccountId);
        
        // Update common_core profile
        let common_core = accountManager.readProfile(targetAccountId, "common_core");
        if (!common_core) {
            return { success: false, error: "common_core profile not found" };
        }
        
        // Find or create V-Bucks currency item
        let currencyItemId = null;
        for (var key in common_core.items) {
            if (common_core.items[key].templateId.toLowerCase().startsWith("currency:mtx")) {
                currencyItemId = key;
                break;
            }
        }
        
        if (!currencyItemId) {
            // Create V-Bucks currency item if it doesn't exist
            currencyItemId = functions.MakeID();
            common_core.items[currencyItemId] = {
                templateId: "Currency:MtxPurchased",
                attributes: {
                    platform: "Shared",
                    material: "MtxCurrency"
                },
                quantity: 0
            };
        }
        
        const oldQuantityCommonCore = common_core.items[currencyItemId].quantity;
        common_core.items[currencyItemId].quantity += amount;
        common_core.rvn = (common_core.rvn || 0) + 1;
        common_core.commandRevision = (common_core.commandRevision || 0) + 1;
        
        // Create gift box entry
        const purchaseId = functions.MakeID();
        const lootList = [{
            itemType: "Currency:MtxGiveaway",
            itemGuid: "Currency:MtxGiveaway",
            quantity: amount
        }];
        
        common_core.items[purchaseId] = {
            templateId: "GiftBox:GB_MakeGood",
            attributes: {
                fromAccountId: fromAccountId,
                lootList: lootList,
                params: {
                    userMessage: reason || "Thanks For Playing!"
                },
                giftedOn: new Date().toISOString()
            },
            quantity: 1
        };
        
        // Prepare profile changes
        const ApplyProfileChanges = [
            {
                changeType: "itemQuantityChanged",
                itemId: currencyItemId,
                quantity: common_core.items[currencyItemId].quantity
            },
            {
                changeType: "itemAdded",
                itemId: purchaseId,
                templateId: "GiftBox:GB_MakeGood"
            }
        ];
        
        // Write the updated common_core profile
        accountManager.writeProfile(targetAccountId, "common_core", common_core);
        
        // Also update profile0 if it exists (for STW)
        let newQuantityProfile0 = oldQuantityCommonCore + amount;
        try {
            let profile0 = accountManager.readProfile(targetAccountId, "profile0");
            if (profile0 && profile0.items) {
                let profile0CurrencyId = null;
                for (var key in profile0.items) {
                    if (profile0.items[key].templateId.toLowerCase().startsWith("currency:mtx")) {
                        profile0CurrencyId = key;
                        break;
                    }
                }
                
                if (profile0CurrencyId) {
                    const oldQuantityProfile0 = profile0.items[profile0CurrencyId].quantity;
                    profile0.items[profile0CurrencyId].quantity += amount;
                    newQuantityProfile0 = profile0.items[profile0CurrencyId].quantity;
                    profile0.rvn = (profile0.rvn || 0) + 1;
                    profile0.commandRevision = (profile0.commandRevision || 0) + 1;
                    accountManager.writeProfile(targetAccountId, "profile0", profile0);
                    
                    // Add profile0 change to profile changes
                    ApplyProfileChanges.push({
                        changeType: "itemQuantityChanged",
                        itemId: profile0CurrencyId,
                        quantity: newQuantityProfile0
                    });
                }
            }
        } catch (e) {
            // Ignore profile0 errors
        }
        
        return {
            success: true,
            profileRevision: common_core.rvn,
            profileCommandRevision: common_core.commandRevision,
            profileChanges: ApplyProfileChanges,
            newQuantityCommonCore: common_core.items[currencyItemId].quantity,
            newQuantityProfile0: newQuantityProfile0
        };
        
    } catch (err) {
        console.error("[Vbucks] Error adding V-Bucks:", err);
        return { success: false, error: "Server error: " + err.message };
    }
}

// API endpoint to add V-Bucks (for external services/admin)
express.get("/api/gameserver/vbucks", async (req, res) => {
    const { apikey, username, reason, amount } = req.query;
    
    // Validate API key (if configured)
    if (config.Api && config.Api.bApiKey && (!apikey || apikey !== config.Api.bApiKey)) {
        return res.status(401).json({ code: "401", error: "Invalid or missing API key." });
    }
    
    if (!username) {
        return res.status(400).json({ code: "400", error: "Missing username." });
    }
    
    if (!reason) {
        return res.status(400).json({ code: "400", error: "Missing reason." });
    }
    
    if (!amount) {
        return res.status(400).json({ code: "400", error: "Missing amount." });
    }
    
    const vbuckAmount = Number(amount);
    if (isNaN(vbuckAmount) || vbuckAmount <= 0) {
        return res.status(400).json({ code: "400", error: "Invalid amount." });
    }
    
    // Validate reason if reasons are configured (but skip amount validation for game rewards)
    if (config.Api && config.Api.reasons && Object.keys(config.Api.reasons).length > 0) {
        const validReasons = config.Api.reasons;
        console.log("[Vbucks] Reason validation check. Reason:", reason, "Valid reasons:", validReasons);
        // Only check if the reason exists, not the amount (allow variable amounts for GameRewards)
        if (validReasons[reason] === undefined) {
            console.log("[Vbucks] Reason validation FAILED:", reason);
            return res.status(400).json({ 
                code: "400", 
                error: `Invalid reason. Allowed values: ${Object.keys(validReasons).join(", ")}.` 
            });
        }
        console.log("[Vbucks] Reason validation PASSED (allowing variable amount)");
    }
    
    const targetUsername = username.trim().toLowerCase();
    // Fix account name casing for special accounts
    if (targetUsername === "rootserver") {
        console.log("[Vbucks] Converting rootserver to RootServer");
    }
    console.log("[Vbucks] Attempting to add", vbuckAmount, "V-Bucks to", targetUsername, "for reason:", reason);
    
    try {
        const result = addVbucks(targetUsername, vbuckAmount, reason);
        
        if (!result.success) {
            console.log("[Vbucks] Failed:", result.error);
            return res.status(200).json({ message: result.error });
        }
        
        console.log("[Vbucks] Success: Added", vbuckAmount, "V-Bucks to", targetUsername, "New balance:", result.newQuantityCommonCore);
        return res.status(200).json(result);
        
    } catch (err) {
        console.error("[Vbucks] API error:", err);
        return res.status(500).json({ code: "500", error: "Server error. Check console logs for more details." });
    }
});

module.exports = express;