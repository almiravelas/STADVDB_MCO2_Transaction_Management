const logBox = document.getElementById("failureLog");

function appendLog(msg) {
    logBox.textContent += msg + "\n";
    logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
    logBox.textContent = "Log cleared.\n";
}

async function toggleNode(id, btn) {
    // Get the status element
    const statusEl = document.getElementById(`node${id+1}-status`);
    
    // Determine current state
    const isOnline = statusEl.textContent.trim() === "ONLINE";
    
    if (isOnline) {
        // Turn node OFF
        const res = await fetch(`/failure/node/${id}/off`, { method: "POST" });
        const data = await res.json();
        appendLog(data.message);
        statusEl.textContent = "OFFLINE";
        statusEl.style.color = "#FF4C4C";
    } else {
        // Turn node ON
        const res = await fetch(`/failure/node/${id}/on`, { method: "POST" });
        const data = await res.json();
        appendLog(data.message);
        statusEl.textContent = "ONLINE";
        statusEl.style.color = "#34B53A";
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
    const res = await fetch(`/failure/case1`, { method: "POST" });
    const data = await res.json();
    data.logs.forEach(appendLog);
    await refreshQueueStatus();
}

async function runCase2() {
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║         Running Case #2              ║");
    appendLog("╚══════════════════════════════════════╝");
    const res = await fetch(`/failure/case2`, { method: "POST" });
    const data = await res.json();
    data.logs.forEach(appendLog);
    await refreshQueueStatus();
}

async function runCase3() {
    appendLog("\n╔══════════════════════════════════════╗");
    appendLog("║         Running Case #3              ║");
    appendLog("╚══════════════════════════════════════╝");
    const res = await fetch(`/failure/case3`, { method: "POST" });
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
    const res = await fetch(`/failure/case4`, { method: "POST" });
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
    
    // Update queue displays
    document.getElementById("node0-queue").textContent = `Queue: ${data.queueSizes.central}`;
    document.getElementById("node1-queue").textContent = `Queue: ${data.queueSizes.partition1}`;
    document.getElementById("node2-queue").textContent = `Queue: ${data.queueSizes.partition2}`;
}

async function refreshQueueStatus() {
    const res = await fetch(`/failure/queue/status`);
    const data = await res.json();
    
    // Update queue displays
    document.getElementById("node0-queue").textContent = `Queue: ${data.central}`;
    document.getElementById("node1-queue").textContent = `Queue: ${data.partition1}`;
    document.getElementById("node2-queue").textContent = `Queue: ${data.partition2}`;
    
    // Highlight if there are queued writes
    document.getElementById("node0-queue").style.color = data.central > 0 ? "#FF4C4C" : "#FFA500";
    document.getElementById("node1-queue").style.color = data.partition1 > 0 ? "#FF4C4C" : "#FFA500";
    document.getElementById("node2-queue").style.color = data.partition2 > 0 ? "#FF4C4C" : "#FFA500";
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
