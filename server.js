const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
const db = new Database(path.join(__dirname, 'jee_study.db'));
db.pragma('journal_mode = DELETE'); // NOT WAL, saves storage
db.pragma('foreign_keys = ON');

// Create tables on startup
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        current_streak INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0,
        last_active_date TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_name TEXT NOT NULL,
        subject TEXT,
        estimated_minutes INTEGER NOT NULL,
        actual_minutes INTEGER,
        status TEXT DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        task_date TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS daily_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        summary_date TEXT NOT NULL,
        maths_problems INTEGER DEFAULT 0,
        physics_problems INTEGER DEFAULT 0,
        chemistry_problems INTEGER DEFAULT 0,
        topics_covered TEXT,
        total_study_hours REAL DEFAULT 0,
        notes TEXT,
        self_rating INTEGER,
        tasks_completed INTEGER DEFAULT 0,
        tasks_total INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,
        ended_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, summary_date)
    );
    CREATE TABLE IF NOT EXISTS active_sessions (
        user_id INTEGER PRIMARY KEY,
        active_task_id INTEGER,
        started_at TEXT,
        last_seen TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`);

// --- Middleware ---
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'jee-study-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// --- Auth Middleware ---
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// --- Helper: get today's date as YYYY-MM-DD ---
function todayDate() {
    return new Date().toISOString().split('T')[0];
}

// --- Helper: check if user has ended day for today ---
function hasDayEnded(userId) {
    const summary = db.prepare(
        'SELECT id FROM daily_summaries WHERE user_id = ? AND summary_date = ?'
    ).get(userId, todayDate());
    return !!summary;
}

// =====================================================================
// ROUTES
// =====================================================================

// --- Health Check (no auth needed) ---
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// --- Register ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, name } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ error: 'Username, password, and name are required' });
        }
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ error: 'Username must be 3-20 chars, alphanumeric or underscore only' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        if (name.trim().length === 0 || name.trim().length > 50) {
            return res.status(400).json({ error: 'Name must be 1-50 characters' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db.prepare(
            'INSERT INTO users (username, password, name) VALUES (?, ?, ?)'
        ).run(username, hashedPassword, name.trim());

        req.session.userId = result.lastInsertRowid;
        req.session.username = username;

        res.json({ success: true, user: { id: result.lastInsertRowid, name: name.trim(), username } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Login ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({ success: true, user: { id: user.id, name: user.name, username: user.username } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Logout ---
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- Current User ---
app.get('/api/current-user', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
        req.session.destroy();
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ user });
});

// --- All Users ---
app.get('/api/users', requireAuth, (req, res) => {
    const users = db.prepare('SELECT id, name, username FROM users').all();
    res.json({ users });
});

// --- Batch Add Tasks ---
app.post('/api/tasks/batch-add', requireAuth, (req, res) => {
    try {
        const { tasks } = req.body;
        const userId = req.session.userId;

        if (!Array.isArray(tasks) || tasks.length === 0) {
            return res.status(400).json({ error: 'Tasks array is required and must not be empty' });
        }
        if (tasks.length > 20) {
            return res.status(400).json({ error: 'Maximum 20 tasks per batch' });
        }
        if (hasDayEnded(userId)) {
            return res.status(400).json({ error: 'You have already ended your day. Start a new day first.' });
        }

        const validSubjects = ['Maths', 'Physics', 'Chemistry', 'Other'];
        const today = todayDate();

        const insertStmt = db.prepare(
            'INSERT INTO tasks (user_id, task_name, subject, estimated_minutes, task_date) VALUES (?, ?, ?, ?, ?)'
        );

        const insertAll = db.transaction(() => {
            for (const task of tasks) {
                if (!task.task_name || !task.task_name.trim()) {
                    throw new Error('Each task must have a name');
                }
                const est = parseInt(task.estimated_minutes);
                if (isNaN(est) || est < 5 || est > 720) {
                    throw new Error('Estimated minutes must be between 5 and 720');
                }
                const subj = validSubjects.includes(task.subject) ? task.subject : 'Other';
                insertStmt.run(userId, task.task_name.trim(), subj, est, today);
            }
        });

        insertAll();
        res.json({ success: true, count: tasks.length });
    } catch (err) {
        console.error('Batch add error:', err);
        res.status(400).json({ error: err.message || 'Failed to add tasks' });
    }
});

// --- Start Task ---
app.post('/api/tasks/:id/start', requireAuth, (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const userId = req.session.userId;

        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (task.status !== 'pending') return res.status(400).json({ error: 'Task is not in pending status' });

        const activeSession = db.prepare('SELECT * FROM active_sessions WHERE user_id = ?').get(userId);
        if (activeSession) return res.status(400).json({ error: 'You already have an active task.' });

        const now = new Date().toISOString();
        db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?').run('in_progress', now, taskId);
        db.prepare('INSERT OR REPLACE INTO active_sessions (user_id, active_task_id, started_at, last_seen) VALUES (?, ?, ?, ?)').run(userId, taskId, now, now);

        res.json({ success: true, task: { id: taskId, started_at: now } });
    } catch (err) {
        console.error('Start task error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Complete Task ---
app.post('/api/tasks/:id/complete', requireAuth, (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const userId = req.session.userId;

        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (task.status !== 'in_progress') return res.status(400).json({ error: 'Task is not in progress' });

        const now = new Date().toISOString();
        const startedAt = new Date(task.started_at);
        const actualMinutes = Math.round((new Date(now) - startedAt) / 60000);
        const status = actualMinutes <= task.estimated_minutes ? 'completed_ontime' : 'completed_delayed';

        db.prepare('UPDATE tasks SET status = ?, completed_at = ?, actual_minutes = ? WHERE id = ?')
            .run(status, now, actualMinutes, taskId);

        db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(userId);

        res.json({ success: true, task: { id: taskId, status, actual_minutes: actualMinutes } });
    } catch (err) {
        console.error('Complete task error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Skip Task ---
app.post('/api/tasks/:id/skip', requireAuth, (req, res) => {
    try {
        const taskId = parseInt(req.params.id);
        const userId = req.session.userId;

        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (['skipped', 'completed_ontime', 'completed_delayed'].includes(task.status)) {
            return res.status(400).json({ error: 'Task is already completed or skipped' });
        }

        db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('skipped', taskId);

        const activeSession = db.prepare('SELECT * FROM active_sessions WHERE user_id = ? AND active_task_id = ?').get(userId, taskId);
        if (activeSession) {
            db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(userId);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Skip task error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Get Today's Tasks (current user) ---
app.get('/api/tasks/today', requireAuth, (req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? AND task_date = ? ORDER BY created_at ASC')
        .all(req.session.userId, todayDate());
    const dayEnded = hasDayEnded(req.session.userId);
    res.json({ tasks, dayEnded });
});

// --- Get Tasks for a specific user (today) ---
app.get('/api/tasks/user/:userId', requireAuth, (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? AND task_date = ? ORDER BY created_at ASC')
        .all(userId, todayDate());
    const dayEnded = hasDayEnded(userId);
    res.json({ tasks, dayEnded, userName: user.name });
});

// --- Live Feed (Active users today) ---
app.get('/api/feed/active', requireAuth, (req, res) => {
    const users = db.prepare('SELECT id, name, username FROM users').all();
    const today = todayDate();

    const result = users.map(user => {
        const session = db.prepare('SELECT * FROM active_sessions WHERE user_id = ?').get(user.id);
        let activeTask = null;
        if (session) {
            activeTask = db.prepare('SELECT id, task_name, subject, started_at, estimated_minutes FROM tasks WHERE id = ?').get(session.active_task_id);
        }

        const stats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed_ontime' THEN 1 ELSE 0 END) as ontime,
                SUM(CASE WHEN status = 'completed_delayed' THEN 1 ELSE 0 END) as delayed,
                SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
            FROM tasks WHERE user_id = ? AND task_date = ?
        `).get(user.id, today);

        const dayEnded = hasDayEnded(user.id);

        return {
            id: user.id,
            name: user.name,
            username: user.username,
            activeTask,
            todayStats: { total: stats.total || 0, ontime: stats.ontime || 0, delayed: stats.delayed || 0, skipped: stats.skipped || 0 },
            dayEnded
        };
    });

    res.json({ users: result });
});

