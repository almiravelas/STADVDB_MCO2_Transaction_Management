const db_service = require("../models/db_service.js");
const db_router = require("../models/db_router.js");

// Keep track of node states
let NODE_STATE = {
    0: true,   // central node
    1: true,   // partition 1
    2: true    // partition 2
};

const failureController = {
    // Function to get NODE_STATE directly (not a route handler)
    getNodeState() {
        return NODE_STATE;
    },

    // Route handler to get node state
    getNodeStateHandler(req, res) {
        return res.json({ NODE_STATE });
    },

    nodeOff(req, res) {
        const id = req.params.id;
        NODE_STATE[id] = false;
        return res.json({ success: true, message: `Node ${id} is now OFFLINE.`, NODE_STATE });
    },

    nodeOn(req, res) {
        const id = req.params.id;
        NODE_STATE[id] = true;
        return res.json({ success: true, message: `Node ${id} is now ONLINE.`, NODE_STATE });
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

    async getQueueStatus(req, res) {
        try {
            // Get from persistent database queue ONLY (in-memory doesn't persist on Vercel)
            const persistentQueue = await db_service.getPersistentQueueStatus();
            
            console.log('[Queue Status] Persistent queue:', JSON.stringify({
                p0: persistentQueue[0],
                p1: persistentQueue[1],
                p2: persistentQueue[2]
            }));
            
            // Only use persistent queue counts (in-memory is unreliable on serverless)
            const status = {
                central: persistentQueue[0],
                partition1: persistentQueue[1],
                partition2: persistentQueue[2],
                total: persistentQueue[0] + persistentQueue[1] + persistentQueue[2],
                details: persistentQueue.details
            };
            res.json(status);
        } catch (err) {
            // Fallback to in-memory only
            console.error('[Queue Status] Error getting persistent queue:', err.message);
            const status = {
                central: db_service.missedWrites[0].length,
                partition1: db_service.missedWrites[1].length,
                partition2: db_service.missedWrites[2].length,
                total: db_service.missedWrites[0].length + 
                       db_service.missedWrites[1].length + 
                       db_service.missedWrites[2].length,
                details: {
                    central: db_service.missedWrites[0].map(w => ({
                        user: `${w.params[1]} ${w.params[2]}`,
                        country: w.params[4],
                        attempts: w.attemptCount,
                        lastError: w.lastError
                    })),
                    partition1: db_service.missedWrites[1].map(w => ({
                        user: `${w.params[1]} ${w.params[2]}`,
                        country: w.params[4],
                        attempts: w.attemptCount,
                        lastError: w.lastError
                    })),
                    partition2: db_service.missedWrites[2].map(w => ({
                        user: `${w.params[1]} ${w.params[2]}`,
                        country: w.params[4],
                        attempts: w.attemptCount,
                        lastError: w.lastError
                    }))
                }
            };
            res.json(status);
        }
    },

    async getSystemHealth(req, res) {
        try {
            // Get persistent queue status
            let queueStatus = { 0: 0, 1: 0, 2: 0 };
            try {
                queueStatus = await db_service.getPersistentQueueStatus();
            } catch (e) {
                // Fallback to in-memory
            }
            
            const health = {
                timestamp: new Date().toISOString(),
                nodes: {},
                queues: {
                    central: queueStatus[0],
                    partition1: queueStatus[1],
                    partition2: queueStatus[2]
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

module.exports = failureController;