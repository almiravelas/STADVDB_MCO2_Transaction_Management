// /routes/recoveryRoutes.js
const express = require('express');
const router = express.Router();
const { replicateToCentral, replicateFromCentral } = require('../recovery/replicator');
const { readLogs, replayLogs } = require('../recovery/recoveryManager');

// CASE #1 – Node2/3 → Central fails
router.post('/simulate/fail-replication-to-central', async (req, res) => {
  const { query, params, sourceNode } = req.body;

  const result = await replicateToCentral(query, params, sourceNode);
  res.json(result);
});

// CASE #2 – Central recovers and replays missed writes
router.post('/simulate/recover-central', async (req, res) => {
  const result = await replayLogs();
  res.json({ recoveryResults: result });
});

// CASE #3 – Central → Node2/3 fails
router.post('/simulate/fail-replication-from-central', async (req, res) => {
  const { query, params, targetNode } = req.body;

  const result = await replicateFromCentral(query, params, targetNode);
  res.json(result);
});

// CASE #4 – Node2/3 recovers and replays missed writes
router.post('/simulate/node-recovery', async (req, res) => {
  const result = await replayLogs();
  res.json(result);
});

// Check logs
router.get('/logs', (req, res) => {
  res.json(readLogs());
});

module.exports = router;