// --- User Profile ---
app.get('/api/users/:userId/profile', requireAuth, (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = db.prepare('SELECT id, name, username, created_at, current_streak, best_streak FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const allStats = db.prepare(`
        SELECT
            COUNT(*) as total_tasks,
            SUM(CASE WHEN status = 'completed_ontime' THEN 1 ELSE 0 END) as completed_ontime,
            SUM(CASE WHEN status = 'completed_delayed' THEN 1 ELSE 0 END) as completed_delayed,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
            COALESCE(SUM(actual_minutes), 0) as total_minutes
        FROM tasks WHERE user_id = ?
    `).get(userId);

    const successRate = allStats.total_tasks > 0 ? Math.round((allStats.completed_ontime || 0) / allStats.total_tasks * 100) : 0;

    const today = new Date();
    const dayOfWeek = today.getDay(); 
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const mondayStr = monday.toISOString().split('T')[0];
    const todayStr = todayDate();

    const weekStats = db.prepare(`
        SELECT
            COUNT(*) as tasks,
            SUM(CASE WHEN status = 'completed_ontime' THEN 1 ELSE 0 END) as ontime,
            SUM(CASE WHEN status = 'completed_delayed' THEN 1 ELSE 0 END) as delayed,
            COALESCE(SUM(actual_minutes), 0) as total_minutes
        FROM tasks WHERE user_id = ? AND task_date >= ? AND task_date <= ?
    `).get(userId, mondayStr, todayStr);

    const weekSuccessRate = weekStats.tasks > 0 ? Math.round((weekStats.ontime || 0) / weekStats.tasks * 100) : 0;

    const recentSummaries = db.prepare(
        'SELECT * FROM daily_summaries WHERE user_id = ? ORDER BY summary_date DESC LIMIT 7'
    ).all(userId);

    res.json({
        user,
        stats: {
            total_tasks: allStats.total_tasks,
            completed_ontime: allStats.completed_ontime || 0,
            completed_delayed: allStats.completed_delayed || 0,
            skipped: allStats.skipped || 0,
            success_rate: successRate,
            total_study_hours: Math.round((allStats.total_minutes || 0) / 60 * 10) / 10
        },
        week_stats: {
            tasks: weekStats.tasks,
            ontime: weekStats.ontime || 0,
            delayed: weekStats.delayed || 0,
            study_hours: Math.round((weekStats.total_minutes || 0) / 60 * 10) / 10,
            success_rate: weekSuccessRate
        },
        recent_summaries: recentSummaries
    });
});

// --- User Task History ---
app.get('/api/users/:userId/history', requireAuth, (req, res) => {
    const userId = parseInt(req.params.userId);
    const { startDate, endDate, subject } = req.query;

    let query = 'SELECT * FROM tasks WHERE user_id = ?';
    const params = [userId];

    if (startDate) { query += ' AND task_date >= ?'; params.push(startDate); }
    if (endDate)   { query += ' AND task_date <= ?'; params.push(endDate); }
    if (subject)   { query += ' AND subject = ?'; params.push(subject); }

    query += ' ORDER BY task_date DESC, created_at ASC LIMIT 200';

    const tasks = db.prepare(query).all(...params);
    res.json({ tasks });
});

// --- Daily Summary ---
app.get('/api/summary/user/:userId/date/:date', requireAuth, (req, res) => {
    const summary = db.prepare(
        'SELECT * FROM daily_summaries WHERE user_id = ? AND summary_date = ?'
    ).get(parseInt(req.params.userId), req.params.date);
    res.json({ summary: summary || null });
});

// --- End Day ---
app.post('/api/summary/end-day', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        const today = todayDate();

        if (hasDayEnded(userId)) return res.status(400).json({ error: 'You have already ended your day today.' });

        const { maths_problems, physics_problems, chemistry_problems, topics_covered, notes, self_rating } = req.body;
        const rating = parseInt(self_rating);
        if (isNaN(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Self-rating must be 1-5' });

        db.prepare("UPDATE tasks SET status = 'skipped' WHERE user_id = ? AND task_date = ? AND status IN ('pending', 'in_progress')")
            .run(userId, today);

        db.prepare('DELETE FROM active_sessions WHERE user_id = ?').run(userId);

        const stats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed_ontime' THEN 1 ELSE 0 END) as ontime,
                SUM(CASE WHEN status = 'completed_delayed' THEN 1 ELSE 0 END) as delayed,
                COALESCE(SUM(CASE WHEN actual_minutes IS NOT NULL THEN actual_minutes ELSE 0 END), 0) as total_minutes
            FROM tasks WHERE user_id = ? AND task_date = ?
        `).get(userId, today);

        const tasksCompleted = (stats.ontime || 0) + (stats.delayed || 0);
        const successRate = stats.total > 0 ? Math.round(tasksCompleted / stats.total * 100) : 0;
        const totalStudyHours = Math.round((stats.total_minutes || 0) / 60 * 10) / 10;

        db.prepare(`
            INSERT INTO daily_summaries (user_id, summary_date, maths_problems, physics_problems, chemistry_problems, topics_covered, total_study_hours, notes, self_rating, tasks_completed, tasks_total, success_rate, ended_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId, today,
            parseInt(maths_problems) || 0, parseInt(physics_problems) || 0, parseInt(chemistry_problems) || 0,
            topics_covered || '', totalStudyHours, notes || '', rating,
            tasksCompleted, stats.total, successRate, new Date().toISOString()
        );

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        let newStreak = user.current_streak;
        if (tasksCompleted > 0) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            const yesterdaySummary = db.prepare('SELECT tasks_completed FROM daily_summaries WHERE user_id = ? AND summary_date = ?').get(userId, yesterdayStr);
            newStreak = (yesterdaySummary && yesterdaySummary.tasks_completed > 0) ? user.current_streak + 1 : 1;
        } else {
            newStreak = 0;
        }
        const bestStreak = Math.max(newStreak, user.best_streak);
        db.prepare('UPDATE users SET current_streak = ?, best_streak = ?, last_active_date = ? WHERE id = ?').run(newStreak, bestStreak, today, userId);

        res.json({ success: true, summary: { tasks_completed: tasksCompleted, success_rate: successRate, current_streak: newStreak } });
    } catch (err) {
        console.error('End day error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Leaderboard ---
app.get('/api/leaderboard', requireAuth, (req, res) => {
    const period = req.query.period || 'weekly';
    let startDate;
    const today = new Date();
    const todayStr = todayDate();

    if (period === 'weekly') {
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        startDate = monday.toISOString().split('T')[0];
    } else if (period === 'monthly') {
        startDate = today.toISOString().split('T')[0].substring(0, 8) + '01';
    } else {
        startDate = '2000-01-01';
    }

    const rankings = db.prepare(`
        SELECT u.id, u.name, u.username,
            COUNT(t.id) as total,
            SUM(CASE WHEN t.status = 'completed_ontime' THEN 1 ELSE 0 END) as ontime,
            SUM(CASE WHEN t.status = 'completed_delayed' THEN 1 ELSE 0 END) as delayed,
            COALESCE(SUM(CASE WHEN t.actual_minutes IS NOT NULL THEN t.actual_minutes ELSE 0 END), 0) as total_minutes
        FROM users u
        LEFT JOIN tasks t ON u.id = t.user_id AND t.task_date >= ? AND t.task_date <= ?
        GROUP BY u.id
        ORDER BY ontime DESC, (CASE WHEN COUNT(t.id) > 0 THEN SUM(CASE WHEN t.status = 'completed_ontime' THEN 1 ELSE 0 END) * 100.0 / COUNT(t.id) ELSE 0 END) DESC
    `).all(startDate, todayStr);

    const result = rankings.map(r => ({
        id: r.id, name: r.name, username: r.username,
        ontime: r.ontime || 0, delayed: r.delayed || 0, total: r.total || 0,
        success_rate: r.total > 0 ? Math.round((r.ontime || 0) / r.total * 100) : 0,
        study_hours: Math.round((r.total_minutes || 0) / 60 * 10) / 10
    }));

    res.json({ rankings: result });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/leaderboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'leaderboard.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`JEE Study App running on port ${PORT}`));
