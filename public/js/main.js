document.addEventListener('DOMContentLoaded', () => {

    // 1. SIDEBAR TOGGLE
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        toggleBtn.querySelector('i').classList.toggle('bx-chevron-right');
        toggleBtn.querySelector('i').classList.toggle('bx-chevron-left');
    });

    // 2. CHART (Mock Data)
    const ctx = document.getElementById('growthChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'New Users',
                data: [12, 19, 3, 5, 2, 15],
                borderColor: '#4318FF',
                backgroundColor: 'rgba(67, 24, 255, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid:{borderDash:[5,5]} }, x:{grid:{display:false}} }
        }
    });

    // 3. NAVIGATION HANDLER
    const navButtons = document.querySelectorAll('[data-view]');
    const sections = document.querySelectorAll('.content-section');
    const title = document.getElementById('pageTitle');
    const breadcrumb = document.getElementById('breadcrumb');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            navButtons.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(view + '-section').classList.add('active');
            
            if(view === 'viewall') loadAllData();
            if(view === 'overview') updateStats();
            
            const titles = { 
                overview: 'Main Dashboard', 
                concurrency: 'Concurrency Lab',
                search: 'Search Database', 
                country: 'Filter Location', 
                viewall: 'All Records', 
                health: 'System Health' 
            };
            title.innerText = titles[view];
            breadcrumb.innerText = titles[view];
        });
    });

    // 4. CONCURRENCY LAB FUNCTIONS
    window.setCase = (num) => {
        const fA = document.getElementById('formA');
        const fB = document.getElementById('formB');
        
        // Reset badges
        window.updateBadge('A', num === 2 || num === 3 ? 'WRITE' : 'READ');
        window.updateBadge('B', num === 3 ? 'WRITE' : 'READ');

        if(num === 1) { // Read-Read
            fA.type.value = 'READ'; fA.sleepTime.value = 5;
            fB.type.value = 'READ'; fB.sleepTime.value = 1;
        } else if(num === 2) { // Write-Read
            fA.type.value = 'WRITE'; fA.sleepTime.value = 5; fA.updateText.value = "DIRTY_DATA";
            fB.type.value = 'READ'; fB.sleepTime.value = 1;
        } else if(num === 3) { // Write-Write
            fA.type.value = 'WRITE'; fA.sleepTime.value = 5; fA.updateText.value = "LOCK_HOLDER";
            fB.type.value = 'WRITE'; fB.sleepTime.value = 1;
        }
    };

    window.updateBadge = (trans, type) => {
        const badge = document.getElementById(`badge${trans}`);
        badge.innerText = type;
        if(type === 'WRITE') { badge.className = 'badge badge-write'; }
        else { badge.className = 'badge badge-read'; }
    };

    window.createTestUser = async () => {
        const data = { id: 101, username: 'sim_user', firstName: 'Original', lastName: 'User', country: 'Philippines', city: 'Manila' };
        try {
            await fetch('/api/users', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            alert("User 101 Created/Reset Successfully");
            addTransaction('add', 'User 101');
        } catch(e) { alert("Error creating user: " + e.message); }
    };

    window.runSimulation = async () => {
        // 1. Get the Global ID (or empty for random)
        const targetId = document.getElementById('simGlobalId').value.trim();
        
        // 2. Get Form Data
        const formA = new FormData(document.getElementById('formA'));
        const formB = new FormData(document.getElementById('formB'));
        
        // 3. Construct Payload with the Shared ID
        const dataA = { ...Object.fromEntries(formA.entries()), id: targetId };
        const dataB = { ...Object.fromEntries(formB.entries()), id: targetId };

        // UI Feedback
        document.getElementById('logA').innerHTML = ">> Transaction Started...";
        document.getElementById('logB').innerHTML = ">> Waiting 1s delay...";
        
        // Helper function to safely render logs
        const renderLogs = (elementId, data, error) => {
            const el = document.getElementById(elementId);
            if (error) {
                el.innerHTML = `<span style="color:red"><b>Frontend Error:</b> ${error}</span>`;
                return;
            }
            
            // SAFETY CHECK: Ensure logs exist and is an array
            const logContent = (data.logs && Array.isArray(data.logs)) 
                ? data.logs.join('<br>') 
                : `<span style="color:orange">Warning: No logs returned. (Backend may have crashed or returned: ${JSON.stringify(data)})</span>`;

            const idMsg = data.targetId ? `[ID: ${data.targetId}] ` : "";
            el.innerHTML = `<b>${idMsg}</b><br>` + logContent;
        };

        // 4. Execute Transaction A
        const pA = fetch('/api/simulate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(dataA)
        })
        .then(r => r.json())
        .then(d => renderLogs('logA', d))
        .catch(e => renderLogs('logA', null, e.message));

        // 5. Execute Transaction B (Delayed)
        await new Promise(r => setTimeout(r, 1000));
        
        const pB = fetch('/api/simulate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(dataB)
        })
        .then(r => r.json())
        .then(d => renderLogs('logB', d))
        .catch(e => renderLogs('logB', null, e.message));

        await Promise.all([pA, pB]);
    };

    // 5. GENERIC CRUD
    const modal = document.getElementById('userModal');
    document.getElementById('btnAddUser').onclick = () => { 
        modal.style.display='flex'; 
        document.getElementById('userForm').reset(); 
        document.getElementById('userId').disabled = false;
        document.getElementById('modalTitle').innerText="Add New User"; 
    };
    document.getElementById('btnCancelModal').onclick = () => modal.style.display='none';

    document.getElementById('userForm').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('userId').value;
        const data = {
            id: id,
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            username: document.getElementById('username').value,
            city: document.getElementById('city').value,
            country: document.getElementById('country').value
        };
        const method = document.getElementById('userId').disabled ? 'PUT' : 'POST';
        const url = document.getElementById('userId').disabled ? `/api/users/${id}` : '/api/users';
        
        try {
            await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
            addTransaction(method === 'POST' ? 'add' : 'edit', data.firstName);
            alert("Success!");
            modal.style.display='none';
            updateStats();
            if(document.getElementById('viewall-section').classList.contains('active')) loadAllData();
        } catch(e) { alert("Error: " + e.message); }
    };

    // 6. SHARED FUNCTIONS
    window.editUser = (id,f,l,u,c,co) => {
        modal.style.display='flex';
        document.getElementById('userId').value=id; 
        document.getElementById('userId').disabled=true; // ID cannot be changed on edit
        document.getElementById('firstName').value=f;
        document.getElementById('lastName').value=l; 
        document.getElementById('username').value=u;
        document.getElementById('city').value=c; 
        document.getElementById('country').value=co;
        document.getElementById('modalTitle').innerText="Edit User";
    };

    window.deleteUser = async (id, name) => {
        if(confirm(`Are you sure you want to delete ${name}?`)) {
            try {
                await fetch(`/api/users/${id}`, {method:'DELETE'});
                addTransaction('delete', name);
                alert("Deleted successfully");
                updateStats();
                if(document.getElementById('viewall-section').classList.contains('active')) loadAllData();
                document.getElementById('searchResult').style.display='none'; 
            } catch(e) { alert("Delete failed"); }
        }
    };

    window.loadAllData = async () => {
        const tbody = document.getElementById('allDataTableBody');
        tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
        try {
            const res = await fetch('/api/node/1/data?limit=50');
            const json = await res.json();
            tbody.innerHTML = '';
            if(json.data) {
                json.data.forEach(u => {
                    tbody.innerHTML += `
                    <tr>
                        <td style="padding:15px;">${u.id}</td>
                        <td>${u.username}</td>
                        <td>${u.firstName} ${u.lastName}</td>
                        <td>${u.country}</td>
                        <td style="text-align:right;">
                            <div style="display:flex; justify-content:flex-end; gap:5px;">
                                <button class="btn-soft btn-soft-blue" onclick="editUser('${u.id}','${u.firstName}','${u.lastName}','${u.username}','${u.city}','${u.country}')"><i class='bx bx-edit-alt'></i></button>
                                <button class="btn-soft btn-soft-red" onclick="deleteUser('${u.id}','${u.firstName}')"><i class='bx bx-trash'></i></button>
                            </div>
                        </td>
                    </tr>`;
                });
            }
        } catch(e) { tbody.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>'; }
    };

    window.updateStats = async () => {
        try {
            const res = await fetch('/api/health');
            const data = await res.json();
            document.getElementById('totalUsers').innerText = data.node0.rowCount || 0;
            
            const updateStatus = (id, s) => {
                const el = document.getElementById(id);
                if(s === 'connected') { el.style.background='#E2FBD7'; el.style.color='#34B53A'; el.innerText='Connected'; }
                else { el.style.background='#FFE5E5'; el.style.color='#FF4C4C'; el.innerText='Offline'; }
            };
            updateStatus('node0Status', data.node0.status);
            updateStatus('node1Status', data.node1.status);
            updateStatus('node2Status', data.node2.status);
        } catch(e) {}
    };

    // HISTORY HELPER
    window.addTransaction = (type, name) => {
        const history = JSON.parse(localStorage.getItem('dbHistory')) || [];
        history.unshift({ type, name, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        if(history.length > 10) history.pop();
        localStorage.setItem('dbHistory', JSON.stringify(history));
        renderHistory();
    };
    
    window.clearHistory = () => { localStorage.removeItem('dbHistory'); renderHistory(); };

    function renderHistory() {
        const list = document.getElementById('transactionList');
        const history = JSON.parse(localStorage.getItem('dbHistory')) || [];
        if(history.length === 0) { list.innerHTML = '<p style="color:#aaa; font-size:12px; text-align:center;">No recent activity</p>'; return; }

        list.innerHTML = '';
        history.forEach(h => {
            let color = '#6C5CE7', icon = 'bx-plus';
            if(h.type === 'edit') { color = '#2196F3'; icon = 'bx-pencil'; }
            if(h.type === 'delete') { color = '#FF5252'; icon = 'bx-trash'; }

            list.innerHTML += `
                <div class="history-item">
                    <div class="h-icon" style="background:${color};">
                        <i class='bx ${icon}'></i>
                    </div>
                    <div>
                        <p style="font-weight:600; font-size:14px; color:#2B3674; margin:0; text-transform:capitalize;">${h.type}</p>
                        <p style="font-size:12px; color:#A0A5BA; margin:0;">${h.name}</p>
                    </div>
                </div>`;
        });
    }
    renderHistory();
    updateStats();
});
