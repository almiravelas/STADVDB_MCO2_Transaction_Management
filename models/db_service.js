const db_router = require('../models/db_router');
const db_access = require('../models/db_access');

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
}

module.exports = db_service;