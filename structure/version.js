const Express = require("express");
const express = Express.Router();
const functions = require("./functions.js");

express.get("/fortnite/api/version", async (req, res) => {
    // Previously hardcoded to a much later build (18.30 / CL 17951730), which never
    // matched this server's actual client (CL 611750138, from the matchmaking bucketId).
    // A CL mismatch here is exactly what produces "can't determine if game needs
    // updating" — report back the CL the CLIENT itself sent instead of a fixed one.
    const memory = functions.GetVersionInfo(req);
    const cln = memory.CL || "611750138";
    const versionStr = memory.build ? String(memory.build) : "1.0";
    const branch = "Release-" + versionStr;

    res.json({
        "app": "fortnite",
        "serverDate": new Date().toISOString(),
        "overridePropertiesVersion": "unknown",
        "cln": cln,
        "build": cln,
        "moduleName": "Fortnite-Core",
        "buildDate": "2021-10-27T21:00:51.697Z",
        "version": versionStr,
        "branch": branch,
        "modules": {
          "Epic-LightSwitch-AccessControlCore": {
            "cln": "17237679",
            "build": "b2130",
            "buildDate": "2021-08-19T18:56:08.144Z",
            "version": "1.0.0",
            "branch": "trunk"
          },
          "epic-xmpp-api-v1-base": {
            "cln": "5131a23c1470acbd9c94fae695ef7d899c1a41d6",
            "build": "b3595",
            "buildDate": "2019-07-30T09:11:06.587Z",
            "version": "0.0.1",
            "branch": "master"
          },
          "epic-common-core": {
            "cln": "17909521",
            "build": "3217",
            "buildDate": "2021-10-25T18:41:12.486Z",
            "version": "3.0",
            "branch": "TRUNK"
          }
        }
    });
})

express.get("/fortnite/api/v2/versioncheck/*", async (req, res) => {
    res.json({
        "type": "NO_UPDATE"
    })
})

express.get("/fortnite/api/v2/versioncheck*", async (req, res) => {
    res.json({
        "type": "NO_UPDATE"
    })
})

express.get("/fortnite/api/versioncheck*", async (req, res) => {
    res.json({
        "type": "NO_UPDATE"
    })
})

module.exports = express;