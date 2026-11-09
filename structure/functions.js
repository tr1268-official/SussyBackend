const XMLBuilder = require("xmlbuilder");
const uuid = require("uuid");
const fs = require("fs");
const path = require("path");

async function sleep(ms) {
    await new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    })
}

function GetVersionInfo(req) {
    var memory = {
        season: 0,
        build: 0.0,
        CL: "",
        lobby: ""
    }

    if (req.headers["user-agent"])
    {
        var CL = "";

        try {
            var BuildID = req.headers["user-agent"].split("-")[3].split(",")[0]
            if (!Number.isNaN(Number(BuildID))) {
                CL = BuildID;
            }

            if (Number.isNaN(Number(BuildID))) {
                var BuildID = req.headers["user-agent"].split("-")[3].split(" ")[0]
                if (!Number.isNaN(Number(BuildID))) {
                    CL = BuildID;
                }
            }
        } catch (err) {
            try {
                var BuildID = req.headers["user-agent"].split("-")[1].split("+")[0]
                if (!Number.isNaN(Number(BuildID))) {
                    CL = BuildID;
                }
            } catch (err) {}
        }

        try {
            var Build = req.headers["user-agent"].split("Release-")[1].split("-")[0];

            if (Build.split(".").length == 3) {
                Value = Build.split(".");
                Build = Value[0] + "." + Value[1] + Value[2];
            }

            memory.season = Number(Build.split(".")[0]);
            memory.build = Number(Build);
            memory.CL = CL;
            memory.lobby = `LobbySeason${memory.season}`;

            if (Number.isNaN(memory.season)) {
                throw new Error();
            }
        } catch (err) {
            memory.season = 2;
            memory.build = 2.0;
            memory.CL = CL;
            memory.lobby = "LobbyWinterDecor"; // LobbyHalloweenDecor , LobbyWinterDecor, LobbyDefaultDecor
        }
    }

    return memory;
}

const cosmetics = require("./cosmetics");

// Deterministic offerId so the shop the client sees matches the catalog used
// at purchase time. Random IDs previously caused "offer could not be found"
// because getItemShop() was called independently for the catalog response and
// for PurchaseCatalogEntry.
function stableOfferId(seed) {
    return require("crypto").createHash("md5").update(String(seed || "")).digest("hex");
}

function makeCatalogEntry(templateId, isFeatured, configKey) {
    const tid = String(templateId || "");
    // Prefer config key (e.g. "featured1") so multi-grant bundles stay unique;
    // fall back to templateId for single-item offers.
    const offerId = stableOfferId(configKey || tid);
    // Was: displayName = tid.split(":")[1], i.e. the raw asset id such as
    // "CID_009_Athena_Commando_M", which is what the lobby was displaying.
    const info = cosmetics.lookup(tid);
    const displayName = info.name;
    return {
        offerId: offerId,
        devName: displayName,
        offerType: "StaticPrice",
        prices: [{
            currencyType: "MtxCurrency",
            currencySubType: "",
            regularPrice: 0,
            finalPrice: 0,
            saleExpiration: "9999-12-31T23:59:59.999Z",
            basePrice: 0
        }],
        categories: isFeatured ? ["Panel 1"] : [],
        dailyLimit: -1,
        weeklyLimit: -1,
        monthlyLimit: -1,
        refundable: false,
        appStoreId: [""],
        requirements: [{
            requirementType: "DenyOnItemOwnership",
            requiredId: tid,
            minQuantity: 1
        }],
        metaInfo: [],
        catalogGroup: "",
        catalogGroupPriority: 0,
        sortPriority: isFeatured ? 0 : -1,
        title: displayName,
        shortDescription: info.type === "AthenaCharacter" ? "Outfit" : "",
        description: info.description || displayName,
        displayAssetPath: "",
        itemGrants: [{ templateId: tid, quantity: 1 }]
    };
}

// Single shared catalog instance so every consumer (shop endpoint + purchase)
// sees identical offerIds for the lifetime of the process.
let _cachedItemShop = null;

