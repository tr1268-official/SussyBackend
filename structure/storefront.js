const Express = require("express");
const express = Express.Router();
const fs = require("fs");
const path = require("path");
const functions = require("./functions.js");

let keychain = [];
try {
    keychain = require("./../responses/keychain.json");
} catch (e) {
    keychain = [];
}

function isShopDisabled() {
    try {
        const iniPath = path.join(__dirname, "..", "Config", "config.ini");
        if (!fs.existsSync(iniPath)) return false;
        const text = fs.readFileSync(iniPath, "utf8");
        // optional: shop_enabled=false under any section
        const m = text.match(/^\s*shop_enabled\s*=\s*(false|0)/im);
        if (m) return true;
        const m2 = text.match(/^\s*bShopEnabled\s*=\s*(false|0)/im);
        if (m2) return true;
    } catch (e) {}
    return false;
}

express.get("/fortnite/api/storefront/v2/catalog", (req, res) => {
    try {
        if (isShopDisabled()) {
            return res.json({
                refreshIntervalHrs: 24,
                dailyPurchaseHrs: 24,
                expiration: "9999-12-31T00:00:00.000Z",
                storefronts: []
            });
        }

        // OT6.5 / early build often cannot parse modern catalog
        const ua = String(req.headers["user-agent"] || "");
        if (ua.includes("2870186")) {
            return res.status(404).end();
        }

        let catalog = functions.getItemShop();

        try {
            const memory = functions.GetVersionInfo(req);
            if (memory && memory.build >= 30.10) {
                catalog = JSON.parse(JSON.stringify(catalog).replace(/"Normal"/g, '"Size_1_x_2"'));
            }
            if (memory && memory.build >= 30.20) {
                catalog = JSON.parse(
                    JSON.stringify(catalog).replace(/Game\/Items\/CardPacks\//g, "SaveTheWorld/Items/CardPacks/")
                );
            }
        } catch (e) {}

        res.json(catalog);
    } catch (err) {
        console.log("[storefront] catalog error:", err && err.message);
        res.status(500).json({ error: "catalog_failed", message: String(err && err.message) });
    }
});

express.get("/fortnite/api/storefront/v2/keychain", (req, res) => {
    res.json(keychain);
});

// ---------------------------------------------------------------------------
// Real-money V-Bucks packs. CurrencyStorefront entries in responses/catalog.json
// carry currencyType "RealMoney" and an appStoreId of offer://MtxPackNNNN, so the
// lobby prices them through a THREE-call chain:
//     GET  /fortnite/api/storefront/v2/catalog
//  -> GET  /catalog/api/shared/bulk/offers?id=offer://MtxPack...
//  -> POST /priceengine/api/shared/offers/price
// The third call had no route at all, so it fell through to the 404 handler in
// index.js. The client treats that as a transient failure, throws away the whole
// result and starts again at the catalog — which is the request storm in the log.
// Both endpoints below now answer with the shape the client expects, so it
// prices the packs once and stops asking.
// ---------------------------------------------------------------------------

const MTX_DESC =
    "Fortnite V-Bucks are a premium in-game currency you can spend on outfits, gliders, pickaxes, emotes and the Battle Pass.";

const MTX_PACKS = {
    MtxPack1000:  { price: 999,  title: "1,000 V-Bucks" },
    MtxPack2800:  { price: 2499, title: "2,800 V-Bucks" },
    MtxPack5000:  { price: 3999, title: "5,000 V-Bucks" },
    MtxPack7500:  { price: 5999, title: "7,500 V-Bucks" },
    MtxPack13500: { price: 9999, title: "13,500 V-Bucks" }
};

// "offer://MtxPack1000" -> "MtxPack1000"; also tolerates a bare id.
function packKey(id) {
    return String(id || "").replace(/^offer:\/\//, "").trim();
}

function packFor(id) {
    const key = packKey(id);
    // Unknown ids still get a priced offer back. Returning nothing for an id the
    // client asked about is itself a reason for it to retry forever.
    return MTX_PACKS[key] || { price: 999, title: key || "V-Bucks" };
}

// Shape mirrors the live catalog-public-service response closely enough for the
// store UI and the price engine to agree with each other.
function buildOffer(id) {
    const p = packFor(id);
    return {
        id: id,
        namespace: "fn",
        title: p.title,
        description: MTX_DESC,
        longDescription: MTX_DESC,
        shortDescription: "",
        technicalDetails: "",
        keyImages: [],
        categories: [{ path: "addons" }, { path: "addons/durable" }],
        items: [],
        customAttributes: {},
        catalogNs: null,
        offerMappings: [],
        offerType: "OTHERS",
        entitlementName: id,
        entitlementType: "AUDIENCE",
        itemType: "",
        releaseInfo: [],
        developer: "Epic Games",
        developerId: "o-lawinserver",
        eulaIds: [],
        endOfSupport: false,
        currencyCode: "USD",
        basePriceCurrencyCode: "USD",
        basePrice: p.price,
        currentPrice: p.price,
        price: p.price,
        priceBeforeTax: p.price,
        tax: 0,
        vatIncluded: true,
        recurrence: "ONCE",
        freeDays: 0,
        maxBillingCycles: 0,
        seller: { id: "o-lawinserver", name: "Epic Games" },
        viewableDate: "2017-01-01T00:00:00.000Z",
        effectiveDate: "2017-01-01T00:00:00.000Z",
        expiryDate: null,
        creationDate: "2017-01-01T00:00:00.000Z",
        lastModifiedDate: "2017-01-01T00:00:00.000Z",
        isCodeRedemptionOnly: false,
        unsearchable: false,
        countriesBlacklist: [],
        upgradeMode: null,
        taxSkuId: ""
    };
}

function handleBulkOffers(req, res) {
    let ids = req.query.id;
    if (!ids) ids = [];
    else if (!Array.isArray(ids)) ids = [ids];

    const out = {};
    for (const id of ids) out[id] = buildOffer(id);
    res.json(out);
}

express.get("/catalog/api/shared/bulk/offers", handleBulkOffers);
express.get("/catalog/api/shared/namespace/:namespace/bulk/offers", handleBulkOffers);

function priceBlock(amount) {
    return {
        currencyCode: "USD",
        discount: 0,
        originalPrice: amount,
        discountPrice: amount,
        basePayoutCurrencyCode: "USD",
        basePayoutPrice: amount,
        payoutCurrencyExchangeRate: 1,
        convenienceFee: 0,
        vat: 0,
        voucherDiscount: 0
    };
}

function handleOfferPrice(req, res) {
    const body = req.body || {};
    let offers = body.offers;
    if (!Array.isArray(offers)) offers = offers ? [offers] : [];

    // Some builds send a single offerId instead of an offers array.
    if (!offers.length && (body.offerId || req.query.id)) {
        offers = [{ offerId: body.offerId || req.query.id, namespace: "fn", quantity: 1 }];
    }

    let total = 0;
    const lineOffers = offers.map(o => {
        const id = o.offerId || o.id || "";
        const qty = Number(o.quantity) > 0 ? Number(o.quantity) : 1;
        const amount = packFor(id).price * qty;
        total += amount;
        return {
            appliedRules: [],
            offerId: id,
            namespace: o.namespace || "fn",
            quantity: qty,
            price: priceBlock(amount)
        };
    });

    res.json({
        totalPrice: priceBlock(total),
        lineOffers: lineOffers,
        country: body.country || req.query.country || "US"
    });
}

express.post("/priceengine/api/shared/offers/price", handleOfferPrice);
express.post("/priceengine/api/shared/namespace/:namespace/offers/price", handleOfferPrice);
express.get("/priceengine/api/shared/offers/price", handleOfferPrice);

express.get("/fortnite/api/storeaccess/v1/request_access/:accountId", (req, res) => {
    res.json([]);
});

// gift eligibility stub (common client call)
express.get(
    "/fortnite/api/storefront/v2/gift/check_eligibility/recipient/:recipientId/offer/:offerId",
    (req, res) => {
        res.json({
            price: {
                currencyType: "MtxCurrency",
                currencySubType: "",
                regularPrice: 0,
                finalPrice: 0,
                saleExpiration: "9999-12-31T23:59:59.999Z",
                basePrice: 0
            },
            items: []
        });
    }
);

module.exports = express;
