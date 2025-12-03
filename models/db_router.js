// models/db_router.js
// =========================================================
// MASTER-SLAVE ARCHITECTURE
// =========================================================
// Master (Central Node 0): Handles ALL writes, source of truth
// Slave 1 (Node 1): Read replica for countries A-L
// Slave 2 (Node 2): Read replica for countries M-Z
// 
// Write Path: Client → Master → Slaves (synchronous replication with 2PC)
// Read Path: Client → Appropriate Slave (or Master as fallback)
// =========================================================

const db = require('../db/connection');

class db_router {
    
    // =========================================================
    // MASTER NODE: Central database - ALL WRITES go here first
    // This is the single source of truth (Master in Master-Slave)
    // =========================================================
    static getMasterNode() {
        return db.node0;
    }

    // Alias for compatibility
    static getCentralNode() {
        return db.node0;
    }

    // =========================================================
    // SLAVE NODES: Read replicas partitioned by country
    // Slave 1: Countries A-L (Australia, Canada, Germany, etc.)
    // Slave 2: Countries M-Z (Mexico, Philippines, USA, etc.)
    // =========================================================
    static getSlaveNode(country) {
        if (!country) {
            throw new Error("Routing Error: Country is required to determine slave.");
        }

        const normalizedCountry = country.toUpperCase();

        // Route to appropriate slave based on country first letter
        if (normalizedCountry < 'M') {
            return db.node1; // Slave 1: A-L countries
        }
        
        return db.node2; // Slave 2: M-Z countries
    }

    // Alias for compatibility
    static getPartitionNode(country) {
        return db_router.getSlaveNode(country);
    }

    // Get slave ID (1 or 2) based on country
    static getSlaveId(country) {
        if (!country) {
            throw new Error("Country is required to determine slave.");
        }
        const normalizedCountry = country.toUpperCase();
        return normalizedCountry < 'M' ? 1 : 2;
    }

    // Alias for compatibility
    static getPartitionId(country) {
        return db_router.getSlaveId(country);
    }

    static getNodeById(id) {
        if (id == 0) return db.node0; // Master
        if (id == 1) return db.node1; // Slave 1
        if (id == 2) return db.node2; // Slave 2
        throw new Error("Invalid node ID");
    }

    // =========================================================
    // ARCHITECTURE INFO
    // =========================================================
    static getArchitectureInfo() {
        return {
            type: 'MASTER-SLAVE',
            master: { id: 0, role: 'Master (Central)', scope: 'All data' },
            slaves: [
                { id: 1, role: 'Slave 1', scope: 'Countries A-L' },
                { id: 2, role: 'Slave 2', scope: 'Countries M-Z' }
            ],
            replication: 'Synchronous with 2PC',
            consistency: 'Strong (ACID)',
            isolation: 'REPEATABLE READ',
            locking: 'Pessimistic (SELECT FOR UPDATE)'
        };
    }
}

module.exports = db_router;