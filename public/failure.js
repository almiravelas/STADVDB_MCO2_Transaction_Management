const logBox = document.getElementById("failureLog");

// Client-side node state (required for serverless where server state doesn't persist)
let CLIENT_NODE_STATE = {
    0: true,   // Master
    1: true,   // Slave 1
    2: true    // Slave 2
};

function appendLog(msg) {
    logBox.textContent += msg + "\n";
    logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
    logBox.textContent = "Log cleared.\n";
}

// Get current node state to send with requests
function getNodeStatePayload() {
    return { NODE_STATE: CLIENT_NODE_STATE };
}

async function toggleNode(id, btn) {
    // Get the status element
    const statusEl = document.getElementById(`node${id+1}-status`);
    
    // Toggle the CLIENT state
    CLIENT_NODE_STATE[id] = !CLIENT_NODE_STATE[id];
    const isNowOnline = CLIENT_NODE_STATE[id];
    
    // Update UI
    if (isNowOnline) {
        statusEl.textContent = "ONLINE";
        statusEl.style.color = "#34B53A";
        appendLog(`Node ${id} (${id === 0 ? 'Master' : 'Slave ' + id}) is now ONLINE.`);
    } else {
        statusEl.textContent = "OFFLINE";
        statusEl.style.color = "#FF4C4C";
        appendLog(`Node ${id} (${id === 0 ? 'Master' : 'Slave ' + id}) is now OFFLINE.`);
    }
    
    // Also notify server (for consistency, though server state may not persist)
    try {
        await fetch(`/failure/node/${id}/${isNowOnline ? 'on' : 'off'}`, { method: "POST" });
    } catch (e) {
        console.warn('Failed to sync node state with server:', e);
    }
    
    // Refresh queue status
    await refreshQueueStatus();
}

async function nodeOff(id) {
    const res = await fetch(`/failure/node/${id}/off`, { method: "POST" });
    const data = await res.json();
    appendLog(data.message);
    document.getElementById(`node${id+1}-status`).textContent = "OFFLINE";
    document.getElementById(`node${id+1}-status`).style.color = "#FF4C4C";
    await refreshQueueStatus();
}

async function nodeOn(id) {
    const res = await fetch(`/failure/node/${id}/on`, { method: "POST" });
    const data = await res.json();
    appendLog(data.message);
    document.getElementById(`node${id+1}-status`).textContent = "ONLINE";
    document.getElementById(`node${id+1}-status`).style.color = "#34B53A";
    await refreshQueueStatus();
}

async function runCase1() {
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║         Running Case #1              ║");
    appendLog("╚══════════════════════════════════════╝");
    appendLog(`[Node State: Master=${CLIENT_NODE_STATE[0]?'ON':'OFF'}, S1=${CLIENT_NODE_STATE[1]?'ON':'OFF'}, S2=${CLIENT_NODE_STATE[2]?'ON':'OFF'}]`);
    const res = await fetch(`/failure/case1`, { 
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getNodeStatePayload())
    });
    const data = await res.json();
    data.logs.forEach(appendLog);
    await refreshQueueStatus();
}

async function runCase2() {
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║         Running Case #2              ║");
    appendLog("╚══════════════════════════════════════╝");
    appendLog(`[Node State: Master=${CLIENT_NODE_STATE[0]?'ON':'OFF'}, S1=${CLIENT_NODE_STATE[1]?'ON':'OFF'}, S2=${CLIENT_NODE_STATE[2]?'ON':'OFF'}]`);
    const res = await fetch(`/failure/case2`, { 
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getNodeStatePayload())
    });
    const data = await res.json();
    data.logs.forEach(appendLog);
    await refreshQueueStatus();
}

async function runCase3() {
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║         Running Case #3              ║");
    appendLog("╚══════════════════════════════════════╝");
    appendLog(`[Node State: Master=${CLIENT_NODE_STATE[0]?'ON':'OFF'}, S1=${CLIENT_NODE_STATE[1]?'ON':'OFF'}, S2=${CLIENT_NODE_STATE[2]?'ON':'OFF'}]`);
    const res = await fetch(`/failure/case3`, { 
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getNodeStatePayload())
    });
    const data = await res.json();
    data.logs.forEach(appendLog);
    
    // Show results summary
    if (data.success) {
        appendLog("\n📊 RESULTS:");
        appendLog(`   Central Write: ${data.centralWriteSuccess ? '✓ SUCCESS' : '✗ FAILED'}`);
        appendLog(`   Queue Sizes: P1=${data.queueSizes.partition1}, P2=${data.queueSizes.partition2}`);
    }
    
    await refreshQueueStatus();
}

async function runCase4() {
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║         Running Case #4              ║");
    appendLog("╚══════════════════════════════════════╝");
    appendLog(`[Node State: Master=${CLIENT_NODE_STATE[0]?'ON':'OFF'}, S1=${CLIENT_NODE_STATE[1]?'ON':'OFF'}, S2=${CLIENT_NODE_STATE[2]?'ON':'OFF'}]`);
    const res = await fetch(`/failure/case4`, { 
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getNodeStatePayload())
    });
    const data = await res.json();
    data.logs.forEach(appendLog);
    
    // Show recovery summary
    if (data.success && data.stats) {
        appendLog("\n📊 RECOVERY STATS:");
        appendLog(`   Total Attempted: ${data.stats.totalAttempted}`);
        appendLog(`   Successful: ${data.stats.totalSuccess}`);
        appendLog(`   Failed: ${data.stats.totalFailed}`);
        appendLog(`   System Status: ${data.fullyRecovered ? '✓ FULLY SYNCHRONIZED' : '⚠ PENDING'}`);
    }
    
    await refreshQueueStatus();
}

