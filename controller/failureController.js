const db_service = require("../models/db_service.js");
const db_router = require("../models/db_router.js");

// Keep track of node states
let NODE_STATE = {
    0: true,   // central node
    1: true,   // partition 1
    2: true    // partition 2
};

module.exports = {
    nodeOff(req, res) {
        const id = req.params.id;
        NODE_STATE[id] = false;
        return res.json({ success: true, message: `Node ${id} is now OFFLINE.` });
    },

    nodeOn(req, res) {
        const id = req.params.id;
        NODE_STATE[id] = true;
        return res.json({ success: true, message: `Node ${id} is now ONLINE.` });
    },

    // =====================================================
    // Case 1 - Partition → Central replication fails
    // =====================================================
    async testCase1(req, res) {
        try {
            const result = await db_service.testCase1(NODE_STATE);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // =====================================================
    // Case 2 - Central recovers after missed writes
    // =====================================================
    async testCase2(req, res) {
        try {
            const result = await db_service.testCase2(NODE_STATE);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // =====================================================
    // Case 3 - Central → Partition replication fails
    // =====================================================
    async testCase3(req, res) {
        try {
            const result = await db_service.testCase3(NODE_STATE);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // =====================================================
    // Case 4 - Partition recovers after missed writes
    // =====================================================
    async testCase4(req, res) {
        try {
            const result = await db_service.testCase4(NODE_STATE);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }
};
