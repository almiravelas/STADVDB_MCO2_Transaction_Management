document.addEventListener('DOMContentLoaded', () => {

    // Helper to handle case-insensitive property names
    const getVal = (obj, ...keys) => {
        if (!obj) return 'undefined';
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return 'undefined';
    };

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

    window.deleteUser = async (id, name, country) => {
        if (!id || id === 'undefined') {
            alert("Error: Invalid User ID");
            return;
        }
        if(confirm(`Are you sure you want to delete ${name}?`)) {
            try {
                // Pass country as query param to help backend locate the record if missing in Central
                const url = country ? `/api/users/${id}?country=${encodeURIComponent(country)}` : `/api/users/${id}`;
                const res = await fetch(url, {method:'DELETE'});
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error || "Delete failed on server");
                }
                
                addTransaction('delete', name);
                alert("Deleted successfully");
                
                updateStats();
                
                // Always try to reload data if the table is visible/active
                const viewAllSection = document.getElementById('viewall-section');
                if(viewAllSection && viewAllSection.classList.contains('active')) {
                    console.log("Reloading data after delete...");
                    await loadAllData();
                }
                
                document.getElementById('searchResult').style.display='none'; 
            } catch(e) { 
                console.error(e);
                alert("Delete failed: " + e.message); 
            }
        }
    };

    // Pagination State
    let currentPage = 1;
    const pageSize = 10;

    window.loadAllData = async () => {
        const tbody = document.getElementById('allDataTableBody');
        const btnFirst = document.getElementById('btnFirstPage');
        const btnPrev = document.getElementById('btnPrevPage');
        const btnNext = document.getElementById('btnNextPage');
        const btnLast = document.getElementById('btnLastPage');
        const pageInfo = document.getElementById('pageInfo');

        tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
        try {
            const offset = (currentPage - 1) * pageSize;
            // Added timestamp to prevent caching
            const res = await fetch(`/api/node/1/data?limit=${pageSize}&offset=${offset}&_t=${new Date().getTime()}`);
            const json = await res.json();
            tbody.innerHTML = '';
            
            if(json.data && json.data.length > 0) {
                json.data.forEach(u => {
                    const fName = getVal(u, 'firstName', 'firstname', 'first_name', 'FirstName');
                    const lName = getVal(u, 'lastName', 'lastname', 'last_name', 'LastName');
                    const uId = getVal(u, 'id', 'ID', 'Id');
                    const cleanId = String(uId).trim();
                    const uUsername = getVal(u, 'username', 'Username');
                    const uCountry = getVal(u, 'country', 'Country');
                    const uCity = getVal(u, 'city', 'City');

                    tbody.innerHTML += `
                    <tr>
                        <td style="padding:15px;">${uId}</td>
                        <td>${uUsername}</td>
                        <td>${fName} ${lName}</td>
                        <td>${uCountry}</td>
                        <td style="text-align:right;">
                            <div style="display:flex; justify-content:flex-end; gap:5px;">
                                <button class="btn-soft btn-soft-blue" onclick="editUser('${cleanId}','${fName}','${lName}','${uUsername}','${uCity}','${uCountry}')"><i class='bx bx-edit-alt'></i></button>
                                <button class="btn-soft btn-soft-red" onclick="deleteUser('${cleanId}','${fName}', '${uCountry}')"><i class='bx bx-trash'></i></button>
                            </div>
                        </td>
                    </tr>`;
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">No more records found</td></tr>';
            }

            // Update Pagination UI
            const totalRows = json.totalRows || 0;
            const totalPages = Math.ceil(totalRows / pageSize);
            
            // Auto-adjust page if we deleted the last item on the current page
            if (currentPage > totalPages && totalPages > 0) {
                console.log("Current page is empty, moving to previous page...");
                currentPage = totalPages;
                await loadAllData(); // Recursive call to load the valid page
                return;
            }

            if(pageInfo) pageInfo.innerText = `Page ${currentPage} of ${totalPages}`;
            
            if(btnFirst) btnFirst.disabled = currentPage === 1;
            if(btnPrev) btnPrev.disabled = currentPage === 1;
            
            // Disable Next/Last if we are on the last page OR if there's no data
            const isLastPage = currentPage >= totalPages || totalPages === 0;
            if(btnNext) btnNext.disabled = isLastPage;
            if(btnLast) btnLast.disabled = isLastPage;

            // Store total pages globally or on the element for the Last button handler
            if(btnLast) btnLast.dataset.totalPages = totalPages;

        } catch(e) { 
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="5">Error loading data</td></tr>'; 
        }
    };

    // Pagination Event Listeners
    const btnFirst = document.getElementById('btnFirstPage');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');
    const btnLast = document.getElementById('btnLastPage');
    
    if(btnFirst) {
        btnFirst.addEventListener('click', () => {
            if(currentPage > 1) {
                currentPage = 1;
                loadAllData();
            }
        });
    }

    if(btnPrev) {
        btnPrev.addEventListener('click', () => {
            if(currentPage > 1) {
                currentPage--;
                loadAllData();
            }
        });
    }
    
    if(btnNext) {
        btnNext.addEventListener('click', () => {
            // We can check against totalPages stored in the dataset or just rely on the disabled state
            // But for safety, let's just increment. The button should be disabled if we are at the end.
            currentPage++;
            loadAllData();
        });
    }

    if(btnLast) {
        btnLast.addEventListener('click', () => {
            const totalPages = parseInt(btnLast.dataset.totalPages) || 1;
            if(currentPage < totalPages) {
                currentPage = totalPages;
                loadAllData();
            }
        });
    }

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

    // 7. SEARCH FUNCTIONALITY
    const searchForm = document.getElementById('searchForm');
    if (searchForm) {
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('searchId').value.trim();
            const resultDiv = document.getElementById('searchResult');
            
            if (!id) return;

            try {
                const res = await fetch(`/api/users/search?id=${id}`);
                if (!res.ok) throw new Error('User not found');
                const user = await res.json();
                console.log("Search Result:", user); 

                const firstName = getVal(user, 'firstName', 'firstname', 'first_name', 'FirstName', 'FIRST_NAME');
                const lastName = getVal(user, 'lastName', 'lastname', 'last_name', 'LastName', 'LAST_NAME');
                const city = getVal(user, 'city', 'City', 'CITY');
                const country = getVal(user, 'country', 'Country', 'COUNTRY');
                const userId = getVal(user, 'id', 'ID', 'Id', 'user_id', 'User_Id');
                const username = getVal(user, 'username', 'Username', 'USERNAME');

                document.getElementById('resultName').innerText = `${firstName} ${lastName}`;
                document.getElementById('resultId').innerText = userId;
                document.getElementById('resultCity').innerText = `${city}, ${country}`;
                
                document.getElementById('btnEditSearch').onclick = () => 
                    window.editUser(userId, firstName, lastName, username, city, country);
                
                document.getElementById('btnDeleteSearch').onclick = () => 
                    window.deleteUser(userId, firstName);

                resultDiv.style.display = 'block';
            } catch (err) {
                alert(err.message);
                resultDiv.style.display = 'none';
            }
        });
    }

    // 8. FILTER BY COUNTRY
    const countryForm = document.getElementById('countryForm');
    if (countryForm) {
        countryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const country = document.getElementById('countrySelect').value;
            const listDiv = document.getElementById('usersList');
            const container = document.getElementById('usersContainer');

            if (!country) return;

            try {
                const res = await fetch(`/api/users/search?country=${country}`);
                const users = await res.json();
                console.log("Filter Result:", users);

                container.innerHTML = '';
                
                if (!Array.isArray(users)) {
                    console.error("Expected array but got:", users);
                    container.innerHTML = '<p style="color:red">Error: Invalid response format</p>';
                    listDiv.style.display = 'block';
                    return;
                }

                if (users.length === 0) {
                    container.innerHTML = '<p>No users found in this location.</p>';
                } else {
                    users.forEach(u => {
                        const fName = getVal(u, 'firstName', 'firstname', 'first_name', 'FirstName', 'FIRST_NAME');
                        const lName = getVal(u, 'lastName', 'lastname', 'last_name', 'LastName', 'LAST_NAME');
                        const uId = getVal(u, 'id', 'ID', 'Id', 'user_id', 'User_Id');
                        const uCity = getVal(u, 'city', 'City', 'CITY');

                        container.innerHTML += `
                        <div style="background:#fff; padding:15px; border-radius:10px; border:1px solid #eee;">
                            <h4 style="margin:0 0 5px 0;">${fName} ${lName}</h4>
                            <p style="margin:0; font-size:12px; color:#888;">ID: ${uId}</p>
                            <p style="margin:0; font-size:12px; color:#888;">${uCity}</p>
                        </div>`;
                    });
                }
                listDiv.style.display = 'block';
            } catch (err) {
                console.error(err);
                alert("Error fetching data: " + err.message);
            }
        });
    }
});
