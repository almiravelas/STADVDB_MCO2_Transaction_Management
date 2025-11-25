// models/db_router.js
const db = require('../db/connection');

class db_router {
    // DECISION LOGIC: Based on 'Country'
    // Node 1: Countries >= 'M'
    // Node 2: Countries < 'M'
    static getPartitionNode(country) {
        if (!country) {
            throw new Error("Routing Error: Country is required to determine partition.");
        }

        // Normalize to ensure case-insensitive comparison matches SQL behavior
        const normalizedCountry = country.toUpperCase();

        // Check if country starts with M or comes after M
        if (normalizedCountry >= 'M') {
            return db.node1; // Partition 1 (e.g., Mexico, Philippines, USA)
        }
        
        // Countries A-L
        return db.node2; // Partition 2 (e.g., Australia, Canada, Germany)
    }

    // CENTRAL NODE: The master copy (Node 0)
    static getCentralNode() {
        return db.node0;
    }
}

module.exports = db_router;