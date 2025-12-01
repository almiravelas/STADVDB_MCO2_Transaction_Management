const logBox = document.getElementById("failureLog");

function appendLog(msg) {
    logBox.textContent += msg + "\n";
    logBox.scrollTop = logBox.scrollHeight;
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
}

async function nodeOff(id) {
    const res = await fetch(`/failure/node/${id}/off`, { method: "POST" });
    const data = await res.json();
    appendLog(data.message);
    document.getElementById(`node${id+1}-status`).textContent = "OFFLINE";
    document.getElementById(`node${id+1}-status`).style.color = "#FF4C4C";
}

async function nodeOn(id) {
    const res = await fetch(`/failure/node/${id}/on`, { method: "POST" });
    const data = await res.json();
    appendLog(data.message);
    document.getElementById(`node${id+1}-status`).textContent = "ONLINE";
    document.getElementById(`node${id+1}-status`).style.color = "#34B53A";
}

async function runCase1() {
    appendLog("Running Case #1...");
    const res = await fetch(`/failure/case1`, { method: "POST" });
    const data = await res.json();
    data.logs.forEach(appendLog);
}

async function runCase2() {
    appendLog("Running Case #2...");
    const res = await fetch(`/failure/case2`, { method: "POST" });
    const data = await res.json();
    data.logs.forEach(appendLog);
}

async function runCase3() {
    appendLog("Running Case #3...");
    const res = await fetch(`/failure/case3`, { method: "POST" });
    const data = await res.json();
    data.logs.forEach(appendLog);
}

async function runCase4() {
    appendLog("Running Case #4...");
    const res = await fetch(`/failure/case4`, { method: "POST" });
    const data = await res.json();
    data.logs.forEach(appendLog);
}
