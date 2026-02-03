document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Server (Cold Start)
    await window.utils.checkServerAwake();

    // 2. Route Handling
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') initAuth();
    else if (path === '/dashboard') initDashboard();
    else if (path === '/profile') initProfile();
    else if (path === '/leaderboard') initLeaderboard();
});

/* ================= AUTH PAGE ================= */
function initAuth() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    // Check if already logged in
    fetch('/api/current-user').then(res => {
        if (res.ok) window.location.href = '/dashboard';
    });

    window.toggleAuth = (view) => {
        if (view === 'register') {
            loginForm.style.display = 'none';
            registerForm.style.display = 'block';
        } else {
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
        }
    };

    window.handleLogin = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        try {
            await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            }).then(async res => {
                if(res.ok) window.location.href = '/dashboard';
                else throw new Error((await res.json()).error);
            });
        } catch (err) { window.utils.showToast(err.message, 'error'); }
    };

    window.handleRegister = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        try {
            await fetch('/api/register', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            }).then(async res => {
                if(res.ok) window.location.href = '/dashboard';
                else throw new Error((await res.json()).error);
            });
        } catch (err) { window.utils.showToast(err.message, 'error'); }
    };
}

/* ================= DASHBOARD ================= */
let activeTimerInterval = null;
let pollInterval = null;

async function initDashboard() {
    await loadTasks();
    pollFriends();
    pollInterval = setInterval(pollFriends, 8000);

    // Logout handler
    document.getElementById('logout-btn').onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    };
}

async function loadTasks() {
    const data = await window.utils.apiFetch('/api/tasks/today');
    if (!data) return;
    
    const container = document.getElementById('tasks-list');
    const activeContainer = document.getElementById('active-task-container');
    container.innerHTML = '';
    activeContainer.innerHTML = '';

    if (activeTimerInterval) clearInterval(activeTimerInterval);

    let hasActive = false;
    let totalEst = 0;
    
    data.tasks.forEach(task => {
        totalEst += task.estimated_minutes;
        if (task.status === 'in_progress') {
            hasActive = true;
            renderActiveTask(task, activeContainer);
        } else {
            renderTaskRow(task, container);
        }
    });

    if (data.tasks.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center; color:var(--text-muted)">No tasks yet. Plan your day!</div>`;
    }

    // Update buttons
    const planBtn = document.getElementById('plan-btn');
    const endBtn = document.getElementById('end-btn');
    if (data.dayEnded) {
        planBtn.disabled = true;
        endBtn.disabled = true;
        planBtn.textContent = "Day Ended";
        document.getElementById('day-ended-banner').style.display = 'flex';
    }
}

function renderTaskRow(task, container) {
    const div = document.createElement('div');
    div.className = 'task-card';
    let statusIcon = '⏳';
    let statusClass = '';
    let actionBtns = '';

    if (task.status === 'completed_ontime') { statusIcon = '✅'; statusClass = 'text-success'; }
    else if (task.status === 'completed_delayed') { statusIcon = '⏰'; statusClass = 'text-warning'; }
    else if (task.status === 'skipped') { statusIcon = '❌'; statusClass = 'text-muted'; }
    else if (task.status === 'paused') {
        statusIcon = '⏸'; 
        statusClass = 'text-warning';
        actionBtns = `
            <button class="btn btn-primary btn-sm" onclick="startTask(${task.id})">▶ Resume</button>
            <button class="btn btn-sm" onclick="skipTask(${task.id})">Skip</button>
        `;
    }
    else {
        // Pending
        actionBtns = `
            <button class="btn btn-primary btn-sm" onclick="startTask(${task.id})">▶ Start</button>
            <button class="btn btn-sm" onclick="skipTask(${task.id})">Skip</button>
        `;
    }

    div.innerHTML = `
        <div class="task-header">
            <span class="subject-tag ${task.subject.toLowerCase()}">${task.subject}</span>
            <span class="${statusClass}">${statusIcon} ${task.status.replace('_', ' ')}</span>
        </div>
        <h3 class="task-name">${task.task_name}</h3>
        <div class="task-meta">⏱️ Est: ${window.utils.formatDuration(task.estimated_minutes)}</div>
        <div class="task-actions">${actionBtns}</div>
    `;
    container.appendChild(div);
}

