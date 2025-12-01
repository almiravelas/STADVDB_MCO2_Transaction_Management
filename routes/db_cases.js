const express = require("express");
const db_service = require("../models/db_service.js");

const router = express.Router();

// Node state example (0 = central, 1 = partition1, 2 = partition2)
let NODE_STATE = { 0: true, 1: true, 2: true };

// Toggle node state (simulate failure/recovery)
router.post("/toggle-node", (req, res) => {
    const { nodeId } = req.body;
    NODE_STATE[nodeId] = !NODE_STATE[nodeId];
    res.json({ success: true, NODE_STATE });
});

// Run case
router.post("/run-case", async (req, res) => {
    const { caseNum } = req.body;
    let result;
    switch (+caseNum) {
        case 1:
            result = await db_service.testCase1(NODE_STATE);
            break;
        case 2:
            result = await db_service.testCase2(NODE_STATE);
            break;
        case 3:
            result = await db_service.testCase3(NODE_STATE);
            break;
        case 4:
            result = await db_service.testCase4(NODE_STATE);
            break;
        default:
            return res.status(400).json({ success: false, logs: ["Invalid case"] });
    }
    res.json({ NODE_STATE, logs: result.logs });
});

module.exports = router;