// Recovery Monitor Functions
async function startMonitor() {
    appendLog("\n[Monitor] Starting background recovery monitor...");
    const res = await fetch(`/failure/monitor/start`, { 
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMs: 30000 })
    });
    const data = await res.json();
    appendLog(`[Monitor] ${data.message}`);
    await refreshMonitorStatus();
}

async function stopMonitor() {
    appendLog("\n[Monitor] Stopping background recovery monitor...");
    const res = await fetch(`/failure/monitor/stop`, { method: "POST" });
    const data = await res.json();
    appendLog(`[Monitor] ${data.message}`);
    await refreshMonitorStatus();
}

async function refreshMonitorStatus() {
    const res = await fetch(`/failure/monitor/status`);
    const data = await res.json();
    
    const enabledEl = document.getElementById("monitor-enabled");
    const detailsEl = document.getElementById("monitor-details");
    
    if (data.enabled) {
        enabledEl.textContent = "RUNNING";
        enabledEl.style.color = "#34B53A";
        detailsEl.style.display = "block";
        
        document.getElementById("monitor-lastcheck").textContent = 
            data.lastCheck ? new Date(data.lastCheck).toLocaleTimeString() : "Never";
        document.getElementById("monitor-totalchecks").textContent = data.stats.totalChecks;
        document.getElementById("monitor-totalrecoveries").textContent = data.stats.totalRecoveries;
        document.getElementById("monitor-interval").textContent = data.intervalMs + "ms";
    } else {
        enabledEl.textContent = "STOPPED";
        enabledEl.style.color = "#FF4C4C";
        detailsEl.style.display = "none";
    }
    
    // Update Master queue display (single source of truth)
    const totalPending = (data.queueSizes.partition1 || 0) + (data.queueSizes.partition2 || 0);
    const masterQueueCount = document.getElementById("master-queue-count");
    if (masterQueueCount) {
        masterQueueCount.textContent = totalPending;
    }
    
    // Update Slave pending counts
    const slave1Count = document.getElementById("slave1-pending-count");
    if (slave1Count) slave1Count.textContent = data.queueSizes.partition1 || 0;
    
    const slave2Count = document.getElementById("slave2-pending-count");
    if (slave2Count) slave2Count.textContent = data.queueSizes.partition2 || 0;
}

async function refreshQueueStatus() {
    const res = await fetch(`/failure/queue/status`);
    const data = await res.json();
    
    // Calculate total Master queue (sum of pending writes for all slaves)
    const totalPending = (data.partition1 || 0) + (data.partition2 || 0);
    
    // Update Master queue display (single source of truth)
    const masterQueueCount = document.getElementById("master-queue-count");
    if (masterQueueCount) {
        masterQueueCount.textContent = totalPending;
        const masterQueue = document.getElementById("master-queue");
        if (masterQueue) {
            masterQueue.style.background = totalPending > 0 ? "#fff0f0" : "#fff8e6";
            masterQueue.style.color = totalPending > 0 ? "#FF4C4C" : "#FFA500";
        }
    }
    
    // Update Slave pending counts (these are subsets of Master's queue)
    const slave1Count = document.getElementById("slave1-pending-count");
    if (slave1Count) {
        slave1Count.textContent = data.partition1 || 0;
        const slave1Pending = document.getElementById("slave1-pending");
        if (slave1Pending) {
            slave1Pending.style.color = data.partition1 > 0 ? "#FFA500" : "#A3AED0";
        }
    }
    
    const slave2Count = document.getElementById("slave2-pending-count");
    if (slave2Count) {
        slave2Count.textContent = data.partition2 || 0;
        const slave2Pending = document.getElementById("slave2-pending");
        if (slave2Pending) {
            slave2Pending.style.color = data.partition2 > 0 ? "#FFA500" : "#A3AED0";
        }
    }
}

// Concurrent transaction simulation
async function runConcurrentTest() {
    const count = parseInt(document.getElementById("concurrent-count").value) || 5;
    const delay = parseInt(document.getElementById("concurrent-delay").value) || 500;
    
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║   Concurrent Transaction Test        ║");
    appendLog("╚══════════════════════════════════════╝");
    appendLog(`Simulating ${count} concurrent transactions with ${delay}ms delay...`);
    appendLog("This demonstrates how the system shields users from failures.\n");
    
    const promises = [];
    
    for (let i = 0; i < count; i++) {
        // Add delay between starting transactions
        await new Promise(resolve => setTimeout(resolve, delay));
        
        appendLog(`[Transaction ${i+1}] Started...`);
        
        // Run Case 3 (which handles failures gracefully)
        const promise = fetch(`/failure/case3`, { method: "POST" })
            .then(res => res.json())
            .then(data => {
                appendLog(`[Transaction ${i+1}] ${data.success ? '✓ COMPLETED' : '✗ FAILED'}`);
                if (data.centralWriteSuccess) {
                    appendLog(`[Transaction ${i+1}] User sees: SUCCESS (data in Central Node)`);
                }
                return data;
            })
            .catch(err => {
                appendLog(`[Transaction ${i+1}] ✗ ERROR: ${err.message}`);
            });
        
        promises.push(promise);
    }
    
    appendLog(`\nWaiting for all ${count} transactions to complete...`);
    
    await Promise.all(promises);
    
    appendLog("\n═══════════════════════════════════════");
    appendLog("All concurrent transactions completed!");
    appendLog("Check the queue status to see pending replications.");
    appendLog("═══════════════════════════════════════\n");
    
    await refreshQueueStatus();
}

// Auto-refresh queue status every 5 seconds
setInterval(refreshQueueStatus, 5000);

// Initial load
refreshQueueStatus();
refreshMonitorStatus();