function renderActiveTask(task, container) {
    const startedAt = new Date(task.started_at).getTime();
    const accumulated = task.accumulated_seconds || 0;
    const estSeconds = task.estimated_minutes * 60;
    
    container.innerHTML = `
        <div class="active-task-card">
            <div class="active-task-label">▶ NOW STUDYING</div>
            <h2>${task.task_name}</h2>
            <span class="subject-tag ${task.subject.toLowerCase()}">${task.subject}</span>
            <div class="circular-progress">
                <svg viewBox="0 0 120 120">
                    <circle class="progress-bg" cx="60" cy="60" r="54"/>
                    <circle id="prog-circle" class="progress-fill" cx="60" cy="60" r="54" stroke-dasharray="339.29" stroke-dashoffset="0"/>
                </svg>
                <div class="timer-text">
                    <span id="timer-elapsed" class="elapsed">00:00</span>
                    <span class="estimated">/ ${window.utils.formatDuration(task.estimated_minutes)}</span>
                </div>
            </div>
            <div class="timer-controls">
                <button class="btn btn-warning" onclick="pauseTask(${task.id})">⏸ Pause</button>
                <button class="btn btn-success" onclick="completeTask(${task.id})">✓ Done</button>
                <button class="btn btn-danger" onclick="skipTask(${task.id})">✗ Skip</button>
            </div>
        </div>
    `;

    const circle = document.getElementById('prog-circle');
    const text = document.getElementById('timer-elapsed');
    const circumference = 339.29;

    const updateTimer = () => {
        const now = Date.now();
        // Total time = current session time + previously accumulated time
        const currentSessionSec = Math.floor((now - startedAt) / 1000);
        const totalSec = currentSessionSec + accumulated;
        
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');
        text.textContent = `${m}:${s}`;

        const pct = Math.min(totalSec / estSeconds, 1);
        const offset = circumference * (1 - pct);
        circle.style.strokeDashoffset = offset;
        
        if (totalSec > estSeconds) {
            circle.style.stroke = 'var(--error-red)';
            text.style.color = 'var(--error-red)';
        }
    };
    
    updateTimer(); // Initial call
    activeTimerInterval = setInterval(updateTimer, 1000);
}

// --- Task Actions ---
window.startTask = async (id) => {
    try {
        await window.utils.apiFetch(`/api/tasks/${id}/start`, { method: 'POST' });
        loadTasks();
    } catch (e) { /* handled by fetch wrapper */ }
};

window.pauseTask = async (id) => {
    try {
        await window.utils.apiFetch(`/api/tasks/${id}/pause`, { method: 'POST' });
        loadTasks();
    } catch (e) { /* handled by fetch wrapper */ }
};

window.completeTask = async (id) => {
    await window.utils.apiFetch(`/api/tasks/${id}/complete`, { method: 'POST' });
    loadTasks();
};

window.skipTask = async (id) => {
    await window.utils.apiFetch(`/api/tasks/${id}/skip`, { method: 'POST' });
    loadTasks();
};

// --- Planning Modal ---
window.openPlanModal = () => {
    const body = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = "Plan Your Day";
    body.innerHTML = `
        <div id="plan-rows"></div>
        <button class="btn btn-sm" onclick="addPlanRow()" style="width:100%; margin-top:10px">+ Add Task</button>
        <div style="margin-top:20px; display:flex; gap:10px">
            <button class="btn btn-primary" style="flex:1" onclick="submitPlan()">Save Tasks</button>
            <button class="btn" style="flex:1" onclick="utils.closeModal()">Cancel</button>
        </div>
    `;
    addPlanRow(); // Add first row
    window.utils.openModal();
};

