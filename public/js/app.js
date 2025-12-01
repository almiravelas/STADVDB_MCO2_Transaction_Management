document.addEventListener('DOMContentLoaded', () => {

    // 1. SIDEBAR TOGGLE
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        toggleBtn.querySelector('i').classList.toggle('bx-chevron-right');
        toggleBtn.querySelector('i').classList.toggle('bx-chevron-left');
    });

    // 2. CHART
    const ctx = document.getElementById('growthChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'New Users',
                data: [12, 19, 3, 5, 2, 15],
                borderColor: '#6C5CE7',
                backgroundColor: 'rgba(108, 92, 231, 0.1)',
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

    // 3. NAVIGATION
    const navButtons = document.querySelectorAll('[data-view]');
    const sections = document.querySelectorAll('.content-section');
    const title = document.getElementById('pageTitle');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            navButtons.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(view + '-section').classList.add('active');
            
            if(view === 'viewall') loadAllData();
            if(view === 'overview') updateStats();
            
            const titles = { overview: 'Dashboard', search: 'Search Database', country: 'Filter Location', viewall: 'All Records', health: 'System Health' };
            title.innerText = titles[view];
        });
    });

    // 4. HISTORY
    window.addTransaction = (type, name) => {
        const history = JSON.parse(localStorage.getItem('dbHistory')) || [];
        history.unshift({ type, name, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        if(history.length > 10) history.pop();
        localStorage.setItem('dbHistory', JSON.stringify(history));
        renderHistory();
    }
    window.clearHistory = () => { localStorage.removeItem('dbHistory'); renderHistory(); }

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
                        <p style="font-weight:600; font-size:14px; color:#2B3674; text-transform:capitalize;">${h.type}</p>
                        <p style="font-size:12px; color:#A0A5BA;">${h.name}</p>
                    </div>
                </div>`;
        });
    }
    renderHistory();

    // 5. SEARCH (BINDING BUTTONS)
    document.getElementById('searchForm').onsubmit = async (e) => {
        e.preventDefault();
        const q = document.getElementById('searchId').value;
        const resBox = document.getElementById('searchResult');
        try {
            let res = await fetch(`/api/users/search?id=${q}`);
            let data = await res.json();
            if(data.error || !data.id) { res = await fetch(`/api/users/search?name=${q}`); data = await res.json(); }
            
            if(data && (data.id || (Array.isArray(data) && data.length > 0))) {
                const u = Array.isArray(data) ? data[0] : data;
                resBox.style.display = 'block';
                document.getElementById('resultName').innerText = u.firstName + ' ' + u.lastName;
                document.getElementById('resultId').innerText = u.id;
                document.getElementById('resultCity').innerText = u.city;
                
                document.getElementById('btnEditSearch').onclick = () => editUser(u.id, u.firstName, u.lastName, u.username, u.city, u.country);
                document.getElementById('btnDeleteSearch').onclick = () => deleteUser(u.id, u.firstName);
                
            } else { alert("User not found"); resBox.style.display = 'none'; }
        } catch(e) { alert("User not found"); }
    };

    // 6. FILTER
    document.getElementById('countryForm').onsubmit = async (e) => {
        e.preventDefault();
        const c = document.getElementById('countrySelect').value;
        if(!c) return;
        const res = await fetch(`/api/users/search?country=${c}`);
        const users = await res.json();
        
        document.getElementById('usersList').style.display = 'block';
        const box = document.getElementById('usersContainer');
        box.innerHTML = '';
        
        if(users.length > 0) {
            users.forEach(u => {
                box.innerHTML += `
                    <div class="user-card-new">
                        <div class="uc-icon"><i class='bx bxs-user'></i></div>
                        <div class="uc-info">
                            <h4>${u.firstName} ${u.lastName}</h4>
                            <p>${u.city}</p>
                            <p style="font-size:11px; margin-top:2px; color:#6C5CE7;">ID: ${u.id}</p>
                        </div>
                    </div>`;
            });
        } else { box.innerHTML = '<p style="color:#aaa;">No users found.</p>'; }
    };

    // 7. VIEW ALL
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
                            <div class="action-gap">
                                <button class="btn-soft btn-soft-blue" onclick="editUser('${u.id}','${u.firstName}','${u.lastName}','${u.username}','${u.city}','${u.country}')"><i class='bx bx-edit-alt'></i></button>
                                <button class="btn-soft btn-soft-red" onclick="deleteUser('${u.id}','${u.firstName}')"><i class='bx bx-trash'></i></button>
                            </div>
                        </td>
                    </tr>`;
                });
            }
        } catch(e) { tbody.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>'; }
    }

    // 8. CRUD
    const modal = document.getElementById('userModal');
    document.getElementById('btnAddUser').onclick = () => { 
        modal.style.display='flex'; 
        document.getElementById('userForm').reset(); 
        document.getElementById('userId').value=''; 
        document.getElementById('modalTitle').innerText="Add New User"; 
    };
    document.getElementById('btnCancelModal').onclick = () => modal.style.display='none';

    document.getElementById('userForm').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('userId').value;
        const data = {
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            username: document.getElementById('username').value,
            city: document.getElementById('city').value,
            country: document.getElementById('country').value,
            gender: 'N/A'
        };
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/users/${id}` : '/api/users';
        try {
            await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
            addTransaction(id ? 'edit' : 'add', data.firstName);
            alert("Success!");
            modal.style.display='none';
            updateStats();
            if(document.getElementById('viewall-section').classList.contains('active')) loadAllData();
        } catch(e) { alert("Error: " + e.message); }
    };

    window.editUser = (id,f,l,u,c,co) => {
        modal.style.display='flex';
        document.getElementById('userId').value=id; document.getElementById('firstName').value=f;
        document.getElementById('lastName').value=l; document.getElementById('username').value=u;
        document.getElementById('city').value=c; document.getElementById('country').value=co;
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
    }
    updateStats();
});
