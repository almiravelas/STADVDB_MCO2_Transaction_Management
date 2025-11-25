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
        if (!userData.country) throw new Error("Country is required.");
        if (!userData.id) throw new Error("ID is required.");

        // 1. Generate Timestamps
        // Format: 'YYYY-MM-DD HH:MM:SS'
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // 2. Build the FULL data object
        // This object MUST contain every column that doesn't have a default value in DB
        const fullData = {
            id: userData.id,
            username: userData.username || `user_${userData.id}`, // Fallback if empty
            firstName: userData.firstName,
            lastName: userData.lastName,
            city: userData.city,
            country: userData.country,
            gender: userData.gender || 'Unknown',
            
            // Database Required Fields (Defaults)
            address1: 'N/A',
            address2: 'N/A',
            zipCode: '0000',
            phoneNumber: '000-000-0000',
            dateOfBirth: '2000-01-01',
            
            // SYSTEM GENERATED TIMESTAMP
            createdAt: timestamp,
            updatedAt: timestamp
        };

        const centralPool = db_router.getCentralNode();
        const partitionPool = db_router.getPartitionNode(userData.country);

        let centralConn, partitionConn;

        try {
            centralConn = await centralPool.getConnection();
            partitionConn = await partitionPool.getConnection();

            await centralConn.beginTransaction();
            await partitionConn.beginTransaction();

            console.log("Inserting into Central...");
            await db_access.insertUser(centralConn, fullData);
            
            console.log("Inserting into Partition...");
            await db_access.insertUser(partitionConn, fullData);

            await centralConn.commit();
            await partitionConn.commit();

            return { 
                success: true, 
                id: userData.id,
                message: `User created with ID ${userData.id} in Central and Partition.` 
            };
        } catch (error) {
            console.error("Transaction Error:", error.message);
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