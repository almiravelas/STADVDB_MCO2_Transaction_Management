const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { node0, node1, node2 } = require('./db/connection');
const exphbs = require('express-handlebars');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public', { index: false }));

// View engine (Handlebars)
app.engine('hbs', exphbs.engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views', 'layouts')
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Root endpoint (rendered)
app.get('/', (req, res) => {
  res.render('index');
});

// Health check - Test all nodes with row counts
app.get('/api/health', async (req, res) => {
  const results = {
    node0: { port: 60826, status: 'unknown' },
    node1: { port: 60827, status: 'unknown' },
    node2: { port: 60828, status: 'unknown' }
  };

  // Test Node 0
  try {
    const [info] = await node0.query('SELECT DATABASE() as db, VERSION() as version');
    const [tables] = await node0.query('SHOW TABLES');
    const tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    
    let rowCount = 0;
    if (tableName) {
      const [count] = await node0.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      rowCount = count[0].count;
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
    const tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    
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
    const tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    
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
  
  // Map display node IDs (1,2,3) to actual nodes (0,1,2) with correct ports
  const nodeMap = {
    1: { pool: node0, port: 60826, name: 'Node 1 (Central)' },
    2: { pool: node1, port: 60827, name: 'Node 2 (Partition 1)' },
    3: { pool: node2, port: 60828, name: 'Node 3 (Partition 2)' }
  };
  
  if (!nodeMap[nodeId]) {
    return res.status(400).json({ error: 'Invalid node ID. Use 1, 2, or 3.' });
  }

  try {
    const pool = nodeMap[nodeId].pool;
    
    // Get basic info
    const [info] = await pool.query('SELECT DATABASE() as db, VERSION() as version');
    
    // Get tables
    const [tables] = await pool.query('SHOW TABLES');
    const tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    
    let rowCount = 0;
    let sampleData = [];
    
    if (tableName) {
      // Get row count
      const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      rowCount = count[0].count;
      
      // Get sample 5 rows
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
  const limit = parseInt(req.query.limit) || 5;
  
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
    
    // Get tables
    const [tables] = await pool.query('SHOW TABLES');
    const tableName = tables.length > 0 ? Object.values(tables[0])[0] : null;
    
    if (!tableName) {
      return res.json({
        node: nodeId,
        message: 'No tables found in database',
        data: []
      });
    }
    
    // Get sample data
    const [data] = await pool.query(`SELECT * FROM ${tableName} LIMIT ?`, [limit]);
    
    // Get total count
    const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    
    res.json({
      node: nodeId,
      name: nodeMap[nodeId].name,
      table: tableName,
      totalRows: count[0].count,
      showing: data.length,
      data: data
    });
  } catch (error) {
    res.status(500).json({
      node: nodeId,
      error: error.message
    });
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
    
    // If no table specified, get first table
    let table = tableName;
    if (!table) {
      const [tables] = await pool.query('SHOW TABLES');
      table = tables.length > 0 ? Object.values(tables[0])[0] : null;
    }
    
    if (!table) {
      return res.json({
        node: nodeId,
        error: 'No table found'
      });
    }
    
    const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
    
    res.json({
      node: nodeId,
      name: nodeMap[nodeId].name,
      table: table,
      rowCount: count[0].count
    });
  } catch (error) {
    res.status(500).json({
      node: nodeId,
      error: error.message
    });
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
        comparison.node1 = {
          ...comparison.node1,
          status: 'connected',
          table: table1,
          rowCount: count1[0].count
        };
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
        comparison.node2 = {
          ...comparison.node2,
          status: 'connected',
          table: table2,
          rowCount: count2[0].count
        };
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
        comparison.node3 = {
          ...comparison.node3,
          status: 'connected',
          table: table3,
          rowCount: count3[0].count
        };
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

const recoveryRoutes = require('./routes/recoveryRoutes');
app.use('/recovery', recoveryRoutes);

app.listen(PORT, () => {
  console.log(`\nServer running on http://localhost:${PORT}`);
  console.log(`Test: http://localhost:${PORT}/api/health\n`);
  console.log('Available endpoints:');
  console.log('  GET /api/health - Test all nodes with row counts');
  console.log('  GET /api/node/:id - Get detailed info for node (1, 2, or 3)');
  console.log('  GET /api/node/:id/data?limit=5 - Get sample data from node');
  console.log('  GET /api/node/:id/count?table=tablename - Get row count');
  console.log('  GET /api/compare - Compare data across all nodes\n');
});