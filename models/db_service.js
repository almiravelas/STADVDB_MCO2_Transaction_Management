const db_router = require('../models/db_router');
const db_access = require('../models/db_access');

// For pausing execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class db_service {

    // Queue for storing failed writes during node downtime
    // Structure: { 0: [], 1: [], 2: [] }
    static missedWrites = {
        0: [],
        1: [],
        2: []
    };

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

    static async createUser(userData) {
        if (userData.id !== undefined) {
            delete userData.id;
        }
        
        if (!userData.country) throw new Error("Country is required.");

        const centralPool = db_router.getCentralNode();
        const partitionPool = db_router.getPartitionNode(userData.country);

        let centralConn, partitionConn;

        try {
            centralConn = await centralPool.getConnection();
            await centralConn.beginTransaction();

            // 2. AUTO-INCREMENT LOGIC: Get Max ID from Central
            const [rows] = await centralConn.query(
                'SELECT id FROM users ORDER BY id DESC LIMIT 1 FOR UPDATE'
            );
            const lastId = rows.length ? rows[0].id : 0;
            const newId = parseInt(lastId) + 1; // Ensure it's an integer

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

            partitionConn = await partitionPool.getConnection();
            await partitionConn.beginTransaction();

            console.log(`[Transaction] Creating User ID: ${newId} in ${userData.country}`);

            // 4. Insert into both nodes
            await db_access.insertUser(centralConn, fullData);
            await db_access.insertUser(partitionConn, fullData);

            await centralConn.commit();
            await partitionConn.commit();

            return {
                success: true,
                id: newId,
                message: `User created with ID ${newId} in Central and Partition.`
            };
        } catch (error) {
            console.error("Create Transaction Failed:", error.message);
            if (centralConn) await centralConn.rollback();
            if (partitionConn) await partitionConn.rollback();
            throw error;
        } finally {
            if (centralConn) centralConn.release();
            if (partitionConn) partitionConn.release();
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
    static async testCase3(NODE_STATE) {
        let logs = [];
        let cConn;
        let timestamp;
        const sql = "INSERT INTO users (firstname, lastname, city, country, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)";
        let params;

        // -------------------------------------------------
        // 1. WRITE TO CENTRAL (With Timeout & Error Handling)
        // -------------------------------------------------
        try {
            const cPool = db_router.getNodeById(0);
            
            // Attempt to get connection with timeout
            cConn = await db_service.connectWithTimeout(cPool, 2000);

            await cConn.beginTransaction();
            logs.push("Writing to CENTRAL...");

            // Use variable for timestamp to ensure consistency
            timestamp = new Date();
            params = ['case3_first', 'case3_last', 'City', 'UK', timestamp, timestamp];

            // Execute query with timeout
            await db_service.queryWithTimeout(cConn, sql, params, 2000);

            await cConn.commit();
            logs.push("CENTRAL write SUCCESS.");
            logs.push(`Timestamp used: ${timestamp.toISOString()}`);
        } catch (err) {
            logs.push(`[ERROR] Central Write Failed: ${err.message}`);
            if (cConn) {
                try { await cConn.rollback(); } catch (rbErr) { /* ignore rollback error */ }
            }
            return { success: false, logs };
        } finally {
            if (cConn) cConn.release();
        }

        // -------------------------------------------------
        // 2. REPLICATE TO PARTITIONS
        // -------------------------------------------------
        for (let partition of [1, 2]) {
            let pConn;
            try {
                // 1. Check Health First
                const isHealthy = await db_service.isNodeHealthy(partition, 1000);
                
                if (!isHealthy) {
                    throw new Error(`Node ${partition} is unhealthy/unreachable`);
                }

                // 2. Attempt Replication
                const pPool = db_router.getNodeById(partition);
                pConn = await db_service.connectWithTimeout(pPool, 2000);
                
                await db_service.queryWithTimeout(pConn, sql, params, 2000);
                
                logs.push(`Replication to Partition ${partition} SUCCESS.`);

            } catch (err) {
                logs.push(`[WARNING] Replication to Partition ${partition} FAILED: ${err.message}`);
                
                // 3. Queue Missed Write
                db_service.missedWrites[partition].push({
                    query: sql,
                    params: params,
                    originalTimestamp: timestamp,
                    attemptCount: 1,
                    lastError: err.message
                });
                logs.push(`Write queued for Partition ${partition}.`);
            } finally {
                if (pConn) pConn.release();
            }
        }

        return { success: true, logs };
    }

    // =========================
    // CASE 4: Partition recovers after missed writes
    // =========================
    static async testCase4(NODE_STATE) {
        let logs = [];

        for (let partition of [1, 2]) {
            // 1. Check if there are missed writes
            if (db_service.missedWrites[partition].length === 0) {
                logs.push(`No missed writes for Partition ${partition}.`);
                continue;
            }

            // 2. Check Health
            const isHealthy = await db_service.isNodeHealthy(partition, 1000);
            if (!isHealthy) {
                logs.push(`Partition ${partition} is still OFFLINE/UNREACHABLE. Skipping recovery.`);
                continue;
            }

            logs.push(`Partition ${partition} is ONLINE. Attempting recovery of ${db_service.missedWrites[partition].length} writes...`);

            const pPool = db_router.getNodeById(partition);
            let pConn;

            try {
                pConn = await db_service.connectWithTimeout(pPool, 2000);
                
                // Process queue
                // We iterate backwards or use a new array to handle removals safely
                // But here we'll just process and clear successful ones
                const remainingWrites = [];
                let successCount = 0;

                for (let write of db_service.missedWrites[partition]) {
                    try {
                        await db_service.retryOperation(async () => {
                            // Apply the write
                            await db_service.queryWithTimeout(pConn, write.query, write.params, 2000);
                            logs.push(`[APPLIED] Recovered write for '${write.params[0]}' on Partition ${partition}.`);
                        }, 3, 500, logs); // 3 retries, 500ms delay

                        successCount++;
                    } catch (err) {
                        logs.push(`[FAILED] Could not recover write for '${write.params[0]}': ${err.message}`);
                        // Keep in queue
                        write.attemptCount++;
                        write.lastError = err.message;
                        remainingWrites.push(write);
                    }
                }

                // Update queue with only failed writes
                db_service.missedWrites[partition] = remainingWrites;
                logs.push(`Recovery finished for Partition ${partition}. Success: ${successCount}, Remaining: ${remainingWrites.length}`);

            } catch (err) {
                logs.push(`[ERROR] Recovery process failed for Partition ${partition}: ${err.message}`);
            } finally {
                if (pConn) pConn.release();
            }
        }

        return { success: true, logs };
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