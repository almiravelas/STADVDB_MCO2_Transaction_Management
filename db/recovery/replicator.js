// /recovery/replicator.js
const fs = require('fs');
const path = require('path');
const { node0, node1, node2 } = require('../db/connection');

const LOG_FILE = path.join(__dirname, 'replication_log.json');

// Ensure log file exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, JSON.stringify([]));
}

// Append a failed replication task
function logMissedReplication(entry) {
  const log = JSON.parse(fs.readFileSync(LOG_FILE));
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

async function replicateWrite(sourceNode, targetNode, query, params) {
  try {
    const pool =
      targetNode === "node0" ? node0 :
      targetNode === "node1" ? node1 :
      node2;

    await pool.query(query, params);
    return { success: true };
  } catch (err) {
    console.log(`❌ Replication failed for target: ${targetNode}`);

    // Save missed replication to log
    logMissedReplication({
      timestamp: Date.now(),
      sourceNode,
      targetNode,
      query,
      params
    });

    return { success: false, error: err };
  }
}

// Example public functions
async function replicateToCentral(query, params, sourceNode) {
  return await replicateWrite(sourceNode, "node0", query, params);
}

async function replicateFromCentral(query, params, targetNode) {
  return await replicateWrite("node0", targetNode, query, params);
}

module.exports = {
  replicateToCentral,
  replicateFromCentral
};
