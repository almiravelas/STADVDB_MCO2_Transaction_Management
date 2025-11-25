// /recovery/recoveryManager.js
const fs = require('fs');
const path = require('path');
const { node0, node1, node2 } = require('../db/connection');

const LOG_FILE = path.join(__dirname, 'replication_log.json');

function readLogs() {
  return JSON.parse(fs.readFileSync(LOG_FILE));
}

function clearLogs() {
  fs.writeFileSync(LOG_FILE, JSON.stringify([]));
}

async function replayLogs() {
  const logs = readLogs();
  const results = [];

  for (const entry of logs) {
    let pool;
    if (entry.targetNode === "node0") pool = node0;
    else if (entry.targetNode === "node1") pool = node1;
    else pool = node2;

    try {
      await pool.query(entry.query, entry.params);
      results.push({ ...entry, status: "REPLAYED" });
    } catch (err) {
      results.push({ ...entry, status: "FAILED AGAIN", error: err });
    }
  }

  clearLogs();
  return results;
}

module.exports = { readLogs, replayLogs };
