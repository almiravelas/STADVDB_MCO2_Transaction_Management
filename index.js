const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { node0, node1, node2 } = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check - Test all nodes
app.get('/api/health', async (req, res) => {
  const results = {
    node0: { port: 60826, status: 'unknown' },
    node1: { port: 60827, status: 'unknown' },
    node2: { port: 60828, status: 'unknown' }
  };

  // Test Node 0
  try {
    const [rows] = await node0.query('SELECT DATABASE() as db, VERSION() as version');
    results.node0.status = 'connected';
    results.node0.database = rows[0].db;
    results.node0.version = rows[0].version;
  } catch (error) {
    results.node0.status = 'failed';
    results.node0.error = error.message;
  }

  // Test Node 1
  try {
    const [rows] = await node1.query('SELECT DATABASE() as db, VERSION() as version');
    results.node1.status = 'connected';
    results.node1.database = rows[0].db;
    results.node1.version = rows[0].version;
  } catch (error) {
    results.node1.status = 'failed';
    results.node1.error = error.message;
  }

  // Test Node 2
  try {
    const [rows] = await node2.query('SELECT DATABASE() as db, VERSION() as version');
    results.node2.status = 'connected';
    results.node2.database = rows[0].db;
    results.node2.version = rows[0].version;
  } catch (error) {
    results.node2.status = 'failed';
    results.node2.error = error.message;
  }

  res.json(results);
});

// Test specific node
app.get('/api/node/:id', async (req, res) => {
  const nodeId = parseInt(req.params.id);
  const nodes = { 0: node0, 1: node1, 2: node2 };
  const ports = { 0: 60826, 1: 60827, 2: 60828 };
  if (!nodes[nodeId]) {
    return res.status(400).json({ error: 'Invalid node ID' });
  }

  try {
    const [rows] = await nodes[nodeId].query('SELECT DATABASE() as db, VERSION() as version');
    res.json({
      node: nodeId,
      port: ports[nodeId],
      status: 'connected',
      database: rows[0].db,
      version: rows[0].version
    });
  } catch (error) {
    res.status(500).json({
      node: nodeId,
      port: ports[nodeId],
      status: 'failed',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`\nServer running on http://localhost:${PORT}`);
  console.log(`Test: http://localhost:${PORT}/api/health\n`);
});