function getItemShop() {
    if (_cachedItemShop) return _cachedItemShop;

    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "responses", "catalog.json"), "utf8"));
    let cfg;
    try { cfg = path.join(__dirname, "..", "Config", "config.ini"); } catch {}
    if (cfg?.shop?.enabled === false) {
        _cachedItemShop = cosmetics.decorateCatalog(catalog);
        return _cachedItemShop;
    }

    const dailySF   = catalog.storefronts.find(s => s.name === "BRDailyStorefront");
    const featuredSF = catalog.storefronts.find(s => s.name === "BRWeeklyStorefront");

    let CatalogConfig;
    try {
        CatalogConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "Config", "catalog_config.json"), "utf8"));
    } catch {
        _cachedItemShop = cosmetics.decorateCatalog(catalog);
        return _cachedItemShop;
    }

    for (const key in CatalogConfig) {
        if (key.startsWith("//")) continue;
        const entry = CatalogConfig[key];
        if (!Array.isArray(entry.itemGrants) || !entry.itemGrants.length) continue;
        const isFeature = key.toLowerCase().startsWith("featured");
        const t = entry.itemGrants[0];
        const e = makeCatalogEntry(t, isFeature, key);
        e.prices[0].regularPrice = entry.price;
        e.prices[0].finalPrice   = entry.price;
        e.prices[0].basePrice    = entry.price;
        e.itemGrants = entry.itemGrants.map(tid => ({ templateId: tid, quantity: 1 }));
        if (isFeature) { if (featuredSF) featuredSF.catalogEntries.push(e); }
        else           { if (dailySF)    dailySF.catalogEntries.push(e); }
    }
    _cachedItemShop = cosmetics.decorateCatalog(catalog);
    return _cachedItemShop;
}

function getOfferID(offerId) {
    const catalog = getItemShop();
    for (const sf of catalog.storefronts) {
        for (const entry of sf.catalogEntries) {
            if (entry.offerId === offerId) return { offerId: entry };
        }
    }
    return null;
}

function getTheater(req) {
    const memory = GetVersionInfo(req);

    var theater = JSON.stringify(require("./../responses/Campaign/worldstw.json"));
    var Season = "Season" + memory.season;

    try {
        if (memory.build >= 30.20) { // Those changes have to be made before the 15.30+ ones
            theater = theater.replace(/\/Game\/World\/ZoneThemes/ig, "/STW_Zones/World/ZoneThemes");
            theater = theater.replace(/\"DataTable\'\/Game\//ig, "\"/Script/Engine.DataTable\'\/Game\/");
        }

        if (memory.build >= 15.30) {
            theater = theater.replace(/\/Game\//ig, "\/SaveTheWorld\/");
            theater = theater.replace(/\"DataTable\'\/SaveTheWorld\//ig, "\"DataTable\'\/Game\/"); // For those versions keep /Game/ for DataTables
        }

        var date = new Date();
        var hour = date.getHours();

        // Set the 24-hour StW mission refresh date for season 9 and above
        if (memory.season >= 9) {
            date.setHours(23, 59, 59, 999);
        } else {
            // Set the 6-hour StW mission refresh date for versions below season 9
            if (hour < 6) {
                date.setHours(5, 59, 59, 999);
            } else if (hour < 12) {
                date.setHours(11, 59, 59, 999);
            } else if (hour < 18) {
                date.setHours(17, 59, 59, 999);
            } else {
                date.setHours(23, 59, 59, 999);
            }
        }

        date = date.toISOString();

        theater = theater.replace(/2017-07-25T23:59:59.999Z/ig, date);
    } catch (err) {}

    theater = JSON.parse(theater)

    if (theater.hasOwnProperty("Seasonal")) {
        if (theater.Seasonal.hasOwnProperty(Season)) {
            theater.theaters = theater.theaters.concat(theater.Seasonal[Season].theaters);
            theater.missions = theater.missions.concat(theater.Seasonal[Season].missions);
            theater.missionAlerts = theater.missionAlerts.concat(theater.Seasonal[Season].missionAlerts);
        }
        delete theater.Seasonal;
    }

    return theater;
}

function chooseTranslationsInJSON(obj, req, targetLanguage = "") {
    if (!targetLanguage) {
        if (req.headers["accept-language"]) {
            if (req.headers["accept-language"].includes("-") && req.headers["accept-language"] != "es-419" && req.headers["accept-language"] != "pt-BR") {
                targetLanguage = req.headers["accept-language"].split("-")[0];
            } else {
                targetLanguage = req.headers["accept-language"];
            }
        } else {
            targetLanguage = "en";
        }
    }
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
            chooseTranslationsInJSON(obj[i], req, targetLanguage);
        }
    } else if (typeof obj === "object" && obj !== null) {
        for (const key in obj) {
            if (typeof obj[key] === "object" && obj[key] !== null) {
                if (obj[key][targetLanguage] || obj[key]["en"]) {
                    obj[key] = obj[key][targetLanguage] || obj[key]["en"];
                } else {
                    chooseTranslationsInJSON(obj[key], req, targetLanguage);
                }
            }
        }
    }
}

