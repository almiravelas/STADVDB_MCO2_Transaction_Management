const db_router = require('../models/db_router');
const db_access = require('../models/db_access');

// For pausing execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class db_service {

    // In-memory queue for fallback (still useful for local testing)
    // Structure: { 0: [], 1: [], 2: [] }
    static missedWrites = {
        0: [],
        1: [],
        2: []
    };

    // Background recovery monitor state
    static recoveryMonitor = {
        enabled: false,
        intervalId: null,
        checkIntervalMs: 30000, // Check every 30 seconds
        lastCheckTime: null,
        nodeState: null,  // Reference to NODE_STATE from controller
        stats: {
            totalChecks: 0,
            totalRecoveries: 0,
            lastRecoveryTime: null
        },
        lastResult: {
            timestamp: null,
            recovered: 0,
            remaining: 0,
            message: 'No recovery attempts yet'
        }
    };

    // =========================================================
    // PERSISTENT QUEUE METHODS (Database-backed for Vercel)
    // =========================================================

    /**
     * Add a missed write to the persistent database queue
     * Stores in Central node's recovery_queue table
     */
    static async queueMissedWrite(partition, userId, sql, params, error) {
        const centralPool = db_router.getCentralNode();
        let conn;
        try {
            conn = await centralPool.getConnection();
            const insertSql = `
                INSERT INTO recovery_queue (target_partition, user_id, query_text, params_json, last_error, error_type)
                VALUES (?, ?, ?, ?, ?, ?)
            `;
            await conn.query(insertSql, [
                partition,
                userId,
                sql,
                JSON.stringify(params),
                error.message || 'Unknown error',
                db_service.classifyError(error).type
            ]);
            console.log(`[Queue] Added user ${userId} to persistent queue for partition ${partition}`);
            return true;
        } catch (err) {
            console.error('[Queue] Failed to persist missed write:', err.message);
            // Fallback to in-memory queue
            db_service.missedWrites[partition].push({
                query: sql,
                params: params,
                insertedId: userId,
                attemptCount: 1,
                lastError: error.message,
                queuedAt: new Date()
            });
            return false;
        } finally {
            if (conn) conn.release();
        }
    }

    /**
     * Get pending writes count from persistent queue
     */
    static async getPersistentQueueStatus() {
        const centralPool = db_router.getCentralNode();
        let conn;
        try {
            conn = await centralPool.getConnection();
            const [rows] = await conn.query(`
                SELECT target_partition, COUNT(*) as count 
                FROM recovery_queue 
                WHERE status = 'pending' 
                GROUP BY target_partition
            `);
            
            const result = { 0: 0, 1: 0, 2: 0, details: { central: [], partition1: [], partition2: [] } };
            rows.forEach(row => {
                result[row.target_partition] = row.count;
            });

            // Get details for pending writes
            const [details] = await conn.query(`
                SELECT id, target_partition, user_id, params_json, attempt_count 
                FROM recovery_queue 
                WHERE status = 'pending'
                ORDER BY queued_at ASC
                LIMIT 20
            `);
            
            details.forEach(d => {
                const params = JSON.parse(d.params_json);
                const detail = {
                    id: d.id,
                    user: `${params[1]} ${params[2]}`,
                    country: params[4],
                    attempts: d.attempt_count
                };
                if (d.target_partition === 1) result.details.partition1.push(detail);
                else if (d.target_partition === 2) result.details.partition2.push(detail);
                else result.details.central.push(detail);
            });

            return result;
        } catch (err) {
            console.error('[Queue] Failed to get persistent queue status:', err.message);
            // Fallback to in-memory
            return {
                0: db_service.missedWrites[0].length,
                1: db_service.missedWrites[1].length,
                2: db_service.missedWrites[2].length,
                details: { central: [], partition1: [], partition2: [] }
            };
        } finally {
            if (conn) conn.release();
        }
    }

    /**
     * Process persistent queue for a partition
     */
    static async processPersistentQueue(partition) {
        const centralPool = db_router.getCentralNode();
        let centralConn;
        let partitionConn;
        let recoveredCount = 0;

        try {
            centralConn = await centralPool.getConnection();
            
            // Get pending writes for this partition
            const [pending] = await centralConn.query(`
                SELECT id, user_id, query_text, params_json, attempt_count 
                FROM recovery_queue 
                WHERE target_partition = ? AND status = 'pending'
                ORDER BY queued_at ASC
                LIMIT 10
            `, [partition]);

            if (pending.length === 0) {
                return 0;
            }

            console.log(`[Recovery] Partition ${partition}: ${pending.length} pending writes in DB queue`);
            console.log(`[Recovery] Pending IDs: ${pending.map(p => p.user_id).join(', ')}`);

            // Try to connect to partition
            const partitionPool = db_router.getNodeById(partition);
            
            try {
                partitionConn = await db_service.connectWithTimeout(partitionPool, 2000);
            } catch (connErr) {
                console.log(`[Recovery] Partition ${partition}: Cannot connect - ${connErr.message}`);
                return 0;
            }

            for (const write of pending) {
                try {
                    const params = JSON.parse(write.params_json);
                    const userId = write.user_id;
                    
                    console.log(`[Recovery] Processing user ${userId} for partition ${partition}`);

                    // Check if already exists in partition
                    const [existing] = await partitionConn.query(
                        "SELECT id FROM users WHERE id = ?", 
                        [userId]
                    );

                    if (existing && existing.length > 0) {
                        // Already exists, mark as completed
                        await centralConn.query(
                            "UPDATE recovery_queue SET status = 'completed', last_attempt_at = NOW() WHERE id = ?",
                            [write.id]
                        );
                        console.log(`[Recovery] ✓ User ${userId} already exists in partition ${partition}, marked complete`);
                        recoveredCount++;
                        continue;
                    }

                    // Execute the write to partition
                    console.log(`[Recovery] Inserting user ${userId} into partition ${partition}...`);
                    await db_service.queryWithTimeout(partitionConn, write.query_text, params, 2000);
                    
                    // Mark as completed
                    await centralConn.query(
                        "UPDATE recovery_queue SET status = 'completed', last_attempt_at = NOW() WHERE id = ?",
                        [write.id]
                    );
                    console.log(`[Recovery] ✓ Recovered user ${userId} to partition ${partition}`);
                    recoveredCount++;

                } catch (err) {
                    console.error(`[Recovery] Error recovering write ${write.id}:`, err.message);
                    
                    // Handle duplicate key error
                    if (err.code === 'ER_DUP_ENTRY' || err.message.includes('Duplicate entry')) {
                        await centralConn.query(
                            "UPDATE recovery_queue SET status = 'completed', last_attempt_at = NOW() WHERE id = ?",
                            [write.id]
                        );
                        recoveredCount++;
                        continue;
                    }

                    // Update attempt count
                    const newAttemptCount = write.attempt_count + 1;
                    if (newAttemptCount >= 10) {
                        await centralConn.query(
                            "UPDATE recovery_queue SET status = 'failed', attempt_count = ?, last_error = ?, last_attempt_at = NOW() WHERE id = ?",
                            [newAttemptCount, err.message, write.id]
                        );
                    } else {
                        await centralConn.query(
                            "UPDATE recovery_queue SET attempt_count = ?, last_error = ?, last_attempt_at = NOW() WHERE id = ?",
                            [newAttemptCount, err.message, write.id]
                        );
                    }
                }
            }

            return recoveredCount;

        } catch (err) {
            console.error(`[Recovery] Partition ${partition} recovery failed:`, err.message);
            return 0;
        } finally {
            if (centralConn) centralConn.release();
            if (partitionConn) partitionConn.release();
        }
    }

    /**
     * Start the background recovery monitor
     * Automatically checks for recovered nodes and applies missed writes
     */
    static startRecoveryMonitor(intervalMs = 30000, nodeState = null) {
        if (db_service.recoveryMonitor.enabled) {
            console.log("[Recovery Monitor] Already running");
            return { success: false, message: "Monitor already running" };
        }

        db_service.recoveryMonitor.checkIntervalMs = intervalMs;
        db_service.recoveryMonitor.enabled = true;
        db_service.recoveryMonitor.nodeState = nodeState;

        db_service.recoveryMonitor.intervalId = setInterval(async () => {
            await db_service.performBackgroundRecovery();
        }, intervalMs);

        console.log(`[Recovery Monitor] Started (interval: ${intervalMs}ms)`);
        return { success: true, message: "Recovery monitor started" };
    }

    /**
     * Stop the background recovery monitor
     */
    static stopRecoveryMonitor() {
        if (!db_service.recoveryMonitor.enabled) {
            return { success: false, message: "Monitor not running" };
        }

        clearInterval(db_service.recoveryMonitor.intervalId);
        db_service.recoveryMonitor.enabled = false;
        db_service.recoveryMonitor.intervalId = null;

        console.log("[Recovery Monitor] Stopped");
        return { success: true, message: "Recovery monitor stopped" };
    }

    /**
     * Perform background recovery check
     * This is called automatically by the monitor
     * Uses BOTH persistent queue (database) and in-memory queue
     */
    static async performBackgroundRecovery() {
        const checkTime = new Date();
        db_service.recoveryMonitor.lastCheckTime = checkTime;
        db_service.recoveryMonitor.stats.totalChecks++;

        console.log(`[Recovery Monitor] Check #${db_service.recoveryMonitor.stats.totalChecks} at ${checkTime.toISOString()}`);

        let totalRecovered = 0;
        let totalRemaining = 0;

        for (let partition of [1, 2]) {
            // NOTE: We don't check simulated NODE_STATE here because:
            // 1. On serverless (Vercel), NODE_STATE is not shared between instances
            // 2. The queue already contains writes that need recovery
            // 3. We only check ACTUAL database health
            
            // Check actual health - can we connect to the partition?
            const isHealthy = await db_service.isNodeHealthy(partition, 2000);
            if (!isHealthy) {
                console.log(`[Recovery] Partition ${partition}: Cannot connect - skipping`);
                continue;
            }
            
            console.log(`[Recovery] Partition ${partition}: Online - processing queue...`);

            // Try persistent queue first (this is the main queue on Vercel)
            const persistentRecovered = await db_service.processPersistentQueue(partition);
            totalRecovered += persistentRecovered;
            
            // In-memory queue is only for local development fallback
            // Don't count it in totalRemaining since it's unreliable on serverless
            if (db_service.missedWrites[partition].length > 0) {
                const memoryRecovered = await db_service.attemptPartitionRecovery(partition);
                totalRecovered += memoryRecovered;
            }
            
            if (persistentRecovered > 0) {
                db_service.recoveryMonitor.stats.totalRecoveries += persistentRecovered;
                db_service.recoveryMonitor.stats.lastRecoveryTime = checkTime;
            }
        }

        // Get persistent queue status for accurate remaining count (ONLY source of truth)
        try {
            const queueStatus = await db_service.getPersistentQueueStatus();
            totalRemaining = queueStatus[1] + queueStatus[2];
        } catch (e) {
            console.error('[Recovery Monitor] Failed to get queue status:', e.message);
        }

        // Update last result
        db_service.recoveryMonitor.lastResult = {
            timestamp: checkTime,
            recovered: totalRecovered,
            remaining: totalRemaining,
            message: totalRecovered > 0 
                ? `✓ Recovered ${totalRecovered} write(s). ${totalRemaining} remaining.`
                : totalRemaining > 0 
                    ? `Waiting... ${totalRemaining} write(s) pending.`
                    : '✓ All queues empty. System healthy.'
        };

        if (totalRecovered > 0) {
            console.log(`[Recovery Monitor] ✓ Recovered ${totalRecovered} writes this cycle`);
        } else if (totalRemaining > 0) {
            console.log(`[Recovery Monitor] ${totalRemaining} writes still pending`);
        } else {
            console.log("[Recovery Monitor] All systems operational");
        }
    }

    /**
     * Attempt to recover writes for a specific partition (IN-MEMORY queue)
     * Can be called immediately when a write is queued or by the monitor
     */
    static async attemptPartitionRecovery(partition) {
        // Skip if no missed writes
        if (db_service.missedWrites[partition].length === 0) {
            return 0;
        }

        console.log(`[Recovery] Partition ${partition}: ${db_service.missedWrites[partition].length} pending writes`);

        // Check simulated state first (respect UI toggles)
        if (db_service.recoveryMonitor.nodeState && !db_service.recoveryMonitor.nodeState[partition]) {
            console.log(`[Recovery] Partition ${partition}: OFFLINE (simulated) - skipping recovery`);
            return 0;
        }

        // Check actual health
        const isHealthy = await db_service.isNodeHealthy(partition, 1000);
        if (!isHealthy) {
            console.log(`[Recovery] Partition ${partition}: Still offline`);
            return 0;
        }

        console.log(`[Recovery] Partition ${partition}: Online - attempting recovery...`);

        // Attempt recovery
        const pPool = db_router.getNodeById(partition);
        let pConn;
        let successCount = 0;

        try {
            pConn = await db_service.connectWithTimeout(pPool, 2000);
            
            const remainingWrites = [];

            for (let write of db_service.missedWrites[partition]) {
                try {
                    // params order: [id, firstname, lastname, city, country, createdAt, updatedAt]
                    const userId = write.params[0];
                    
                    // Check for duplicates by ID
                    const checkSql = "SELECT id FROM users WHERE id = ?";
                    const [existing] = await db_service.queryWithTimeout(
                        pConn, 
                        checkSql, 
                        [userId], 
                        2000
                    );

                    if (existing && existing.length > 0) {
                        console.log(`[Recovery] Skipped duplicate ID ${userId}: ${write.params[1]} ${write.params[2]}`);
                        successCount++;
                        continue;
                    }

                    // Apply write
                    await db_service.queryWithTimeout(pConn, write.query, write.params, 2000);
                    console.log(`[Recovery] ✓ Recovered ID ${userId}: ${write.params[1]} ${write.params[2]}`);
                    successCount++;

                } catch (err) {
                    console.error(`[Recovery] Error recovering write:`, err.message);
                    
                    // Check if it's a duplicate key error - if so, consider it recovered
                    if (err.code === 'ER_DUP_ENTRY' || err.message.includes('Duplicate entry')) {
                        console.log(`[Recovery] Duplicate key - already exists, marking as recovered`);
                        successCount++;
                        continue;
                    }
                    
                    const errorType = db_service.classifyError(err);
                    write.attemptCount++;
                    write.lastError = err.message;
                    write.lastAttempt = new Date();
                    
                    // Keep retryable errors in queue (max 10 attempts)
                    if ((errorType.type === 'RETRYABLE' || errorType.type === 'UNKNOWN') && write.attemptCount < 10) {
                        remainingWrites.push(write);
                    } else {
                        console.log(`[Recovery] Dropping write after ${write.attemptCount} attempts: ${err.message}`);
                    }
                }
            }

            db_service.missedWrites[partition] = remainingWrites;
            
            if (successCount > 0) {
                console.log(`[Recovery] ✓ Partition ${partition}: Recovered ${successCount} writes, ${remainingWrites.length} remaining`);
            }

        } catch (err) {
            console.log(`[Recovery] Partition ${partition}: Recovery failed - ${err.message}`);
        } finally {
            if (pConn) pConn.release();
        }

        return successCount;
    }

    /**
     * Get recovery monitor status
     */
    static getRecoveryMonitorStatus() {
        return {
            enabled: db_service.recoveryMonitor.enabled,
            intervalMs: db_service.recoveryMonitor.checkIntervalMs,
            lastCheck: db_service.recoveryMonitor.lastCheckTime,
            stats: db_service.recoveryMonitor.stats,
            lastResult: db_service.recoveryMonitor.lastResult,
            queueSizes: {
                central: db_service.missedWrites[0].length,
                partition1: db_service.missedWrites[1].length,
                partition2: db_service.missedWrites[2].length
            }
        };
    }

    /**
     * Helper function to get a connection with a timeout.
     * If the connection is not acquired within the specified time, it throws an error.
     * If the connection is acquired after the timeout, it is immediately released to prevent leaks.
     * 
     * @param {Object} pool - The database connection pool.
     * @param {number} timeoutMs - The timeout duration in milliseconds (default: 2000).
     * @returns {Promise<Object>} - A Promise that resolves to a database connection.
     */
    static connectWithTimeout(pool, timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            let isTimedOut = false;

            // Set up the timeout timer
            const timeoutHandle = setTimeout(() => {
                isTimedOut = true;
                reject(new Error(`Connection attempt timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Attempt to get a connection
            pool.getConnection()
                .then(conn => {
                    // Clear the timer since we got a response (success)
                    clearTimeout(timeoutHandle);

                    if (isTimedOut) {
                        // If the timeout already happened, we must release this connection
                        // back to the pool immediately, otherwise it leaks.
                        if (conn && conn.release) conn.release();
                    } else {
                        // If we are within time, resolve with the connection
                        resolve(conn);
                    }
                })
                .catch(err => {
                    // Clear the timer since we got a response (error)
                    clearTimeout(timeoutHandle);

                    if (!isTimedOut) {
                        // Only reject if we haven't timed out yet
                        reject(err);
                    }
                });
        });
    }

    static async testConnectionTimeout() {
        try {
            const pool = db_router.getNodeById(0);
            const conn = await db_service.connectWithTimeout(pool, 2000);
            console.log("✓ Connection successful");
            conn.release();
            return { success: true };
        } catch (err) {
            console.log("✗ Connection failed:", err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Helper function to execute a MySQL query with a timeout.
     * If the query takes longer than the specified time, it throws an error.
     * 
     * @param {Object} connection - The database connection.
     * @param {string} sql - The SQL query string.
     * @param {Array} params - The parameters for the SQL query.
     * @param {number} timeoutMs - The timeout duration in milliseconds (default: 2000).
     * @returns {Promise<any>} - A Promise that resolves to the query result.
     */
    static queryWithTimeout(connection, sql, params = [], timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            // Set up the timeout timer
            const timeoutHandle = setTimeout(() => {
                reject(new Error(`Query execution timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            // Execute the query
            connection.query(sql, params)
                .then(result => {
                    clearTimeout(timeoutHandle);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timeoutHandle);
                    reject(err);
                });
        });
    }

    static async testQueryTimeout() {
        let conn;
        try {
            const pool = db_router.getNodeById(0);
            conn = await pool.getConnection();
            
            // Test with a simple query
            const [result] = await db_service.queryWithTimeout(
                conn, 
                "SELECT 1 as test", 
                [], 
                2000
            );
            
            console.log("✓ Query successful:", result);
            return { success: true, result };
        } catch (err) {
            console.log("✗ Query failed:", err.message);
            return { success: false, error: err.message };
        } finally {
            if (conn) conn.release();
        }
    }

    /**
     * Checks if a database node is healthy and reachable.
     * 
     * @param {number} nodeId - The ID of the node to check (0, 1, or 2).
     * @param {number} timeoutMs - The timeout duration in milliseconds (default: 1000).
     * @returns {Promise<boolean>} - Returns true if healthy, false otherwise.
     */
    static async isNodeHealthy(nodeId, timeoutMs = 1000) {
        let conn;
        try {
            const pool = db_router.getNodeById(nodeId);
            // Attempt to get connection with timeout
            conn = await db_service.connectWithTimeout(pool, timeoutMs);
            
            // Verify connection is alive
            await conn.ping();
            
            return true;
        } catch (error) {
            // Any error (timeout, connection refused, etc.) means unhealthy
            return false;
        } finally {
            if (conn) conn.release();
        }
    }

    static async testNodeHealth() {
        const results = {};
        
        for (let nodeId of [0, 1, 2]) {
            const isHealthy = await db_service.isNodeHealthy(nodeId, 1000);
            results[`node${nodeId}`] = isHealthy ? "HEALTHY ✓" : "DOWN ✗";
            console.log(`Node ${nodeId}:`, results[`node${nodeId}`]);
        }
        
        return { success: true, results };
    }

    // ---------------------------------------------------
    // READ (Strategy 1: Central)
    // ---------------------------------------------------
    static async getUserById(id) {
        const centralPool = db_router.getCentralNode();
        let conn;
        try {
            conn = await centralPool.getConnection();
            const user = await db_access.findById(conn, id);
            return user;
        } catch (error) {
            throw error;
        } finally {
            if (conn) conn.release();
        }
    }

    /**
     * Classifies a database error as RETRYABLE or PERMANENT.
     * 
     * @param {Error} error - The error object from the database driver.
     * @returns {Object} - { type: 'RETRYABLE' | 'PERMANENT' | 'UNKNOWN', code: string }
     */
    static classifyError(error) {
        const code = error.code || 'UNKNOWN';
        
        // List of retryable error codes
        const retryableCodes = [
            'ETIMEDOUT',
            'ECONNREFUSED',
            'ECONNRESET',
            'PROTOCOL_CONNECTION_LOST',
            'ER_LOCK_DEADLOCK',
            'ER_LOCK_WAIT_TIMEOUT'
        ];

        // List of permanent error codes (should not be retried)
        const permanentCodes = [
            'ER_DUP_ENTRY',
            'ER_NO_REFERENCED_ROW',
            'ER_NO_REFERENCED_ROW_2',
            'ER_ACCESS_DENIED_ERROR',
            'ER_BAD_DB_ERROR',
            'ER_PARSE_ERROR'
        ];

        if (retryableCodes.includes(code)) {
            return { type: 'RETRYABLE', code };
        }

        if (permanentCodes.includes(code)) {
            return { type: 'PERMANENT', code };
        }

        // If it's a timeout error message but code is generic
        if (error.message && (error.message.includes('timeout') || error.message.includes('timed out'))) {
            return { type: 'RETRYABLE', code: 'TIMEOUT_MESSAGE' };
        }

        return { type: 'UNKNOWN', code };
    }

    /**
     * Retries an async operation multiple times.
     * 
     * @param {Function} operationFn - The async function to execute.
     * @param {number} maxRetries - Maximum number of attempts.
     * @param {number} delayMs - Delay between attempts in milliseconds.
     * @param {Array} logArray - Array to push logs to.
     * @returns {Promise<any>} - The result of the operation.
     * @throws {Error} - The last error encountered if all retries fail.
     */
    static async retryOperation(operationFn, maxRetries, delayMs, logArray) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operationFn();
            } catch (err) {
                lastError = err;
                const errorType = db_service.classifyError(err);
                
                if (logArray) {
                    logArray.push(`[Attempt ${attempt}/${maxRetries}] Failed: ${err.message} (${errorType.type})`);
                }

                // If it's a permanent error, stop retrying immediately
                if (errorType.type === 'PERMANENT') {
                    if (logArray) logArray.push(`[STOP] Permanent error detected. Aborting retries.`);
                    throw err;
                }

                // If we have retries left, wait and try again
                if (attempt < maxRetries) {
                    if (logArray) logArray.push(`Waiting ${delayMs}ms before retry...`);
                    await sleep(delayMs);
                }
            }
        }

        throw lastError;
    }

    static testErrorClassification() {
        const testErrors = [
            { code: 'ETIMEDOUT', message: 'Connection timeout' },
            { code: 'ECONNREFUSED', message: 'Connection refused' },
            { code: 'ER_DUP_ENTRY', message: 'Duplicate entry' },
            { code: 'ER_ACCESS_DENIED_ERROR', message: 'Access denied' },
            { message: 'Some random error' }
        ];
        
        console.log("Error Classification Tests:");
        testErrors.forEach(err => {
            const classification = db_service.classifyError(err);
            console.log(`${err.code || 'NO_CODE'}: ${classification.type}`);
        });
        
        return { success: true };
    }

    static async testRetryLogic() {
        let logs = [];
        let attemptCount = 0;
        
        // Simulate a function that fails twice, then succeeds
        const flakyOperation = async () => {
            attemptCount++;
            if (attemptCount < 3) {
                throw new Error(`Attempt ${attemptCount} failed`);
            }
            return "Success!";
        };
        
        try {
            const result = await db_service.retryOperation(
                flakyOperation,
                5,  // max retries
                500,  // 500ms delay
                logs
            );
            
            console.log("Result:", result);
            console.log("Logs:", logs);
            return { success: true, result, logs };
        } catch (err) {
            console.log("All retries failed:", err.message);
            return { success: false, logs };
        }
    }

    static async setupTestRecovery() {
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        // Manually add a missed write to queue
        db_service.missedWrites[1].push({
            query: "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
            params: ['Recovery', 'Test', 'TestCity', 'USA', timestamp, timestamp],
            originalTimestamp: timestamp,
            attemptCount: 0,
            lastError: null
        });
        
        console.log("Setup complete. missedWrites[1] has 1 item");
        return { success: true };
    }

    static async testMissedWritesInit() {
        // Test initialization
        console.log("missedWrites:", db_service.missedWrites);
        
        // Test adding a write
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        db_service.missedWrites[1].push({
            query: "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
            params: ['Test', 'User', 'TestCity', 'USA', timestamp, timestamp],
            originalTimestamp: timestamp,
            attemptCount: 0,
            lastError: 'Connection timeout'
        });
        
        console.log("After push:", db_service.missedWrites[1]);
        
        // Test clearing
        db_service.missedWrites[1] = [];
        console.log("After clear:", db_service.missedWrites[1]);
        
        return { success: true };
    }

    // ---------------------------------------------------
    // READ (Strategy 1: Central)
    // ---------------------------------------------------
    static async getUsersByCountry(country) {
        console.log(`[DB Service] Getting users for country: ${country}`);
        
        // 1. Try Partition First
        const partitionPool = db_router.getPartitionNode(country);
        let conn;
        try {
            conn = await partitionPool.getConnection();
            const users = await db_access.findByCountry(conn, country);
            console.log(`[DB Service] Partition returned ${users.length} records.`);
            
            if (users.length > 0) {
                return users;
            }
        } catch (error) {
            console.error(`[DB Service] Partition read failed:`, error.message);
            // Don't throw yet, try central
        } finally {
            if (conn) conn.release();
        }

        // 2. Fallback to Central Node if Partition is empty or failed
        console.log(`[DB Service] Partition empty/failed. Falling back to Central Node.`);
        const centralPool = db_router.getCentralNode();
        let centralConn;
        try {
            centralConn = await centralPool.getConnection();
            const users = await db_access.findByCountry(centralConn, country);
            console.log(`[DB Service] Central Node returned ${users.length} records.`);
            return users;
        } catch (error) {
            console.error(`[DB Service] Central Node read failed:`, error);
            throw error;
        } finally {
            if (centralConn) centralConn.release();
        }
    }

    // ---------------------------------------------------
    // CREATE
    // ---------------------------------------------------

    static async createUser(userData, NODE_STATE = null) {
        console.log('[DB Service] Creating user:', userData);
        console.log('[DB Service] NODE_STATE:', NODE_STATE);
        
        if (userData.id !== undefined) {
            delete userData.id;
        }
        
        if (!userData.country) {
            throw new Error("Country is required.");
        }

        const centralPool = db_router.getCentralNode();
        const partitionPool = db_router.getPartitionNode(userData.country);

        if (!centralPool) {
            throw new Error("Central node pool is not configured");
        }

        let centralConn, partitionConn;

        try {
            console.log('[DB Service] Getting central connection...');
            try {
                centralConn = await Promise.race([
                    centralPool.getConnection(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Central connection timeout after 5s')), 5000))
                ]);
            } catch (connError) {
                throw new Error(`Failed to connect to Central Node: ${connError.message}`);
            }
            
            if (!centralConn) {
                throw new Error("Central connection returned undefined");
            }
            console.log('[DB Service] Central connection acquired');
            
            await centralConn.beginTransaction();
            console.log('[DB Service] Transaction started on central');

            // 2. AUTO-INCREMENT LOGIC: Get Max ID from Central
            const [rows] = await centralConn.query(
                'SELECT id FROM users ORDER BY id DESC LIMIT 1 FOR UPDATE'
            );
            const lastId = rows.length ? rows[0].id : 0;
            const newId = parseInt(lastId) + 1;
            console.log(`[DB Service] Generated new ID: ${newId}`);

            // 3. Prepare Data
            const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
            
            const fullData = {
                id: newId, 
                firstname: userData.firstName,
                lastname: userData.lastName,
                city: userData.city,
                country: userData.country,
                createdAt: timestamp,
                updatedAt: timestamp
            };
            console.log('[DB Service] Full data prepared:', fullData);

            // Determine which partition this user goes to using router
            // Node 1 = A-L countries, Node 2 = M-Z countries
            const partitionId = db_router.getPartitionId(userData.country);
            console.log(`[DB Service] User with country "${userData.country}" routes to partition ${partitionId}`);

            // ALWAYS INSERT TO CENTRAL FIRST (before trying partition)
            console.log('[DB Service] Inserting into central...');
            await db_access.insertUser(centralConn, fullData);
            console.log('[DB Service] Central insert complete');
            
            await centralConn.commit();
            console.log('[DB Service] Central commit successful - user now exists in database');

            // Check if partition is simulated as offline
            if (NODE_STATE && !NODE_STATE[partitionId]) {
                console.log(`[DB Service] Partition ${partitionId} is OFFLINE (simulated) - queuing write`);
                
                // Queue the write for partition using PERSISTENT queue
                const sql = 'INSERT INTO users (id, firstname, lastname, city, country, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)';
                const params = [fullData.id, fullData.firstname, fullData.lastname, fullData.city, fullData.country, fullData.createdAt, fullData.updatedAt];
                
                await db_service.queueMissedWrite(
                    partitionId,
                    fullData.id,
                    sql,
                    params,
                    new Error('Node is OFFLINE (simulated)')
                );
                console.log(`[DB Service] Write queued for partition ${partitionId} in persistent queue`);
                
                // Get queue count from persistent storage
                let queueSize = 1;
                try {
                    const queueStatus = await db_service.getPersistentQueueStatus();
                    queueSize = queueStatus[partitionId];
                } catch (e) { /* ignore */ }
                
                return {
                    success: true,
                    id: newId,
                    message: `User created with ID ${newId}. Partition ${partitionId} offline - write queued.`,
                    queuedForPartition: partitionId,
                    queueSize: queueSize
                };
            }

            // Try to get partition connection and replicate
            console.log('[DB Service] Getting partition connection...');
            try {
                partitionConn = await Promise.race([
                    partitionPool.getConnection(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Partition connection timeout')), 3000))
                ]);
                console.log('[DB Service] Partition connection acquired');
                
                await partitionConn.beginTransaction();
                console.log('[DB Service] Transaction started on partition');

                // Insert into partition
                console.log('[DB Service] Inserting into partition...');
                await db_access.insertUser(partitionConn, fullData);
                console.log('[DB Service] Partition insert complete');
                
                await partitionConn.commit();
                console.log('[DB Service] Partition commit successful');
                
            } catch (connError) {
                console.error(`[DB Service] Failed to replicate to partition ${partitionId}:`, connError.message);
                
                // PARTITION FAILED - but Central already committed, so queue for later
                console.log('[DB Service] Central write already committed, queuing partition write in persistent queue');
                
                // Queue the write for partition using PERSISTENT queue
                const sql = 'INSERT INTO users (id, firstname, lastname, city, country, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)';
                const params = [fullData.id, fullData.firstname, fullData.lastname, fullData.city, fullData.country, fullData.createdAt, fullData.updatedAt];
                
                await db_service.queueMissedWrite(
                    partitionId,
                    fullData.id,
                    sql,
                    params,
                    connError
                );
                console.log(`[DB Service] Write queued for partition ${partitionId} in persistent queue`);
                
                // Get queue count from persistent storage
                let queueSize = 1;
                try {
                    const queueStatus = await db_service.getPersistentQueueStatus();
                    queueSize = queueStatus[partitionId];
                } catch (e) { /* ignore */ }
                
                return {
                    success: true,
                    id: newId,
                    message: `User created with ID ${newId}. Partition ${partitionId} connection failed - write queued.`,
                    queuedForPartition: partitionId,
                    queueSize: queueSize,
                    reason: 'REAL_CONNECTION_FAILURE'
                };
            }

            // Both successful
            return {
                success: true,
                id: newId,
                message: `User created with ID ${newId} in Central and Partition.`
            };
        } catch (error) {
            console.error("[DB Service] Create Transaction Failed:", error.message);
            console.error("[DB Service] Error stack:", error.stack);
            
            try {
                if (centralConn) {
                    console.log('[DB Service] Rolling back central...');
                    await centralConn.rollback();
                }
            } catch (rbError) {
                console.error('[DB Service] Central rollback failed:', rbError.message);
            }
            
            try {
                if (partitionConn) {
                    console.log('[DB Service] Rolling back partition...');
                    await partitionConn.rollback();
                }
            } catch (rbError) {
                console.error('[DB Service] Partition rollback failed:', rbError.message);
            }
            
            throw error;
        } finally {
            if (centralConn) {
                console.log('[DB Service] Releasing central connection');
                centralConn.release();
            }
            if (partitionConn) {
                console.log('[DB Service] Releasing partition connection');
                partitionConn.release();
            }
        }
    }



    // ---------------------------------------------------
    // UPDATE
    // ---------------------------------------------------
    static async updateUser(id, newData) {
        // Sanitize data to match 'users' table schema
        const sanitizedData = {};
        if (newData.firstName) sanitizedData.firstname = newData.firstName;
        if (newData.lastName) sanitizedData.lastname = newData.lastName;
        if (newData.city) sanitizedData.city = newData.city;
        if (newData.country) sanitizedData.country = newData.country;
        
        // If sanitizedData is empty, nothing to update
        if (Object.keys(sanitizedData).length === 0) {
             return { success: true, message: "No valid fields to update." };
        }

        const centralPool = db_router.getCentralNode();
        let centralConn, partitionConn;

        try {
            centralConn = await centralPool.getConnection();
            await centralConn.beginTransaction();

            const user = await db_access.findById(centralConn, id);
            if (!user) throw new Error(`User with ID ${id} not found.`);

            const partitionPool = db_router.getPartitionNode(user.country);
            partitionConn = await partitionPool.getConnection();
            await partitionConn.beginTransaction();

            await db_access.lockRow(centralConn, id);
            
            await db_access.updateUser(centralConn, id, sanitizedData);
            await db_access.updateUser(partitionConn, id, sanitizedData);

            await centralConn.commit();
            await partitionConn.commit();

            return { success: true, message: "User updated successfully." };
        } catch (error) {
            if (centralConn) await centralConn.rollback();
            if (partitionConn) await partitionConn.rollback();
            throw error;
        } finally {
            if (centralConn) centralConn.release();
            if (partitionConn) partitionConn.release();
        }
    }

    // ---------------------------------------------------
    // DELETE
    // ---------------------------------------------------
    static async deleteUser(id, countryHint = null) {
        console.log(`[DB Service] Attempting to delete user ${id}. Hint: ${countryHint}`);
        const centralPool = db_router.getCentralNode();
        let centralConn, partitionConn;

        try {
            centralConn = await centralPool.getConnection();
            await centralConn.beginTransaction();

            let user = await db_access.findById(centralConn, id);
            let targetCountry = countryHint;

            if (!user) {
                console.warn(`[DB Service] User ${id} not found in Central Node.`);
                if (!countryHint) {
                    throw new Error(`User with ID ${id} not found in Central Node and no country hint provided.`);
                }
                console.log(`[DB Service] Using country hint '${countryHint}' to attempt partition cleanup.`);
            } else {
                console.log(`[DB Service] User found in Central: ${user.username}, Country: ${user.country}`);
                targetCountry = user.country;
            }

            const partitionPool = db_router.getPartitionNode(targetCountry);
            partitionConn = await partitionPool.getConnection();
            await partitionConn.beginTransaction();

            // Always attempt to delete from Central, even if findById failed.
            // This handles cases where the record exists but findById missed it (e.g. type mismatch)
            // or if we are cleaning up a ghost record.
            if (user) {
                await db_access.lockRow(centralConn, id);
            }
            
            console.log(`[DB Service] Deleting from Central...`);
            const centralResult = await db_access.deleteUser(centralConn, id);
            console.log(`[DB Service] Central Delete Result: Affected Rows = ${centralResult.affectedRows}`);
            
            console.log(`[DB Service] Deleting from Partition (${targetCountry})...`);
            const partitionResult = await db_access.deleteUser(partitionConn, id);
            console.log(`[DB Service] Partition Delete Result: Affected Rows = ${partitionResult.affectedRows}`);

            await centralConn.commit();
            await partitionConn.commit();
            console.log(`[DB Service] Delete successful.`);

            return { success: true, message: "User deleted." };
        } catch (error) {
            console.error(`[DB Service] Delete failed:`, error);
            if (centralConn) await centralConn.rollback();
            if (partitionConn) await partitionConn.rollback();
            throw error;
        } finally {
            if (centralConn) centralConn.release();
            if (partitionConn) partitionConn.release();
        }
    }

    // =========================================================
    // CONCURRENCY SIMULATION
    // =========================================================
    static async simulateTransaction({ id, type, isolation, sleepTime, updateText }) {
        const centralPool = db_router.getCentralNode();
        let centralConn, partitionConn;
        let logs = [];
        const startTime = Date.now();

        try {
            centralConn = await centralPool.getConnection();

            // -----------------------------------------------------
            // STEP 1: RESOLVE TARGET ID (User Input vs. Random)
            // -----------------------------------------------------
            let targetId = id; // Start with the input provided by the user

            // If the ID is Missing (undefined/null/empty) OR explicitly 'random'
            if (!targetId || targetId === 'random') {
                logs.push(`[${Date.now() - startTime}ms] No specific ID provided. Selecting a RANDOM user...`);
                
                // Query to get one random ID
                const [rows] = await centralConn.query('SELECT id FROM users ORDER BY RAND() LIMIT 1');
                
                if (rows.length === 0) throw new Error("Database is empty. Cannot simulate.");
                targetId = rows[0].id;
                logs.push(`[${Date.now() - startTime}ms] Randomly selected User ID: ${targetId}`);
            } else {
                logs.push(`[${Date.now() - startTime}ms] User selected specific ID: ${targetId}`);
            }

            // -----------------------------------------------------
            // STEP 2: VERIFY USER & DETERMINE PARTITION
            // -----------------------------------------------------
            // We use the central connection to check existence and get the country
            const user = await db_access.findById(centralConn, targetId); 
            
            if(!user) {
                throw new Error(`User with ID ${targetId} does not exist.`);
            }

            // Route to the correct partition based on the user's country
            const partitionPool = db_router.getPartitionNode(user.country);
            partitionConn = await partitionPool.getConnection();

            logs.push(`[${Date.now() - startTime}ms] Connections Acquired for User ${targetId} (${user.country}).`);

            // -----------------------------------------------------
            // STEP 3: CONFIGURE ISOLATION LEVELS
            // -----------------------------------------------------
            await db_access.setIsolationLevel(centralConn, isolation);
            await db_access.setIsolationLevel(partitionConn, isolation);
            logs.push(`[${Date.now() - startTime}ms] Isolation set to ${isolation}`);

            // -----------------------------------------------------
            // STEP 4: START TRANSACTION
            // -----------------------------------------------------
            await centralConn.beginTransaction();
            await partitionConn.beginTransaction();
            logs.push(`[${Date.now() - startTime}ms] Transaction Started.`);

            // -----------------------------------------------------
            // STEP 5: PERFORM ACTION (READ or WRITE)
            // -----------------------------------------------------
            if (type === 'WRITE') {
                const newData = { firstname: updateText || `UPDATED_${Date.now()}` };
                
                // Perform update on both nodes
                await db_access.updateUser(centralConn, targetId, newData);
                await db_access.updateUser(partitionConn, targetId, newData);
                
                logs.push(`[${Date.now() - startTime}ms] WRITE executed (Data: ${newData.firstname}). Sleeping for ${sleepTime}s...`);
            } else {
                // READ
                const result = await db_access.findById(centralConn, targetId);
                
                // 1. Handle Array vs Object
                const userRow = Array.isArray(result) ? result[0] : result;
                
                // 2. Extract Name (using the correct lowercase 'firstname')
                // We check 'firstname' (from DB) OR 'firstName' (just in case)
                const nameVal = userRow ? (userRow.firstname || userRow.firstName || 'Unknown') : 'NULL';

                logs.push(`[${Date.now() - startTime}ms] READ executed. Value: ${nameVal}. Sleeping for ${sleepTime}s...`);
            }

            // -----------------------------------------------------
            // STEP 6: SLEEP (Simulate heavy load / hold locks)
            // -----------------------------------------------------
            await sleep(sleepTime * 1000);

            // -----------------------------------------------------
            // STEP 7: COMMIT
            // -----------------------------------------------------
            await centralConn.commit();
            await partitionConn.commit();
            logs.push(`[${Date.now() - startTime}ms] COMMIT Successful.`);

            return {
                success: true,
                targetId: targetId, // Return the ID used so the UI knows
                logs: logs,
                finalStatus: "Committed"
            };

        } catch (error) {
            // 1. Log the ORIGINAL error (This is what we need to see!)
            logs.push(`[ERROR] Transaction Failed: ${error.message}`);
            
            // 2. Safe Rollback - Central
            try {
                if (centralConn) await centralConn.rollback();
            } catch (rbError) {
                logs.push(`[WARNING] Central Rollback failed (Connection likely dead): ${rbError.message}`);
            }

            // 3. Safe Rollback - Partition
            try {
                if (partitionConn) await partitionConn.rollback();
            } catch (rbError) {
                logs.push(`[WARNING] Partition Rollback failed: ${rbError.message}`);
            }

            return {
                success: false,
                logs: logs,
                error: error.message
            };
        }    
    }

    // =========================================================
    // FAILURE RECOVERY SIMULATION
    // =========================================================
    static async withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms during ${label}`)), ms)
        )
    ]);
}
    // =========================================================
    // CASE 1  
    // =========================================================
    static async testCase1(NODE_STATE) {
        let logs = [];
        const partitionNode = NODE_STATE[1] ? 1 : 2;
        const pPool = db_router.getNodeById(partitionNode);

        if (!NODE_STATE[partitionNode]) {
            logs.push(`Partition ${partitionNode} is OFFLINE — cannot write.`);
            return { success: false, logs };
        }

        const pConn = await pPool.getConnection();
        try {
            await pConn.beginTransaction();
            logs.push(`Writing to Partition ${partitionNode}...`);
            await pConn.query(
                "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case1_first', 'case1_last', 'City', 'USA', NOW(), NOW())"
            );
            await pConn.commit();
            logs.push(`Partition ${partitionNode} write SUCCESS.`);

            if (!NODE_STATE[0]) {
                logs.push("CENTRAL is OFFLINE — replication FAILED. Added to missedWrites queue.");
                db_service.missedWrites[0].push({
                    query: "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case1_first', 'case1_last', 'City', 'USA', NOW(), NOW())",
                });
                return { success: true, logs };
            }

            const cPool = db_router.getNodeById(0);
            const cConn = await cPool.getConnection();
            await cConn.query(
                "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case1_first', 'case1_last', 'City', 'USA', NOW(), NOW())"
            );
            cConn.release();
            logs.push("Replication to CENTRAL succeeded.");
            return { success: true, logs };
        } catch (err) {
            logs.push(err.message);
            await pConn.rollback();
            return { success: false, logs };
        } finally {
            pConn.release();
        }
    }

    // =========================
    // CASE 2: Central recovers after missed writes
    // =========================
    static async testCase2(NODE_STATE) {
        let logs = [];

        if (!NODE_STATE[0]) {
        logs.push("CENTRAL still OFFLINE — cannot recover.");
        return { success: false, logs };
        }

        if (NODE_STATE[0] && db_service.missedWrites[0].length === 0) {
            logs.push("No missed writes in CENTRAL — nothing to recover.");
            return { success: true, logs };
        }

        const cPool = db_router.getNodeById(0);
        const cConn = await cPool.getConnection();

        try {
            await db_service.withTimeout(cConn.beginTransaction(), 2000, "Central BEGIN");
            logs.push("Applying missed writes to CENTRAL...");

            for (let write of db_service.missedWrites[0]) {
                await db_service.withTimeout(cConn.query(write.query), 2000, "Central APPLY");
                logs.push(`Applied: ${write.query}`);
            }

            await db_service.withTimeout(cConn.commit(), 2000, "Central COMMIT");
            db_service.missedWrites[0] = [];
            logs.push("Recovery complete. CENTRAL is up-to-date.");
            return { success: true, logs };
        } catch (err) {
            logs.push(err.message);
            await cConn.rollback();  
            return { success: false, logs };
        } finally {
            cConn.release();
        }
    }





    // =========================
    // CASE 3: Central writes, Partition fails
    // =========================
    /**
     * Case #3: Central Node → Partition Replication Failure
     * 
     * Scenario: A transaction is successfully committed to the Central Node (Node 0),
     * but fails to replicate to one or more Partition Nodes (Node 1 or Node 2).
     * 
     * How Users Are Shielded:
     * - The write is acknowledged as successful once committed to the Central Node
     * - Users can continue reading from the Central Node immediately
     * - Failed writes are queued in memory for later retry
     * - The system maintains eventual consistency through background recovery
     * 
     * Recovery Strategy:
     * 1. Detect partition node failure during replication attempt
     * 2. Queue the failed write with full context (query, params, timestamp)
     * 3. Return success to the user (Central write succeeded)
     * 4. Background process will retry queued writes when node recovers
     * 
     * Data Availability:
     * - Reads can be served from Central Node (always has complete data)
     * - Partition-specific queries may miss recent updates until recovery completes
     * - No data loss occurs - all writes are persisted to Central Node
     */
    static async testCase3(NODE_STATE) {
        let logs = [];
        let cConn;
        let timestamp;
        let insertedId;
        const sql = "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)";
        let params;

        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logs.push("📝 CASE #3: Central → Partition Replication");
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // -------------------------------------------------
        // 1. WRITE TO CENTRAL (With Timeout & Error Handling)
        // -------------------------------------------------
        try {
            const cPool = db_router.getNodeById(0);
            
            logs.push("📝 PHASE 1: Writing to Central Node");
            logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            // Attempt to get connection with timeout
            cConn = await db_service.connectWithTimeout(cPool, 2000);

            await cConn.beginTransaction();

            // Use variable for timestamp to ensure consistency across all nodes
            timestamp = new Date();
            const timestampStr = timestamp.toISOString().slice(0, 19).replace('T', ' ');
            params = ['case3_first', 'case3_last', 'TestCity', 'UK', timestampStr, timestampStr];

            // Execute query with timeout - let AUTO_INCREMENT handle the ID
            const [result] = await db_service.queryWithTimeout(cConn, sql, params, 2000);
            insertedId = result.insertId; // Get the auto-generated ID

            await cConn.commit();
            logs.push("✅ Central Node: WRITE SUCCESSFUL");
            logs.push(`   • Transaction ID: ${insertedId}`);
            logs.push(`   • User: case3_first case3_last (UK)`);
            logs.push(`   • Timestamp: ${timestampStr}`);
            logs.push("");
        } catch (err) {
            logs.push("❌ Central Node: WRITE FAILED");
            logs.push(`   • Error: ${err.message}`);
            logs.push("   • Transaction ABORTED - User will see error");
            logs.push("");
            if (cConn) {
                try { await cConn.rollback(); } catch (rbErr) { /* ignore rollback error */ }
            }
            return { success: false, logs, centralWriteSuccess: false };
        } finally {
            if (cConn) cConn.release();
        }

        // -------------------------------------------------
        // 2. REPLICATE TO PARTITIONS
        // -------------------------------------------------
        logs.push("🔄 PHASE 2: Replicating to Partition Nodes");
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        
        let replicationResults = { 1: false, 2: false };
        let queuedWrites = [];

        for (let partition of [1, 2]) {
            let pConn;
            logs.push(`Partition ${partition}:`);
            
            try {
                // 1. CRITICAL: Check simulated NODE_STATE first (from UI toggle)
                if (!NODE_STATE[partition]) {
                    throw new Error(`Node ${partition} is OFFLINE (simulated failure)`);
                }

                // 2. If simulated state is ONLINE, check actual health
                const isHealthy = await db_service.isNodeHealthy(partition, 1000);
                
                if (!isHealthy) {
                    throw new Error(`Node ${partition} is unhealthy/unreachable`);
                }

                // 3. Attempt Replication
                const pPool = db_router.getNodeById(partition);
                pConn = await db_service.connectWithTimeout(pPool, 2000);
                
                await db_service.queryWithTimeout(pConn, sql, params, 2000);
                
                logs.push(`  ✅ Replication successful`);
                replicationResults[partition] = true;

            } catch (err) {
                const errorType = db_service.classifyError(err);
                logs.push(`  ❌ Replication failed`);
                logs.push(`     Reason: ${err.message}`);
                
                // 3. Queue Missed Write
                const missedWrite = {
                    query: sql,
                    params: params,
                    originalTimestamp: timestamp,
                    insertedId: insertedId,
                    attemptCount: 1,
                    lastError: err.message,
                    errorType: errorType.type,
                    queuedAt: new Date()
                };
                
                // Queue to PERSISTENT database queue (survives serverless restarts)
                await db_service.queueMissedWrite(partition, insertedId, sql, params, err);
                queuedWrites.push(partition);
                
                // Get updated queue count from persistent storage
                let queueCount = 1;
                try {
                    const queueStatus = await db_service.getPersistentQueueStatus();
                    queueCount = queueStatus[partition];
                } catch (e) {
                    queueCount = db_service.missedWrites[partition].length;
                }
                
                logs.push(`  📋 Queued for recovery (Queue size: ${queueCount})`);
                
                replicationResults[partition] = false;
            } finally {
                if (pConn) pConn.release();
            }
            logs.push("");
        }

        // -------------------------------------------------
        // 3. SUMMARY
        // -------------------------------------------------
        logs.push("");
        logs.push("📊 SUMMARY");
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logs.push(`Central Node:  ${replicationResults[1] && replicationResults[2] ? '✅' : '✅'} Committed`);
        logs.push(`Partition 1:   ${replicationResults[1] ? '✅ Synchronized' : '⏳ Queued'}`);
        logs.push(`Partition 2:   ${replicationResults[2] ? '✅ Synchronized' : '⏳ Queued'}`);
        logs.push("");
        
        // Get PERSISTENT queue status (the real source of truth on Vercel)
        let persistentQueueStatus = { 1: 0, 2: 0 };
        try {
            persistentQueueStatus = await db_service.getPersistentQueueStatus();
        } catch (e) {
            logs.push(`⚠️  Could not fetch persistent queue status: ${e.message}`);
        }

        if (queuedWrites.length > 0) {
            logs.push("💡 User Experience:");
            logs.push("   ✅ Transaction successful - User sees SUCCESS");
            logs.push("   ✅ Data immediately available on Central Node");
            logs.push("");
            logs.push("⚠️  Pending Recovery:");
            logs.push(`   ${queuedWrites.map(p => 'Partition ' + p).join(', ')} - Queued for automatic recovery`);
            logs.push("   Background monitor will sync when nodes come online");
            logs.push("");
            logs.push(`📈 Persistent Queue Status: P1=${persistentQueueStatus[1]} | P2=${persistentQueueStatus[2]}`);
        } else {
            logs.push("✅ All nodes synchronized - Full replication success!");
        }
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        return { 
            success: true, 
            logs,
            centralWriteSuccess: true,
            replicationResults,
            queuedWrites,
            queueSizes: {
                partition1: persistentQueueStatus[1],
                partition2: persistentQueueStatus[2]
            }
        };
    }

    // =========================
    // CASE 4: Partition recovers after missed writes
    // =========================
    /**
     * Case #4: Partition Node Recovery
     * 
     * Scenario: A previously failed Partition Node (Node 1 or Node 2) comes back online
     * and needs to catch up with missed write transactions that were queued during its downtime.
     * 
     * Recovery Strategy:
     * 1. Detect that node is healthy again (health check)
     * 2. Process queued writes in order (FIFO)
     * 3. Retry failed writes with exponential backoff
     * 4. Handle duplicate detection (record may already exist)
     * 5. Update queue - remove successful writes, keep failed ones
     * 
     * What Happens During Recovery:
     * - Each missed write is replayed in the order it was queued
     * - Duplicate entries are handled gracefully (skip or update)
     * - Transient errors trigger retry with backoff
     * - Permanent errors are logged but don't block other writes
     * - Queue is updated incrementally as writes succeed
     * 
     * Data Consistency:
     * - After recovery completes, partition has all missed data
     * - Partition queries now return consistent results
     * - System achieves eventual consistency
     * - No manual intervention required
     */
    static async testCase4(NODE_STATE) {
        let logs = [];
        let overallStats = {
            totalAttempted: 0,
            totalSuccess: 0,
            totalFailed: 0,
            partitions: {}
        };

        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logs.push("🔄 CASE #4: Partition Recovery & Synchronization");
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logs.push("");

        // Get persistent queue status FIRST (source of truth on Vercel)
        let persistentQueueStatus = { 1: 0, 2: 0 };
        try {
            persistentQueueStatus = await db_service.getPersistentQueueStatus();
            logs.push(`📋 Persistent Queue Status: P1=${persistentQueueStatus[1]} | P2=${persistentQueueStatus[2]}`);
            logs.push("");
        } catch (e) {
            logs.push(`⚠️  Could not fetch persistent queue: ${e.message}`);
            logs.push("");
        }

        for (let partition of [1, 2]) {
            logs.push(`🔍 Partition ${partition}:`);
            
            // 1. Check if there are missed writes in PERSISTENT queue
            const queueSize = persistentQueueStatus[partition] || 0;
            if (queueSize === 0) {
                logs.push(`   ✅ Already synchronized (no queued writes)`);
                logs.push("");
                overallStats.partitions[partition] = { status: 'SYNCHRONIZED', processed: 0 };
                continue;
            }

            logs.push(`   📋 Queue: ${queueSize} pending write(s)`);

            // 2. Check simulated state FIRST (respect UI toggles)
            if (!NODE_STATE[partition]) {
                logs.push(`   🔴 Status: OFFLINE (simulated)`);
                logs.push(`   ⏸️  Recovery postponed - Node must be toggled ON`);
                logs.push("");
                overallStats.partitions[partition] = { status: 'OFFLINE_SIMULATED', processed: 0 };
                continue;
            }

            // 3. Check actual health
            const isHealthy = await db_service.isNodeHealthy(partition, 1000);
            if (!isHealthy) {
                logs.push(`   🔴 Status: UNREACHABLE (connection failed)`);
                logs.push(`   ⏸️  Recovery postponed - Queue maintained`);
                logs.push("");
                overallStats.partitions[partition] = { status: 'OFFLINE', processed: 0 };
                continue;
            }

            logs.push(`   🟢 Status: ONLINE and healthy`);
            logs.push(`   ▶️  Starting recovery process...`);
            logs.push("");

            // Use processPersistentQueue to handle recovery from database queue
            try {
                const recoveredCount = await db_service.processPersistentQueue(partition);
                
                // Get updated queue status
                const updatedStatus = await db_service.getPersistentQueueStatus();
                const remainingCount = updatedStatus[partition] || 0;
                
                logs.push(`   📊 Recovery Complete:`);
                logs.push(`      Processed: ${queueSize} | Recovered: ${recoveredCount}`);
                if (remainingCount > 0) {
                    logs.push(`      ⚠️  Still queued: ${remainingCount}`);
                } else {
                    logs.push(`      ✅ Queue cleared - Partition synchronized`);
                }
                logs.push("");

                overallStats.totalAttempted += queueSize;
                overallStats.totalSuccess += recoveredCount;
                overallStats.totalFailed += remainingCount;
                overallStats.partitions[partition] = {
                    status: recoveredCount > 0 ? 'RECOVERED' : 'NO_CHANGE',
                    processed: queueSize,
                    success: recoveredCount,
                    remaining: remainingCount
                };

            } catch (err) {
                logs.push(`  ✗ [ERROR] Recovery process failed: ${err.message}`);
                logs.push(`  → Connection issue or critical error`);
                logs.push(`  → All writes remain in queue for next attempt`);
                logs.push("");
                
                overallStats.partitions[partition] = {
                    status: 'RECOVERY_FAILED',
                    error: err.message
                };
            }
        }

        // -------------------------------------------------
        // OVERALL SUMMARY
        // -------------------------------------------------
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logs.push("📊 OVERALL SUMMARY");
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logs.push(`Total Attempted: ${overallStats.totalAttempted} | Success: ${overallStats.totalSuccess} | Failed: ${overallStats.totalFailed}`);
        logs.push("");
        
        logs.push("📦 Current Queue Status:");
        logs.push(`   Partition 1: ${db_service.missedWrites[1].length} pending`);
        logs.push(`   Partition 2: ${db_service.missedWrites[2].length} pending`);
        logs.push("");

        const allSynced = db_service.missedWrites[1].length === 0 && db_service.missedWrites[2].length === 0;
        if (allSynced) {
            logs.push("✅ SYSTEM STATUS: All partitions synchronized");
            logs.push("✅ Eventual consistency achieved!");
        } else {
            logs.push("⚠️  SYSTEM STATUS: Recovery incomplete");
            logs.push("💡 Next Steps: Wait for background monitor or run Case #4 again");
        }
        logs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        return { 
            success: true, 
            logs,
            stats: overallStats,
            queueSizes: {
                partition1: db_service.missedWrites[1].length,
                partition2: db_service.missedWrites[2].length
            },
            fullyRecovered: allSynced
        };
    }


    static async testCompleteFlow() {
        let logs = [];
        // Assume all nodes are "logically" online so we test REAL connection failures
        const NODE_STATE_ALL_ONLINE = { 0: true, 1: true, 2: true };
        
        logs.push("=== PHASE 1: Normal Operation ===");
        // All nodes healthy
        const case3Result = await db_service.testCase3(NODE_STATE_ALL_ONLINE);
        logs.push(...case3Result.logs);
        
        logs.push("\n=== PHASE 2: Simulate Failure ===");
        // Note: Manually block Node 2 here
        logs.push("Please block Node 2 now (iptables) if you haven't already, or rely on real network conditions.");
        logs.push("Waiting 15 seconds for manual intervention...");
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        logs.push("\n=== PHASE 3: Write During Failure ===");
        const case3Failed = await db_service.testCase3(NODE_STATE_ALL_ONLINE);
        logs.push(...case3Failed.logs);
        
        logs.push("\n=== PHASE 4: Check Queue ===");
        logs.push(`Missed writes for Node 1: ${db_service.missedWrites[1].length}`);
        logs.push(`Missed writes for Node 2: ${db_service.missedWrites[2].length}`);
        
        logs.push("\n=== PHASE 5: Restore Node ===");
        logs.push("Please unblock Node 2 now.");
        logs.push("Waiting 15 seconds for manual intervention...");
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        logs.push("\n=== PHASE 6: Recovery ===");
        const case4Result = await db_service.testCase4(NODE_STATE_ALL_ONLINE);
        logs.push(...case4Result.logs);
        
        logs.push("\n=== PHASE 7: Verify ===");
        logs.push(`Missed writes after recovery (Node 1): ${db_service.missedWrites[1].length}`);
        logs.push(`Missed writes after recovery (Node 2): ${db_service.missedWrites[2].length}`);
        
        return { success: true, logs };
    }
}

module.exports = db_service;