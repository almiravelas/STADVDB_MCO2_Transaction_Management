// models/db_router.js
const db = require('../db/connection');

class db_router {
    // DECISION LOGIC: Based on 'Country'
    // Node 1: Countries A-L (Australia, Canada, Germany, etc.)
    // Node 2: Countries M-Z (Mexico, Philippines, USA, etc.)
    static getPartitionNode(country) {
        if (!country) {
            throw new Error("Routing Error: Country is required to determine partition.");
        }

        // Normalize to ensure case-insensitive comparison matches SQL behavior
        const normalizedCountry = country.toUpperCase();

        // Check if country starts with A-L (before M)
        if (normalizedCountry < 'M') {
            return db.node1; // Partition 1: A-L countries
        }
        
        // Countries M-Z
        return db.node2; // Partition 2: M-Z countries
    }

    // Get partition ID (1 or 2) based on country
    static getPartitionId(country) {
        if (!country) {
            throw new Error("Country is required to determine partition.");
        }
        const normalizedCountry = country.toUpperCase();
        return normalizedCountry < 'M' ? 1 : 2;
    }

    // CENTRAL NODE: The master copy (Node 0)
    static getCentralNode() {
        return db.node0;
    }

    static getNodeById(id) {
        if (id == 0) return db.node0;
        if (id == 1) return db.node1;
        if (id == 2) return db.node2;
        throw new Error("Invalid node ID");
    }
}

module.exports = db_router;