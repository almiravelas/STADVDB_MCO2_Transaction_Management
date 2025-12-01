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
}

module.exports = db_service;