function getContentPages(req) {
    const memory = GetVersionInfo(req);

    const contentpages = JSON.parse(JSON.stringify(require("./../responses/contentpages.json")));

    chooseTranslationsInJSON(contentpages, req)

    const news = ["savetheworldnews", "battleroyalenews"];
    try {
        if (memory.build < 5.30) {
            news.forEach(mode => {
                contentpages[mode].news.messages[0].image = "https://fortnite-public-service-prod11.ol.epicgames.com/images/discord-s.png";
                contentpages[mode].news.messages[1].image = "https://fortnite-public-service-prod11.ol.epicgames.com/images/lawin-s.png";
            })
        }
    } catch (err) {}

    try {
        const backgrounds = contentpages.dynamicbackgrounds.backgrounds.backgrounds;
        const season = `season${memory.season}${memory.season >= 21 ? "00" : ""}`;
        backgrounds[0].stage = season;
        backgrounds[1].stage = season;

        switch (memory.season) {

            case 9:
                contentpages.lobby.backgroundimage = "";
                contentpages.lobby.stage = "default";
                break;
            
            case 10:
                backgrounds[0].stage = "seasonx";
                backgrounds[1].stage = "seasonx";
                break;
            
            case 11: case 12: case 13: case 14: case 15: case 16: case 17: case 18: case 19:
                // Just do nothing here for these seasons
                break;

            case 20:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-bp20-lobby-2048x1024-d89eb522746c.png";
                break;

            case 21:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/s21-lobby-background-2048x1024-2e7112b25dc3.jpg";
                break;

            case 22:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-bp22-lobby-square-2048x2048-2048x2048-e4e90c6e8018.jpg";
                break;

            case 23:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-bp23-lobby-2048x1024-2048x1024-26f2c1b27f63.png";
                break;
            
            case 24:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-ch4s2-bp-lobby-4096x2048-edde08d15f7e.jpg";
                break;

            case 25:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/s25-lobby-4k-4096x2048-4a832928e11f.jpg";
                backgrounds[1].backgroundimage = "https://cdn2.unrealengine.com/fn-shop-ch4s3-04-1920x1080-785ce1d90213.png";
                break;

            case 27:
                backgrounds[0].stage = "rufus";
                break;

            default:
                backgrounds[0].stage = "defaultnotris";
                backgrounds[0].backgroundimage = "https://fortnite-public-service-prod11.ol.epicgames.com/images/lightlobbybg.png";

        }

        switch (memory.build) {

            case 9.30:
                contentpages.lobby.stage = "summer";
                break;

            case 11.10:
                backgrounds[0].stage = "fortnitemares";
                backgrounds[1].stage = "fortnitemares";
                break;

            case 11.31:
            case 11.40:
                backgrounds[0].stage = "winter19";
                backgrounds[1].stage = "winter19";
                break;

            case 19.01:
                backgrounds[0].stage = "winter2021";
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-bp19-lobby-xmas-2048x1024-f85d2684b4af.png";
                contentpages.subgameinfo.battleroyale.image = "https://cdn2.unrealengine.com/19br-wf-subgame-select-512x1024-16d8bb0f218f.jpg";
                contentpages.specialoffervideo.bSpecialOfferEnabled = "true";
                break;

            case 20.40:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-bp20-40-armadillo-glowup-lobby-2048x2048-2048x2048-3b83b887cc7f.jpg";
                break;

            case 21.10:
                backgrounds[0].stage = "season2100";
                break;

            case 21.30:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/nss-lobbybackground-2048x1024-f74a14565061.jpg";
                backgrounds[0].stage = "season2130";
                break;

            case 23.10:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-bp23-winterfest-lobby-square-2048x2048-2048x2048-277a476e5ca6.png";
                contentpages.specialoffervideo.bSpecialOfferEnabled = "true";
                break;

            case 25.11:
                backgrounds[0].backgroundimage = "https://cdn2.unrealengine.com/t-s25-14dos-lobby-4096x2048-2be24969eee3.jpg";

        }

    } catch (err) {}

    return contentpages;
}

