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
        // 1. Determine Nodes (We assume the user exists for simulation)
        const centralPool = db_router.getCentralNode();
        
        let centralConn, partitionConn;
        let logs = [];
        const startTime = Date.now();

        try {
            // Get user info first (outside the test transaction) to find the partition
            let user = await this.getUserById(id); 
            if(!user) throw new Error(`User ${id} not found for simulation.`);
            const partitionPool = db_router.getPartitionNode(user.country);

            centralConn = await centralPool.getConnection();
            partitionConn = await partitionPool.getConnection();

            logs.push(`[${Date.now() - startTime}ms] Connections Acquired.`);

            // 2. SET ISOLATION LEVEL
            await db_access.setIsolationLevel(centralConn, isolation);
            await db_access.setIsolationLevel(partitionConn, isolation);
            logs.push(`[${Date.now() - startTime}ms] Isolation set to ${isolation}`);

            // 3. START TRANSACTION
            await centralConn.beginTransaction();
            await partitionConn.beginTransaction();
            logs.push(`[${Date.now() - startTime}ms] Transaction Started.`);

            // 4. PERFORM ACTION
            if (type === 'WRITE') {
                const newData = { firstName: updateText || `UPDATED_${Date.now()}` };
                
                // We use standard update logic but we hold the connection open
                await db_access.updateUser(centralConn, id, newData);
                await db_access.updateUser(partitionConn, id, newData);
                
                logs.push(`[${Date.now() - startTime}ms] WRITE executed (Data: ${newData.firstName}). Sleeping for ${sleepTime}s...`);
            } else {
                // READ
                // We read from Central to demonstrate isolation effects
                const rows = await db_access.findById(centralConn, id);
                logs.push(`[${Date.now() - startTime}ms] READ executed. Value: ${rows ? rows.firstName : 'NULL'}. Sleeping for ${sleepTime}s...`);
            }

            // 5. SLEEP (Hold the locks/transaction open)
            await sleep(sleepTime * 1000);

            // 6. COMMIT
            await centralConn.commit();
            await partitionConn.commit();
            logs.push(`[${Date.now() - startTime}ms] COMMIT Successful.`);

            return {
                success: true,
                logs: logs,
                finalStatus: "Committed"
            };

        } catch (error) {
            logs.push(`[${Date.now() - startTime}ms] ERROR: ${error.message}`);
            if (centralConn) await centralConn.rollback();
            if (partitionConn) await partitionConn.rollback();
            return {
                success: false,
                logs: logs,
                error: error.message
            };
        } finally {
            if (centralConn) centralConn.release();
            if (partitionConn) partitionConn.release();
        }
    }

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
                "INSERT INTO Users (username, country) VALUES ('case1_user','USA')"
            );
            await pConn.commit();
            logs.push(`Partition ${partitionNode} write SUCCESS.`);

            if (!NODE_STATE[0]) {
                logs.push("CENTRAL is OFFLINE — replication FAILED. Added to missedWrites queue.");
                db_service.missedWrites[0].push({
                    query: "INSERT INTO Users (username, country) VALUES ('case1_user','USA')",
                });
                return { success: true, logs };
            }

            const cPool = db_router.getNodeById(0);
            const cConn = await cPool.getConnection();
            await cConn.query(
                "INSERT INTO Users (username, country) VALUES ('case1_user','USA')"
            );
            cConn.release();
            logs.push("Replication to CENTRAL succeeded.");
            return { success: true, logs };
        } catch (err) {
            logs.push(err.message);
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

        if (NODE_STATE[0] && db_service.missedWrites[0].length === 0) {
            logs.push("No missed writes in CENTRAL — nothing to recover.");
            return { success: true, logs };
        }

        const cPool = db_router.getNodeById(0);
        const cConn = await cPool.getConnection();

        try {
            await cConn.beginTransaction();
            logs.push("Applying missed writes to CENTRAL...");

            for (let write of db_service.missedWrites[0]) {
                await cConn.query(write.query);
                logs.push(`Applied: ${write.query}`);
            }

            await cConn.commit();
            db_service.missedWrites[0] = [];
            logs.push("Recovery complete. CENTRAL is up-to-date.");
            return { success: true, logs };
        } catch (err) {
            logs.push(err.message);
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
                "INSERT INTO Users (username, country) VALUES ('case3_user','UK')"
            );
            await cConn.commit();
            logs.push("CENTRAL write SUCCESS.");

            // Attempt replication to all partitions
            for (let partition of [1, 2]) {
                if (!NODE_STATE[partition]) {
                    logs.push(`Partition ${partition} is OFFLINE — replication FAILED.`);
                    db_service.missedWrites[partition].push({
                        query: "INSERT INTO Users (username, country) VALUES ('case3_user','UK')",
                    });
                } else {
                    const pPool = db_router.getNodeById(partition);
                    const pConn = await pPool.getConnection();
                    await pConn.query(
                        "INSERT INTO Users (username, country) VALUES ('case3_user','UK')"
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
                await pConn.beginTransaction();
                logs.push(`Recovering missed writes for Partition ${partition}...`);
                for (let write of db_service.missedWrites[partition]) {
                    await pConn.query(write.query);
                    logs.push(`Applied: ${write.query}`);
                }
                await pConn.commit();
                db_service.missedWrites[partition] = [];
                logs.push(`Partition ${partition} recovery complete.`);
            } catch (err) {
                logs.push(err.message);
            } finally {
                pConn.release();
            }
        }

        return { success: true, logs };
    }
}

module.exports = db_service;