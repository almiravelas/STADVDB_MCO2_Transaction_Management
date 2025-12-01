const db_router = require('../models/db_router');
const db_access = require('../models/db_access');

// For pausing execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class db_service {

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

    // ---------------------------------------------------
    // READ (Strategy 2: Partition)
    // ---------------------------------------------------
    static async getUsersByCountry(country) {
        const partitionPool = db_router.getPartitionNode(country);
        let conn;
        try {
            conn = await partitionPool.getConnection();
            const users = await db_access.findByCountry(conn, country);
            return users;
        } catch (error) {
            throw error;
        } finally {
            if (conn) conn.release();
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
                'SELECT id FROM Users ORDER BY id DESC LIMIT 1 FOR UPDATE'
            );
            const lastId = rows.length ? rows[0].id : 0;
            const newId = parseInt(lastId) + 1; // Ensure it's an integer

            // 3. Prepare Data
            const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
            
            const fullData = {
                id: newId, // <--- Explicitly setting the generated ID
                username: userData.username || `user_${newId}`,
                firstName: userData.firstName,
                lastName: userData.lastName,
                city: userData.city,
                country: userData.country,
                gender: userData.gender || 'Unknown',
                address1: 'N/A',
                address2: 'N/A',
                zipCode: '0000',
                phoneNumber: '000-000-0000',
                dateOfBirth: '2000-01-01',
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
            
            await db_access.updateUser(centralConn, id, newData);
            await db_access.updateUser(partitionConn, id, newData);

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
    static async deleteUser(id) {
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
            
            await db_access.deleteUser(centralConn, id);
            await db_access.deleteUser(partitionConn, id);

            await centralConn.commit();
            await partitionConn.commit();

            return { success: true, message: "User deleted." };
        } catch (error) {
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
                const [rows] = await centralConn.query('SELECT id FROM Users ORDER BY RAND() LIMIT 1');
                
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
                const newData = { firstName: updateText || `UPDATED_${Date.now()}` };
                
                // Perform update on both nodes
                await db_access.updateUser(centralConn, targetId, newData);
                await db_access.updateUser(partitionConn, targetId, newData);
                
                logs.push(`[${Date.now() - startTime}ms] WRITE executed (Data: ${newData.firstName}). Sleeping for ${sleepTime}s...`);
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
                "INSERT INTO Users (username, firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case1_user', 'case1_first', 'case1_last', 'City', 'USA', NOW(), NOW())"
            );
            await pConn.commit();
            logs.push(`Partition ${partitionNode} write SUCCESS.`);

            if (!NODE_STATE[0]) {
                logs.push("CENTRAL is OFFLINE — replication FAILED. Added to missedWrites queue.");
                db_service.missedWrites[0].push({
                    query: "INSERT INTO Users (username, firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case1_user', 'case1_first', 'case1_last', 'City', 'USA', NOW(), NOW())",
                });
                return { success: true, logs };
            }

            const cPool = db_router.getNodeById(0);
            const cConn = await cPool.getConnection();
            await cConn.query(
                "INSERT INTO Users (username, firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case1_user', 'case1_first', 'case1_last', 'City', 'USA', NOW(), NOW())"
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
    // CASE 3: Central → Partition replication fails
    // =========================
    static async testCase3(NODE_STATE) {
        let logs = [];
        if (!NODE_STATE[0]) {
            logs.push("CENTRAL is OFFLINE — cannot write.");
            return { success: false, logs };
        }

        const cPool = db_router.getNodeById(0);
        const cConn = await cPool.getConnection();

        try {
            await cConn.beginTransaction();
            logs.push("Writing to CENTRAL...");
            await cConn.query(
                "INSERT INTO Users (username, firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case3_user', 'case3_first', 'case3_last', 'City', 'UK', NOW(), NOW())"
            );
            await cConn.commit();
            logs.push("CENTRAL write SUCCESS.");

            // Attempt replication to all partitions
            for (let partition of [1, 2]) {
                if (!NODE_STATE[partition]) {
                    logs.push(`Partition ${partition} is OFFLINE — replication FAILED.`);
                    db_service.missedWrites[partition].push({
                        query: "INSERT INTO Users (username, firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case3_user', 'case3_first', 'case3_last', 'City', 'UK', NOW(), NOW())",
                    });
                } else {
                    const pPool = db_router.getNodeById(partition);
                    const pConn = await pPool.getConnection();
                    await pConn.query(
                        "INSERT INTO Users (username, firstname, lastname, city, country, createdAt, updatedAt) VALUES ('case3_user', 'case3_first', 'case3_last', 'City', 'UK', NOW(), NOW())"
                    );
                    pConn.release();
                    logs.push(`Replication to Partition ${partition} succeeded.`);
                }
            }

            return { success: true, logs };
        } catch (err) {
            logs.push(err.message);
            return { success: false, logs };
        } finally {
            cConn.release();
        }
    }

    // =========================
    // CASE 4: Partition recovers after missed writes
    // =========================
    static async testCase4(NODE_STATE) {
        let logs = [];

        for (let partition of [1, 2]) {
            if (!NODE_STATE[partition]) {
                logs.push(`Partition ${partition} is OFFLINE — cannot recover missed writes.`);
                continue;
            }

            if (db_service.missedWrites[partition].length === 0) {
                logs.push(`No missed writes for Partition ${partition}.`);
                continue;
            }

            const pPool = db_router.getNodeById(partition);
            const pConn = await pPool.getConnection();

            try {
                await db_service.withTimeout(pConn.beginTransaction(), 2000, "Partition BEGIN");
                logs.push(`Recovering missed writes for Partition ${partition}...`);
                for (let write of db_service.missedWrites[partition]) {
                    await pConn.query(write.query);
                    await db_service.withTimeout(pConn.query(write.query), 2000, "Partition APPLY");
                }
                await db_service.withTimeout(pConn.commit(), 2000, "Partition COMMIT");
                db_service.missedWrites[partition] = [];
                logs.push(`Partition ${partition} recovery complete.`);
            } catch (err) {
                logs.push(err.message);
                await pConn.rollback();  
            } finally {
                pConn.release();
            }
        }

        return { success: true, logs };
    }
}

module.exports = db_service;