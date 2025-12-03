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
    },

    // =====================================================
    // Recovery Monitor Controls
    // =====================================================
    startRecoveryMonitor(req, res) {
        const intervalMs = (req.body && req.body.intervalMs) || 30000; // Default 30 seconds
        const result = db_service.startRecoveryMonitor(intervalMs, NODE_STATE);
        res.json(result);
    },

    stopRecoveryMonitor(req, res) {
        const result = db_service.stopRecoveryMonitor();
        res.json(result);
    },

    getRecoveryMonitorStatus(req, res) {
        const status = db_service.getRecoveryMonitorStatus();
        res.json(status);
    },

    getQueueStatus(req, res) {
        const status = {
            central: db_service.missedWrites[0].length,
            partition1: db_service.missedWrites[1].length,
            partition2: db_service.missedWrites[2].length,
            total: db_service.missedWrites[0].length + 
                   db_service.missedWrites[1].length + 
                   db_service.missedWrites[2].length,
            details: {
                central: db_service.missedWrites[0].map(w => ({
                    user: `${w.params[0]} ${w.params[1]}`,
                    country: w.params[3],
                    attempts: w.attemptCount,
                    lastError: w.lastError
                })),
                partition1: db_service.missedWrites[1].map(w => ({
                    user: `${w.params[0]} ${w.params[1]}`,
                    country: w.params[3],
                    attempts: w.attemptCount,
                    lastError: w.lastError
                })),
                partition2: db_service.missedWrites[2].map(w => ({
                    user: `${w.params[0]} ${w.params[1]}`,
                    country: w.params[3],
                    attempts: w.attemptCount,
                    lastError: w.lastError
                }))
            }
        };
        res.json(status);
    },

    async getSystemHealth(req, res) {
        try {
            const health = {
                timestamp: new Date().toISOString(),
                nodes: {},
                queues: {
                    central: db_service.missedWrites[0].length,
                    partition1: db_service.missedWrites[1].length,
                    partition2: db_service.missedWrites[2].length
                },
                monitor: db_service.getRecoveryMonitorStatus(),
                overall: 'HEALTHY'
            };

            // Check health of each node
            for (let nodeId of [0, 1, 2]) {
                const isHealthy = await db_service.isNodeHealthy(nodeId, 1000);
                health.nodes[`node${nodeId}`] = {
                    id: nodeId,
                    name: nodeId === 0 ? 'Central' : `Partition ${nodeId}`,
                    status: isHealthy ? 'ONLINE' : 'OFFLINE',
                    healthy: isHealthy,
                    queueSize: db_service.missedWrites[nodeId].length
                };
            }

            // Determine overall system health
            const allNodesHealthy = Object.values(health.nodes).every(n => n.healthy);
            const hasQueuedWrites = health.queues.central > 0 || 
                                    health.queues.partition1 > 0 || 
                                    health.queues.partition2 > 0;

            if (!allNodesHealthy && hasQueuedWrites) {
                health.overall = 'DEGRADED';
            } else if (!allNodesHealthy) {
                health.overall = 'PARTIAL';
            } else if (hasQueuedWrites) {
                health.overall = 'RECOVERING';
            }

            res.json(health);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }
};