window.addPlanRow = () => {
    const container = document.getElementById('plan-rows');
    const div = document.createElement('div');
    div.className = 'task-entry-row';
    div.innerHTML = `
        <input type="text" placeholder="Task name" class="p-name" required>
        <select class="p-subj" style="width:100px"><option>Maths</option><option>Physics</option><option>Chemistry</option><option>Other</option></select>
        <select class="p-time" style="width:100px">
            <option value="30">30m</option><option value="45">45m</option><option value="60">1h</option><option value="90">1.5h</option><option value="120">2h</option>
        </select>
        <button class="btn-close" style="font-size:18px" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
};

window.submitPlan = async () => {
    const rows = document.querySelectorAll('.task-entry-row');
    const tasks = [];
    rows.forEach(row => {
        const name = row.querySelector('.p-name').value;
        if(name) {
            tasks.push({
                task_name: name,
                subject: row.querySelector('.p-subj').value,
                estimated_minutes: parseInt(row.querySelector('.p-time').value)
            });
        }
    });
    
    if(tasks.length === 0) return window.utils.showToast('Add at least one task', 'error');

    await window.utils.apiFetch('/api/tasks/batch-add', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ tasks })
    });
    window.utils.closeModal();
    loadTasks();
};

// --- End Day Modal ---
window.openEndDayModal = () => {
    const body = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = "End Your Day";
    body.innerHTML = `
        <label>Maths Problems</label><input type="number" id="ed-m" value="0">
        <label>Physics Problems</label><input type="number" id="ed-p" value="0">
        <label>Chem Problems</label><input type="number" id="ed-c" value="0">
        <label>Topics Covered</label><textarea id="ed-topics"></textarea>
        <label>Notes</label><textarea id="ed-notes"></textarea>
        <label>Rating (1-5)</label>
        <div class="star-rating" id="star-rating">
            <span onclick="setRating(1)">★</span><span onclick="setRating(2)">★</span><span onclick="setRating(3)">★</span><span onclick="setRating(4)">★</span><span onclick="setRating(5)">★</span>
        </div>
        <button class="btn btn-success" style="width:100%; margin-top:15px" onclick="submitEndDay()">Confirm End Day</button>
    `;
    window.currentRating = 0;
    window.utils.openModal();
};

window.setRating = (r) => {
    window.currentRating = r;
    const stars = document.querySelectorAll('#star-rating span');
    stars.forEach((s, i) => s.style.color = i < r ? 'var(--warning-orange)' : 'rgba(255,255,255,0.2)');
};

window.submitEndDay = async () => {
    if (!window.currentRating) return window.utils.showToast('Please rate your day', 'error');
    
    const data = {
        maths_problems: document.getElementById('ed-m').value,
        physics_problems: document.getElementById('ed-p').value,
        chemistry_problems: document.getElementById('ed-c').value,
        topics_covered: document.getElementById('ed-topics').value,
        notes: document.getElementById('ed-notes').value,
        self_rating: window.currentRating
    };

    await window.utils.apiFetch('/api/summary/end-day', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    window.utils.closeModal();
    loadTasks();
};

// --- Polling Friends ---
async function pollFriends() {
    const currentUserRes = await fetch('/api/current-user');
    if(!currentUserRes.ok) return;
    const currentUser = await currentUserRes.json();
    
    const data = await window.utils.apiFetch('/api/feed/active');
    const container = document.getElementById('friends-container');
    const panel = document.getElementById('friend-todo-panel');
    
    // Clear logic requires careful state management to not break open panels
    // For simplicity, we rebuild, but keep panel state if ID matches
    const openId = panel.dataset.userId; 
    container.innerHTML = '';

    data.users.forEach(user => {
        if (user.id === currentUser.user.id) return; // Don't show self

        const wrapper = document.createElement('div');
        wrapper.className = 'friend-circle-wrapper';
        if(openId == user.id) wrapper.classList.add('selected');
        wrapper.onclick = () => toggleFriendPanel(user.id);

        let circleContent = '';
        let strokeDashoffset = 263; // Full circle (approx)
        let strokeColor = '#333';

        if (user.activeTask) {
            // Calculate active progress
            const started = new Date(user.activeTask.started_at).getTime();
            const accumulated = user.activeTask.accumulated_seconds || 0;
            const estSec = user.activeTask.estimated_minutes * 60;
            const currentSessionSec = (Date.now() - started) / 1000;
            const totalSec = currentSessionSec + accumulated;
            
            const pct = Math.min(totalSec / estSec, 1.2); // Cap visually
            strokeDashoffset = 263 * (1 - pct);
            
            // Map subject to color
            const colors = {Maths:'var(--subject-maths)',Physics:'var(--subject-physics)',Chemistry:'var(--subject-chemistry)',Other:'var(--subject-other)'};
            strokeColor = colors[user.activeTask.subject] || '#fff';

            circleContent = `
                <div class="circle-active-info">
                    <div style="font-weight:700">${Math.floor(totalSec/60)}m</div>
                    <div class="subject-tag ${user.activeTask.subject.toLowerCase()}" style="font-size:9px; padding:2px 4px">${user.activeTask.subject.substr(0,3)}</div>
                </div>
            `;
        } else {
             circleContent = `<div style="font-size:18px; font-weight:700">${user.name.charAt(0)}</div>`;
        }

        const dotClass = user.activeTask ? 'active' : (user.dayEnded ? '' : ''); // Active green, else gray
        const dotStyle = user.dayEnded ? 'background:var(--accent-purple)' : '';

        wrapper.innerHTML = `
            <div class="friend-circle">
                <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.1)" fill="none" stroke-width="4"/>
                    <circle cx="50" cy="50" r="42" fill="none" stroke-width="4" stroke="${strokeColor}" stroke-linecap="round" stroke-dasharray="263" stroke-dashoffset="${strokeDashoffset}"/>
                </svg>
                <div class="circle-inner">${circleContent}</div>
            </div>
            <div class="circle-name">${user.name}</div>
            <div class="circle-status-dot ${dotClass}" style="${dotStyle}"></div>
        `;
        container.appendChild(wrapper);
    });

    // Stats
    const statsContainer = document.getElementById('mini-leaderboard');
    // Simplified logic: just list users active stats
    let statsHtml = '';
    data.users.sort((a,b) => b.todayStats.ontime - a.todayStats.ontime).forEach(u => {
        statsHtml += `<div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.05)">
            <span>${u.name}</span>
            <span>✅ ${u.todayStats.ontime}</span>
        </div>`;
    });
    statsContainer.innerHTML = statsHtml;
}

window.toggleFriendPanel = async (userId) => {
    const panel = document.getElementById('friend-todo-panel');
    const currentId = panel.dataset.userId;

    if (currentId == userId && panel.classList.contains('open')) {
        panel.classList.remove('open');
        panel.dataset.userId = '';
        document.querySelectorAll('.friend-circle-wrapper').forEach(el => el.classList.remove('selected'));
        return;
    }

    // Load Data
    const data = await window.utils.apiFetch(`/api/tasks/user/${userId}`);
    
    // Render
    document.getElementById('fp-name').textContent = data.userName + "'s Tasks";
    const list = document.getElementById('fp-list');
    list.innerHTML = '';
    
    data.tasks.forEach(task => {
        let status = task.status === 'in_progress' ? '⏱ Active' : (task.status.includes('completed') ? '✅ Done' : (task.status==='skipped'?'❌': (task.status==='paused'?'⏸ Paused':'⏳')));
        if(task.status === 'in_progress') {
             const mins = Math.floor((Date.now() - new Date(task.started_at).getTime())/60000);
             const accumulatedMins = Math.floor((task.accumulated_seconds || 0)/60);
             status = `⏱ ${mins + accumulatedMins}m`;
        }
        
        list.innerHTML += `
            <div class="friend-task-row">
                <span class="subject-tag ${task.subject.toLowerCase()}">${task.subject.substr(0,1)}</span>
                <span class="ftask-name">${task.task_name}</span>
                <span style="color:var(--text-muted)">${task.estimated_minutes}m</span>
                <span style="margin-left:auto; font-weight:600">${status}</span>
            </div>
        `;
    });

    panel.dataset.userId = userId;
    panel.classList.add('open');
    
    // Highlight circle
    document.querySelectorAll('.friend-circle-wrapper').forEach(el => el.classList.remove('selected'));
    // Need to find the wrapper again (simple hack: clicking adds class, but here we redraw active feed often)
    // The polling function handles the 'selected' class based on dataset.userId
    pollFriends(); // Refresh UI immediately to show selection
};

window.closeFriendPanel = () => {
    const panel = document.getElementById('friend-todo-panel');
    panel.classList.remove('open');
    panel.dataset.userId = '';
    pollFriends();
};

/* ================= PROFILE ================= */
async function initProfile() {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId') || (await (await fetch('/api/current-user')).json()).user.id;
    
    const data = await window.utils.apiFetch(`/api/users/${userId}/profile`);
    const u = data.user;
    const s = data.stats;
    const w = data.week_stats;

    // Header
    document.querySelector('.profile-name').textContent = u.name;
    document.querySelector('.profile-username').textContent = '@' + u.username;
    document.querySelector('.profile-avatar').textContent = u.name.charAt(0);
    
    // Stats
    const grids = document.querySelectorAll('.stat-value');
    grids[0].textContent = s.total_tasks;
    grids[1].textContent = s.success_rate + '%';
    grids[2].textContent = s.total_study_hours + 'h';
    grids[3].textContent = u.current_streak + '🔥';

    // Week
    document.getElementById('week-summary-text').innerHTML = 
        `Tasks: ${w.tasks} &nbsp; On-time: ${w.ontime} &nbsp; Rate: ${w.success_rate}% &nbsp; Hours: ${w.study_hours}h`;

    // History (fetch default)
    loadHistory(userId);

    // Filter Listeners
    document.getElementById('filter-apply').onclick = () => loadHistory(userId);
}

async function loadHistory(userId) {
    const start = document.getElementById('f-start').value;
    const end = document.getElementById('f-end').value;
    const subj = document.getElementById('f-subj').value;
    
    let url = `/api/users/${userId}/history?`;
    if(start) url += `startDate=${start}&`;
    if(end) url += `endDate=${end}&`;
    if(subj) url += `subject=${subj}`;

    const data = await window.utils.apiFetch(url);
    const list = document.getElementById('history-list');
    list.innerHTML = '';

    // Group by date
    const grouped = {};
    data.tasks.forEach(t => {
        if(!grouped[t.task_date]) grouped[t.task_date] = [];
        grouped[t.task_date].push(t);
    });

    Object.keys(grouped).forEach(date => {
        let html = `<h3 style="margin-top:20px; font-size:14px; color:var(--accent-blue)">${date}</h3>`;
        grouped[date].forEach(t => {
            let status = t.status.replace('_', ' ');
            html += `
                <div style="display:flex; justify-content:space-between; padding:10px; background:rgba(255,255,255,0.03); margin-top:5px; border-radius:8px; font-size:13px">
                    <span><span class="subject-tag ${t.subject.toLowerCase()}">${t.subject}</span> ${t.task_name}</span>
                    <span style="color:var(--text-muted)">${status}</span>
                </div>
            `;
        });
        list.innerHTML += html;
    });
}

/* ================= LEADERBOARD ================= */
async function initLeaderboard() {
    loadLeaderboard('weekly');
    window.switchTab = (period) => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab[onclick="switchTab('${period}')"]`).classList.add('active');
        loadLeaderboard(period);
    };
}

async function loadLeaderboard(period) {
    const data = await window.utils.apiFetch(`/api/leaderboard?period=${period}`);
    const list = document.getElementById('lb-list');
    list.innerHTML = '';
    
    const currentUser = (await (await fetch('/api/current-user')).json()).user.id;

    data.rankings.forEach((r, idx) => {
        const rankClass = idx === 0 ? 'rank-1' : '';
        const isMe = r.id === currentUser ? 'border: 1px solid var(--accent-blue)' : '';
        
        list.innerHTML += `
            <div class="leaderboard-card ${rankClass}" style="${isMe}">
                <div class="rank-number">${idx === 0 ? '🏆' : '#' + (idx + 1)}</div>
                <div style="flex-grow:1">
                    <h3 style="font-size:16px">${r.name}</h3>
                    <div class="lb-stats">
                        ✅ ${r.ontime} on-time &nbsp; ⏱️ ${r.study_hours}h studied &nbsp; 📊 ${r.success_rate}% success
                    </div>
                </div>
                <div style="font-size:20px; font-weight:bold; color:var(--text-muted)">${r.total} tasks</div>
            </div>
        `;
    });
}