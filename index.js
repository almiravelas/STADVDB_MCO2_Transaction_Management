const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { node0, node1, node2 } = require('./db/connection');
const db_service = require('./models/db_service'); 
const db_router = require('./models/db_router');
const failureController = require('./controller/failureController');
const exphbs = require('express-handlebars');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public', { index: false }));
app.use(express.static(path.join(__dirname, "public")));

// View engine (Handlebars)
app.engine('hbs', exphbs.engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials')
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Root endpoint (rendered)
app.get('/', (req, res) => {
  res.render('index');
});

// Health check with detailed diagnostics
app.get('/api/debug', async (req, res) => {
    try {
        const results = {
            environment: process.env.NODE_ENV,
            timestamp: new Date().toISOString(),
            nodes: {}
        };

        // Test each node connection
        for (let i = 0; i <= 2; i++) {
            try {
                const pool = db_router.getNodeById(i);
                const conn = await pool.getConnection();
                const [rows] = await conn.query('SELECT COUNT(*) as count FROM users');
                conn.release();
                results.nodes[`node${i}`] = {
                    status: 'connected',
                    userCount: rows[0].count
                };
            } catch (error) {
                results.nodes[`node${i}`] = {
                    status: 'error',
                    error: error.message
                };
            }
        }

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
//  PART 1: DISTRIBUTED TRANSACTION ENDPOINTS
// ==========================================

// 1. CREATE USER
app.post('/api/users', async (req, res) => {
    try {
        console.log('[API] Creating user:', req.body);
        const NODE_STATE = failureController.getNodeState();
        const result = await db_service.createUser(req.body, NODE_STATE);
        console.log('[API] Create result:', result);
        res.json(result);
    } catch (error) {
        console.error('[API] Create user error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 2. GET USER (By ID or Country)
app.get('/api/users/search', async (req, res) => {
    const { id, country } = req.query;
    console.log(`[API] Search Request - ID: ${id}, Country: ${country}`);
    try {
        if (id) {
            // Strategy 1: Central Lookup
            const user = await db_service.getUserById(id);
            if (!user) return res.status(404).json({ error: "User not found" });
            res.json(user);
        } else if (country) {
            // Strategy 2: Partition Lookup
            const users = await db_service.getUsersByCountry(country);
            console.log(`[API] Found ${users.length} users for country ${country}`);
            res.json(users);
        } else {
            res.status(400).json({ error: "Please provide 'id' or 'country'" });
        }
    } catch (error) {
        console.error("[API] Search Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 3. UPDATE USER
app.put('/api/users/:id', async (req, res) => {
    try {
        const result = await db_service.updateUser(req.params.id, req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. DELETE USER
app.delete('/api/users/:id', async (req, res) => {
    try {
        const { country } = req.query;
        const result = await db_service.deleteUser(req.params.id, country);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// SIMULATION ENDPOINT
app.post('/api/simulate', async (req, res) => {
    try {
        // req.body contains { id, type, isolation, sleepTime, updateText }
        const result = await db_service.simulateTransaction(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// ==========================================
//  PART 2: DIAGNOSTIC & HEALTH ENDPOINTS
// ==========================================

// Health check - Test all nodes with row counts
app.get('/api/health', async (req, res) => {
  const results = {
    node0: { port: process.env.NODE0_PORT || 60826, status: 'unknown' },
    node1: { port: process.env.NODE1_PORT || 60827, status: 'unknown' },
    node2: { port: process.env.NODE2_PORT || 60828, status: 'unknown' }
  };

  // Test Node 0
  try {
    const [info] = await node0.query('SELECT DATABASE() as db, VERSION() as version');
    const [tables] = await node0.query('SHOW TABLES');
    
    // Prioritize 'users' table
    let tableName = null;
    const hasUsersLowercase = tables.some(t => Object.values(t)[0] === 'users');
    if (hasUsersLowercase) {
        tableName = 'users';
    } else {
        tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    }
    
    let rowCount = 0;
    if (tableName) {
      // Use MAX(id) instead of COUNT(*) as per user request for Dashboard
      const [res] = await node0.query(`SELECT MAX(id) as maxId FROM ${tableName}`);
      rowCount = res[0].maxId || 0;
    }
    
    results.node0.status = 'connected';
    results.node0.database = info[0].db;
    results.node0.version = info[0].version;
    results.node0.table = tableName;
    results.node0.rowCount = rowCount;
  } catch (error) {
    results.node0.status = 'failed';
    results.node0.error = error.message;
  }

  // Test Node 1
  try {
    const [info] = await node1.query('SELECT DATABASE() as db, VERSION() as version');
    const [tables] = await node1.query('SHOW TABLES');
    
    // Prioritize 'users' table
    let tableName = null;
    const hasUsersLowercase = tables.some(t => Object.values(t)[0] === 'users');
    if (hasUsersLowercase) {
        tableName = 'users';
    } else {
        tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    }
    
    let rowCount = 0;
    if (tableName) {
      const [count] = await node1.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      rowCount = count[0].count;
    }
    
    results.node1.status = 'connected';
    results.node1.database = info[0].db;
    results.node1.version = info[0].version;
    results.node1.table = tableName;
    results.node1.rowCount = rowCount;
  } catch (error) {
    results.node1.status = 'failed';
    results.node1.error = error.message;
  }

  // Test Node 2
  try {
    const [info] = await node2.query('SELECT DATABASE() as db, VERSION() as version');
    const [tables] = await node2.query('SHOW TABLES');
    
    // Prioritize 'users' table
    let tableName = null;
    const hasUsersLowercase = tables.some(t => Object.values(t)[0] === 'users');
    if (hasUsersLowercase) {
        tableName = 'users';
    } else {
        tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    }
    
    let rowCount = 0;
    if (tableName) {
      const [count] = await node2.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      rowCount = count[0].count;
    }
    
    results.node2.status = 'connected';
    results.node2.database = info[0].db;
    results.node2.version = info[0].version;
    results.node2.table = tableName;
    results.node2.rowCount = rowCount;
  } catch (error) {
    results.node2.status = 'failed';
    results.node2.error = error.message;
  }

  res.json(results);
});

// Test specific node with detailed info
app.get('/api/node/:id', async (req, res) => {
  const nodeId = parseInt(req.params.id);
  
  const nodeMap = {
    1: { pool: node0, port: process.env.NODE0_PORT, name: 'Node 1 (Central)' },
    2: { pool: node1, port: process.env.NODE1_PORT, name: 'Node 2 (Partition 1)' },
    3: { pool: node2, port: process.env.NODE2_PORT, name: 'Node 3 (Partition 2)' }
  };
  
  if (!nodeMap[nodeId]) {
    return res.status(400).json({ error: 'Invalid node ID. Use 1, 2, or 3.' });
  }

  try {
    const pool = nodeMap[nodeId].pool;
    const [info] = await pool.query('SELECT DATABASE() as db, VERSION() as version');
    const [tables] = await pool.query('SHOW TABLES');
    
    // Prioritize 'users' table
    let tableName = null;
    const hasUsersLowercase = tables.some(t => Object.values(t)[0] === 'users');
    if (hasUsersLowercase) {
        tableName = 'users';
    } else {
        tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    }
    
    let rowCount = 0;
    let sampleData = [];
    
    if (tableName) {
      const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      rowCount = count[0].count;
      const [samples] = await pool.query(`SELECT * FROM ${tableName} LIMIT 5`);
      sampleData = samples;
    }
    
    res.json({
      node: nodeId,
      name: nodeMap[nodeId].name,
      port: nodeMap[nodeId].port,
      status: 'connected',
      database: info[0].db,
      version: info[0].version,
      table: tableName,
      rowCount: rowCount,
      sampleData: sampleData
    });
  } catch (error) {
    res.status(500).json({
      node: nodeId,
      name: nodeMap[nodeId].name,
      port: nodeMap[nodeId].port,
      status: 'failed',
      error: error.message,
      code: error.code
    });
  }
});

// Get sample data from a specific node
app.get('/api/node/:id/data', async (req, res) => {
  const nodeId = parseInt(req.params.id);
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  
  console.log(`[API] Fetching data for Node ${nodeId} | Limit: ${limit} | Offset: ${offset}`);

  const nodeMap = {
    1: { pool: node0, name: 'Node 1 (Central)' },
    2: { pool: node1, name: 'Node 2 (Partition 1)' },
    3: { pool: node2, name: 'Node 3 (Partition 2)' }
  };
  
  if (!nodeMap[nodeId]) {
    return res.status(400).json({ error: 'Invalid node ID. Use 1, 2, or 3.' });
  }

  try {
    const pool = nodeMap[nodeId].pool;
    const [tables] = await pool.query('SHOW TABLES');
    
    // Prioritize 'users' table (lowercase)
    let tableName = null;
    const hasUsersLowercase = tables.some(t => Object.values(t)[0] === 'users');
    
    if (hasUsersLowercase) {
        tableName = 'users';
    } else {
        // Fallback to case-insensitive search
        const usersTable = tables.find(t => Object.values(t)[0].toLowerCase() === 'users');
        if (usersTable) {
            tableName = Object.values(usersTable)[0];
        } else {
            tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
        }
    }
    
    if (!tableName) {
      return res.json({ node: nodeId, message: 'No tables found', data: [] });
    }
    
    // Debugging SQL
    // ORDER BY id DESC to show newest users first
    const sql = `SELECT * FROM ${tableName} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
    console.log(`[API] Executing SQL: ${sql}`);
    
    // Using interpolation for LIMIT/OFFSET to avoid prepared statement issues with some MySQL versions/drivers
    const [data] = await pool.query(sql);
    const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    
    console.log(`[API] Found ${data.length} rows. Total: ${count[0].count}`);

    res.json({
      node: nodeId,
      name: nodeMap[nodeId].name,
      table: tableName,
      totalRows: count[0].count,
      showing: data.length,
      data: data
    });
  } catch (error) {
    console.error("[API] Error fetching data:", error);
    res.status(500).json({ node: nodeId, error: error.message });
  }
});

// Get row count for a specific table on a node
app.get('/api/node/:id/count', async (req, res) => {
  const nodeId = parseInt(req.params.id);
  const tableName = req.query.table;
  
  const nodeMap = {
    1: { pool: node0, name: 'Node 1 (Central)' },
    2: { pool: node1, name: 'Node 2 (Partition 1)' },
    3: { pool: node2, name: 'Node 3 (Partition 2)' }
  };
  
  if (!nodeMap[nodeId]) {
    return res.status(400).json({ error: 'Invalid node ID. Use 1, 2, or 3.' });
  }

  try {
    const pool = nodeMap[nodeId].pool;
    let table = tableName;
    if (!table) {
      const [tables] = await pool.query('SHOW TABLES');
      table = tables.length > 0 ? Object.values(tables[0])[0] : null;
    }
    
    if (!table) {
      return res.json({ node: nodeId, error: 'No table found' });
    }
    
    const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
    res.json({
      node: nodeId,
      name: nodeMap[nodeId].name,
      table: table,
      rowCount: count[0].count
    });
  } catch (error) {
    res.status(500).json({ node: nodeId, error: error.message });
  }
});

// Compare data across all nodes
app.get('/api/compare', async (req, res) => {
  try {
    const comparison = {
      node1: { name: 'Node 1 (Central)', status: 'unknown' },
      node2: { name: 'Node 2 (Partition 1)', status: 'unknown' },
      node3: { name: 'Node 3 (Partition 2)', status: 'unknown' }
    };

    // Node 1
    try {
      const [tables1] = await node0.query('SHOW TABLES');
      const table1 = tables1.length > 0 ? Object.values(tables1[0])[0] : null;
      if (table1) {
        const [count1] = await node0.query(`SELECT COUNT(*) as count FROM ${table1}`);
        comparison.node1 = { ...comparison.node1, status: 'connected', table: table1, rowCount: count1[0].count };
      }
    } catch (error) {
      comparison.node1.status = 'failed';
      comparison.node1.error = error.message;
    }

    // Node 2
    try {
      const [tables2] = await node1.query('SHOW TABLES');
      const table2 = tables2.length > 0 ? Object.values(tables2[0])[0] : null;
      if (table2) {
        const [count2] = await node1.query(`SELECT COUNT(*) as count FROM ${table2}`);
        comparison.node2 = { ...comparison.node2, status: 'connected', table: table2, rowCount: count2[0].count };
      }
    } catch (error) {
      comparison.node2.status = 'failed';
      comparison.node2.error = error.message;
    }

    // Node 3
    try {
      const [tables3] = await node2.query('SHOW TABLES');
      const table3 = tables3.length > 0 ? Object.values(tables3[0])[0] : null;
      if (table3) {
        const [count3] = await node2.query(`SELECT COUNT(*) as count FROM ${table3}`);
        comparison.node3 = { ...comparison.node3, status: 'connected', table: table3, rowCount: count3[0].count };
      }
    } catch (error) {
      comparison.node3.status = 'failed';
      comparison.node3.error = error.message;
    }

    // Add validation
    comparison.validation = {
      allConnected: comparison.node1.status === 'connected' && 
                    comparison.node2.status === 'connected' && 
                    comparison.node3.status === 'connected',
      partitionsMatch: (comparison.node2.rowCount + comparison.node3.rowCount) === comparison.node1.rowCount
    };

    res.json(comparison);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TEST COMPLETE FLOW
app.get('/api/test-complete-flow', async (req, res) => {
    const result = await db_service.testCompleteFlow();
    res.json(result);
});

//RECOVERY
app.use("/replication", require('./routes/db_cases'));
app.use("/failure", require('./routes/failureRoutes'));

app.listen(PORT, () => {
  console.log(`\nServer running on http://localhost:${PORT}`);
  console.log(`Test: http://localhost:${PORT}/api/health\n`);
  console.log('Available endpoints:');
  console.log('  GET /api/health - Test all nodes with row counts');
  console.log('  GET /api/node/:id - Get detailed info for node (1, 2, or 3)');
  console.log('  GET /api/node/:id/data?limit=5 - Get sample data from node');
  console.log('  GET /api/compare - Compare data across all nodes');
  console.log('  POST /api/users - Create User');
  console.log('  GET /api/users/search - Search User');
  console.log('  PUT /api/users/:id - Update User');
  console.log('  DELETE /api/users/:id - Delete User\n');
  
  // Auto-start recovery monitor with 10-second interval
  const NODE_STATE = failureController.getNodeState();
  db_service.startRecoveryMonitor(10000, NODE_STATE);
  console.log('✓ Background Recovery Monitor started (10s interval)\n');
});