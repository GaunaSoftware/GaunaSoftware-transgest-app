const express = require("express");
const r = express.Router();
// Stub route - mi_cuenta
r.get("/", (req, res) => res.json({ data: [], message: "Module mi_cuenta pending implementation" }));
module.exports = r;
