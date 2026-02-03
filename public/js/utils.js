// --- Utils ---

// Cold Start Handler
async function checkServerAwake() {
    const banner = document.getElementById('wakeup-banner');
    if (!banner) return;
    
    const timeout = new Promise((_, reject) => setTimeout(() => reject('timeout'), 2000));
    try {
        await Promise.race([fetch('/api/health'), timeout]);
        banner.style.display = 'none';
        return true;
    } catch {
        banner.style.display = 'flex';
        // Retry loop
        const retry = async () => {
            try {
                const res = await fetch('/api/health');
                if (res.ok) {
                    banner.style.display = 'none';
                    window.location.reload(); // Reload to start fresh
                } else {
                    setTimeout(retry, 2000);
                }
            } catch {
                setTimeout(retry, 2000);
            }
        };
        setTimeout(retry, 2000);
        return false;
    }
}

// Fetch Wrapper
async function apiFetch(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            window.location.href = '/'; // Redirect to login
            return null;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

// Toast Notification
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}

// Format Time (minutes -> Xh Ym)
function formatDuration(minutes) {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Modal Control
function openModal(modalId) {
    const overlay = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    // Clear previous
    body.innerHTML = '';
    
    // Inject content based on ID logic in app.js, handled by caller mostly
    // This just shows the container
    overlay.style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

// Export for app.js (if using modules, but here just global scope)
window.utils = { checkServerAwake, apiFetch, showToast, formatDuration, openModal, closeModal };