function MakeSurvivorAttributes(templateId) {
    const SurvivorData = require("./../responses/Campaign/survivorData.json");
    var SurvivorAttributes = {
        "level": 1,
        "item_seen": false,
        "squad_slot_idx": -1,
        "building_slot_used": -1
    };

    if (SurvivorData.fixedAttributes.hasOwnProperty(templateId)) {
        SurvivorAttributes = {...SurvivorAttributes, ...SurvivorData.fixedAttributes[templateId]};
    }

    if (!SurvivorAttributes.hasOwnProperty("gender")) {
        SurvivorAttributes.gender = (Math.floor(Math.random() * (1 - 3) + 3)).toString(); // Set a random survivor gender ("1" = male, "2" = female)
    }

    if (!SurvivorAttributes.hasOwnProperty("managerSynergy")) {
        var randomNumber = Math.floor(Math.random() * SurvivorData.bonuses.length);
        SurvivorAttributes.set_bonus = SurvivorData.bonuses[randomNumber];
    }
    
    if (!SurvivorAttributes.hasOwnProperty("personality")) {
        var randomNumber = Math.floor(Math.random() * SurvivorData.personalities.length);
        SurvivorAttributes.personality = SurvivorData.personalities[randomNumber];
    }

    if (!SurvivorAttributes.hasOwnProperty("portrait")) {
        portraitFactor = SurvivorAttributes.personality;
        if (SurvivorAttributes.hasOwnProperty("managerSynergy")) {
            portraitFactor = SurvivorAttributes.managerSynergy;
        }

        var gender = SurvivorAttributes.gender;
        var randomNumber = Math.floor(Math.random() * SurvivorData.portraits[portraitFactor][gender].length);
        SurvivorAttributes.portrait = SurvivorData.portraits[portraitFactor][gender][randomNumber];
    }

    return SurvivorAttributes;
}

function MakeID() {
    return uuid.v4();
}

function sendXmppMessageToAll(body) {
    if (!global.Clients) return;
    if (typeof body == "object") body = JSON.stringify(body);
    const domain = global.xmppDomain || "prod.ol.epicgames.com";

    global.Clients.forEach(ClientData => {
        if (!ClientData || ClientData.isVirtualHost || !ClientData.client || !ClientData.client.send) return;
        try {
            ClientData.client.send(XMLBuilder.create("message")
                .attribute("from", "xmpp-admin@" + domain)
                .attribute("xmlns", "jabber:client")
                .attribute("to", ClientData.jid)
                .element("body", `${body}`).up().toString());
        } catch (e) {}
    });
}

// AthenaOG-style presence exchange so newly-accepted friends light up online.
function sendPresenceTo(toAccountId, fromAccountId) {
    try {
        const tcp = require("./TCP_XMPP.js");
        if (tcp && typeof tcp.sendPresenceTo === "function") {
            return tcp.sendPresenceTo(toAccountId, fromAccountId);
        }
    } catch (e) {}
    if (!global.Clients) return;
    const to = global.Clients.find(c => c.accountId === toAccountId && !c.isVirtualHost);
    const from = global.Clients.find(c => c.accountId === fromAccountId);
    if (!to || !from || !to.client || !to.client.send) return;
    const lp = from.lastPresenceUpdate || { away: false, status: "{}" };
    const status = (lp.status && lp.status !== "{}") ? lp.status : JSON.stringify({
        Status: "Online", bIsPlaying: false, bIsJoinable: false,
        bHasVoiceSupport: false, ProductName: "Fortnite", SessionId: ""
    });
    try {
        let xml = XMLBuilder.create("presence")
            .attribute("to", to.jid)
            .attribute("xmlns", "jabber:client")
            .attribute("from", from.jid)
            .attribute("type", "available");
        if (lp.away) xml = xml.element("show", "away").up();
        xml = xml.element("status", status).up();
        to.client.send(xml.toString());
    } catch (e) {}
}

function exchangePresence(accountIdA, accountIdB) {
    sendPresenceTo(accountIdA, accountIdB);
    sendPresenceTo(accountIdB, accountIdA);
}

function DecodeBase64(str) {
    return Buffer.from(str, 'base64').toString()
}

module.exports = {
    sleep,
    GetVersionInfo,
    getItemShop,
    getOfferID,
    getTheater,
    chooseTranslationsInJSON,
    getContentPages,
    MakeSurvivorAttributes,
    MakeID,
    sendXmppMessageToAll,
    sendPresenceTo,
    exchangePresence,
    DecodeBase64
}
