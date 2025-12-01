const { node0 } = require('./db/connection');

async function checkStats() {
    try {
        console.log("Checking stats on Node 0...");
        
        const [tables] = await node0.query("SHOW TABLES");
        const tableNames = tables.map(t => Object.values(t)[0]);
        console.log("Tables:", tableNames);

        if (tableNames.includes('users')) {
            const [count] = await node0.query("SELECT COUNT(*) as count FROM users");
            const [max] = await node0.query("SELECT MAX(id) as maxId FROM users");
            const [min] = await node0.query("SELECT MIN(id) as minId FROM users");
            console.log(`'users' -> Count: ${count[0].count}, Min ID: ${min[0].minId}, Max ID: ${max[0].maxId}`);
        }

        if (tableNames.includes('Users')) {
            const [count] = await node0.query("SELECT COUNT(*) as count FROM Users");
            const [max] = await node0.query("SELECT MAX(id) as maxId FROM Users");
            const [min] = await node0.query("SELECT MIN(id) as minId FROM Users");
            console.log(`'Users' -> Count: ${count[0].count}, Min ID: ${min[0].minId}, Max ID: ${max[0].maxId}`);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkStats();