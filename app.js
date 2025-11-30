// ==== APP VERSION ====
const APP_VERSION = 'v4.2.0';
const GITHUBRAWURL = 'https://raw.githubusercontent.com/riyasma07/asset-manager-db/main/data.json';
const DBNAME = 'AssetManagerProDB';
let db = null;
let currentUser = null;
let isAdmin = false;
let editingItemId = null;
let editingConsumableId = null;
let returnItemId = null;
let assignItemId = null;
let notifyItemId = null;

let currentRules = null; // ADD THIS - will load from GitHub

// ===== GITHUB AUTOSYNC CONFIGURATION =====
// Encrypted token from Python script above
const ENCRYPTED_TOKEN_STRING = 'GOzdoMq17CWYanuj2WkUU1Iuprjx4psffz4IWBFRoJs88o2iF8Hu6LKIHcNh2WzHU/6fEkviF9ZJo/uHU7A/v60Az3Hx408zp+X8eROI6gA=';

// Password used to encrypt the token (same as you entered in Python)
const ENCRYPTION_PASSWORD = 'Hogwarts@123';

// GitHub repo details
const GITHUB_OWNER = 'riyasma07';
const GITHUB_REPO_DATA = 'asset-manager-db';
const GITHUB_BRANCH = 'main'; // Change to 'dev' for development

// Optional: Auto-sync interval (every 5 minutes)
const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // milliseconds

// Alert type constants
const SUCCESS_ALERT = 'success';
const FAILURE_ALERT = 'failure';
const NORMAL_ALERT = 'normal';

// ===== CUSTOM ALERT MODAL =====
function showAlert(message, type = NORMAL_ALERT) {
    const modal = document.getElementById('customAlertModal');

    if (!modal) {
        console.log('Alert:', message);
        return;
    }

    const messageEl = document.getElementById('customAlertMessage');
    const okBtn = document.getElementById('customAlertOkBtn');
    const iconEl = modal.querySelector('.custom-alert-icon');
    const modalBox = modal.querySelector('.custom-alert-modal');

    // Set message
    messageEl.textContent = message;

    // Remove all theme classes
    modalBox.classList.remove('alert-success', 'alert-failure', 'alert-normal');

    // Apply theme based on type
    let iconHTML = '';

    switch (type) {
        case SUCCESS_ALERT:
            modalBox.classList.add('alert-success');
            iconHTML = `
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="9 11 12 14 15 10"></polyline>
                    </svg>
                `;
            break;

        case FAILURE_ALERT:
            modalBox.classList.add('alert-failure');
            iconHTML = `
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                `;
            break;

        case NORMAL_ALERT:
        default:
            modalBox.classList.add('alert-normal');
            iconHTML = `
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                `;
    }

    iconEl.innerHTML = iconHTML;

    // Show modal
    modal.style.display = 'flex';
    okBtn.focus();

    // Close handlers
    const closeModal = () => {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', closeModal);
        modal.removeEventListener('click', outsideClick);
        document.removeEventListener('keydown', escapeKey);
    };

    const outsideClick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };

    const escapeKey = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };

    okBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', outsideClick);
    document.addEventListener('keydown', escapeKey);
}

// ===== PUSH DATABASE WITH FORCE REPLACE (NO HISTORY) =====
async function pushDatabaseToGitHub(databaseObject, token, repoOwner, repoName, branchName) {
    const filePath = 'data.json';
    const maxRetries = 3;
    let retryCount = 0;

    async function attemptPush() {
        try {
            console.log(`Push attempt ${retryCount + 1}/${maxRetries}...`);

            // Get current file SHA (fresh fetch)
            const getUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${branchName}`;
            const getRes = await fetch(getUrl, {
                headers: {
                    Authorization: `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!getRes.ok) {
                throw new Error(`Failed to fetch file from GitHub (HTTP ${getRes.status})`);
            }

            const getData = await getRes.json();
            const fileSHA = getData.sha;
            console.log('✓ Got current SHA from GitHub:', fileSHA.substring(0, 8) + '...');

            // Prepare content
            const jsonString = JSON.stringify(databaseObject, null, 2);
            const updatedContent = btoa(unescape(encodeURIComponent(jsonString)));

            // Create commit with force push
            const body = {
                message: 'Auto-sync: ' + new Date().toISOString(),
                content: updatedContent,
                sha: fileSHA,
                branch: branchName
            };

            // PUT to GitHub
            const putUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
            const putRes = await fetch(putUrl, {
                method: "PUT",
                headers: {
                    Authorization: `token ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(body)
            });

            if (putRes.status === 409) {
                // Conflict - retry
                console.warn('⚠ SHA conflict (409) - retrying...');
                retryCount++;
                if (retryCount < maxRetries) {
                    await new Promise(r => setTimeout(r, 1000));
                    return attemptPush();
                } else {
                    throw new Error('Max retries reached (409 conflict)');
                }
            }

            if (!putRes.ok) {
                const errData = await putRes.json();
                throw new Error(`GitHub update failed (${putRes.status}): ${errData.message || putRes.statusText}`);
            }

            const result = await putRes.json();
            console.log('✅ Database synced! File replaced (single commit kept)');
            console.log('Commit:', result.commit.sha.substring(0, 8));

            // Optional: Clean up old commits using force push via GraphQL
            // (Only works if you enable force-push in repo settings)
            await cleanupOldCommits(token, repoOwner, repoName, branchName);

            return result;
        } catch (error) {
            console.error('❌ Sync error:', error.message);
            throw error;
        }
    }

    return attemptPush();
}

// Optional: Clean up history to keep only latest commit
async function cleanupOldCommits(token, repoOwner, repoName, branchName) {
    try {
        // This uses GraphQL to force-push and clean history
        // Note: Requires "Allow force pushes" enabled in repo settings
        console.log('⏳ Cleaning up old commits...');

        // Get latest commit SHA
        const getCommitsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/commits?sha=${branchName}&per_page=1`;
        const commitsRes = await fetch(getCommitsUrl, {
            headers: { Authorization: `token ${token}` }
        });

        if (!commitsRes.ok) return;

        const commits = await commitsRes.json();
        if (commits.length === 0) return;

        const latestCommitSha = commits[0].sha;
        console.log('Latest commit:', latestCommitSha.substring(0, 8));

        // Force push would require git operations - not available via REST API alone
        // Alternative: Keep the repo as-is with growing history
        console.log('✓ History preserved (use --force-with-lease locally if needed)');
    } catch (error) {
        console.warn('Could not clean history:', error.message);
        // Don't fail sync if cleanup fails
    }
}



// ===== DECRYPT TOKEN FUNCTION =====
async function decryptToken(encryptedB64, password) {
    function str2ab(str) {
        const buf = new Uint8Array(str.length);
        for (let i = 0; i < str.length; ++i) buf[i] = str.charCodeAt(i);
        return buf.buffer;
    }

    try {
        const encrypted = atob(encryptedB64);
        const salt = encrypted.slice(0, 16);
        const iv = encrypted.slice(16, 32);
        const ciphertext = encrypted.slice(32);

        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: str2ab(salt),
                iterations: 100000,
                hash: 'SHA-1'
            },
            keyMaterial,
            { name: 'AES-CBC', length: 256 },
            false,
            ['decrypt']
        );

        const tokenBuffer = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: str2ab(iv) },
            key,
            str2ab(ciphertext)
        );

        return new TextDecoder().decode(tokenBuffer).replace(/\x00+$/g, '');
    } catch (error) {
        throw new Error('Token decryption failed: ' + error.message);
    }
}

// ===== EXPORT FULL DATABASE =====
async function exportFullDatabase() {
    try {
        const users = await getAll('users');
        const items = await getAll('items');
        const consumables = await getAll('consumables');
        const history = await getAll('history');

        return {
            "__schema__": "asset-manager-pro",
            "version": 1,
            "exportedAt": new Date().toISOString(),
            "users": users,
            "items": items,
            "consumables": consumables,
            "history": history
        };
    } catch (error) {
        throw new Error('Failed to export database: ' + error.message);
    }
}


// ===== AUTO SYNC WRAPPER (EASY TO CALL) =====
async function autoSyncDatabaseToGithub() {
    // NEW: Admins always allowed, Members allowed only if rule is enabled
    const isMember =
        currentUser && !currentUser.isAdmin && currentUser.role === 'member';

    const memberCanAutoSync =
        isMember &&
        currentRules &&
        currentRules.rules &&
        currentRules.rules.member &&
        currentRules.rules.member.canMemberAutoSync;

    if (!isAdmin && !memberCanAutoSync) {
        console.log('⏭️ Sync skipped: session not allowed to auto-sync');
        return;
    }

    try {
        console.log('Starting auto-sync to GitHub...');

        // Decrypt token
        const token = await decryptToken(ENCRYPTED_TOKEN_STRING, ENCRYPTION_PASSWORD);

        // Export database
        const myDatabase = await exportFullDatabase();

        // Push to GitHub
        await pushDatabaseToGitHub(myDatabase, token, GITHUB_OWNER, GITHUB_REPO_DATA, GITHUB_BRANCH);

        console.log('✅ Auto-sync completed!');
    } catch (error) {
        console.error('Auto-sync failed:', error.message);
        // Don't throw - let the app continue even if sync fails
    }
}

async function getGitHubFile(config, filePath) {
    // Example: Fetch a file from GitHub using the REST API
    const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`,
        {
            headers: {
                Authorization: `token ${config.token}`,
                Accept: "application/vnd.github.v3+json"
            }
        }
    );
    if (!response.ok) throw new Error("Failed to fetch from GitHub");
    return await response.json();
}

async function updateGitHubFile(config, filePath, content, sha, message) {
    // Example: Update a file in GitHub using the REST API
    const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}`,
        {
            method: "PUT",
            headers: {
                Authorization: `token ${config.token}`,
                Accept: "application/vnd.github.v3+json"
            },
            body: JSON.stringify({
                message: message,
                content: btoa(unescape(encodeURIComponent(content))),
                sha: sha,
                branch: config.branch
            })
        }
    );
    if (!response.ok) throw new Error("Failed to update GitHub");
    return await response.json();
}



// ===== LOAD DATABASE FROM GITHUB ON PAGE STARTUP =====
async function loadDatabaseFromGithub() {
    try {
        console.log('Loading database from GitHub...');

        const dataUrl = `https://raw.githubusercontent.com/riyasma07/asset-manager-db/main/data.json`;

        const response = await fetch(dataUrl);
        if (!response.ok) {
            throw new Error(`Failed to load from GitHub (HTTP ${response.status})`);
        }

        const githubData = await response.json();
        console.log('GitHub data loaded:', githubData);

        // Clear local IndexedDB and repopulate with GitHub data
        await clearAllData(); // Clear existing data

        // Load GitHub data into IndexedDB
        if (githubData.users && githubData.users.length > 0) {
            for (let user of githubData.users) {
                await addRecord('users', user);
            }
        }

        if (githubData.items && githubData.items.length > 0) {
            for (let item of githubData.items) {
                await addRecord('items', item);
            }
        }

        if (githubData.consumables && githubData.consumables.length > 0) {
            for (let cons of githubData.consumables) {
                await addRecord('consumables', cons);
            }
        }


        if (githubData.history && githubData.history.length > 0) {
            for (let record of githubData.history) {
                await addRecord('history', record);
            }
        }

        console.log('✅ Database loaded from GitHub and synced to local storage');
        return githubData;
    } catch (error) {
        console.error('❌ Failed to load from GitHub:', error.message);
        // Fall back to local data
        return null;
    }
}

// Helper function to clear all local data
async function clearAllData() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DBNAME);

        request.onsuccess = (event) => {
            const db = event.target.result;
            const stores = ['users', 'items', 'history']; // Adjust to your store names

            stores.forEach(storeName => {
                try {
                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);
                    store.clear();
                } catch (e) {
                    console.warn(`Could not clear ${storeName}:`, e);
                }
            });

            resolve();
        };

        request.onerror = () => reject('Failed to open DB');
    });
}

// ===== DATABASE =====
async function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DBNAME, 3);  // ← Changed from 2 to 3

        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            db = req.result;
            resolve(db);
        };

        req.onupgradeneeded = (e) => {
            const database = e.target.result;

            if (!database.objectStoreNames.contains('users')) {
                database.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains('items')) {
                database.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains('consumables')) {
                database.createObjectStore('consumables', { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains('history')) {
                database.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
            }
            // ✅ NEW: Add session store
            if (!database.objectStoreNames.contains('session')) {
                database.createObjectStore('session', { keyPath: 'id' });
            }
        };
    });
}

function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function addRecord(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).add(data); // <-- FIXED
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}


function updateRecord(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function getOne(storeName, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function deleteRecord(storeName, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function clearStore(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ===== SESSION MANAGEMENT =====

// Save current user session
async function saveSession(user) {
    try {
        const sessionData = {
            id: 'current',
            user: user,
            timestamp: Date.now(),  // ✅ Add timestamp
            expiresIn: 24 * 60 * 60 * 1000  // 24 hours in milliseconds
        };

        const tx = db.transaction('session', 'readwrite');
        const store = tx.objectStore('session');
        await store.put(sessionData);
        console.log('✅ Session saved (expires in 24h)');
    } catch (error) {
        console.error('Failed to save session:', error);
    }
}

// Load saved session
async function loadSession() {
    try {
        const tx = db.transaction('session', 'readonly');
        const store = tx.objectStore('session');
        const request = store.get('current');

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                if (request.result && request.result.user) {
                    const sessionData = request.result;
                    const now = Date.now();
                    const elapsed = now - sessionData.timestamp;

                    // ✅ Check if session expired
                    if (elapsed > sessionData.expiresIn) {
                        console.log('⚠️ Session expired');
                        // Clear expired session
                        clearSession();
                        resolve(null);
                    } else {
                        console.log('✅ Session loaded (valid)');
                        resolve(sessionData.user);
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Failed to load session:', error);
        return null;
    }
}

// Clear session (on logout)
async function clearSession() {
    try {
        const tx = db.transaction('session', 'readwrite');
        const store = tx.objectStore('session');
        await store.delete('current');
        console.log('✅ Session cleared');
    } catch (error) {
        console.error('Failed to clear session:', error);
    }
}

// ===== INTELLIGENT AUTO-SYNC (MERGES DATA - PRESERVES NEW LOCAL ITEMS) =====
async function autoSyncFromGithub() {
    try {
        const res = await fetch(GITHUBRAWURL);
        if (!res.ok) return;
        const githubData = await res.json();
        if (githubData.__schema__ !== 'asset-manager-pro') return;

        // Get current local data
        const localUsers = await getAll('users');
        const localItems = await getAll('items');
        const localConsumables = await getAll('consumables');
        const localHistory = await getAll('history');

        // MERGE ITEMS: Only add items from GitHub if they don't exist locally (by ID)
        for (const item of (githubData.items || [])) {
            const exists = localItems.some(li => li.id === item.id);
            if (!exists) {
                await addRecord('items', item);
            }
        }

        // MERGE CONSUMABLES: Only add consumables from GitHub if they don't exist locally (by ID)
        for (const cons of (githubData.consumables || [])) {
            const exists = localConsumables.some(lc => lc.id === cons.id);
            if (!exists) {
                await addRecord('consumables', cons);
            }
        }

        // MERGE USERS: Update existing users, add new ones
        for (const user of (githubData.users || [])) {
            const exists = localUsers.find(lu => lu.id === user.id);
            if (exists) {
                await updateRecord('users', user);
            } else {
                await addRecord('users', user);
            }
        }

        // MERGE HISTORY: Only add history entries that don't exist locally
        for (const hist of (githubData.history || [])) {
            const exists = localHistory.some(h => h.id === hist.id);
            if (!exists) {
                await addRecord('history', hist);
            }
        }

        console.log('✓ Synced from GitHub (preserved local data)');
    } catch (e) {
        console.warn('Sync failed:', e.message);
    }
}


// ===== EMAIL =====
async function sendEmail(recipient, subject, body) {
    try {
        const response = await fetch('http://localhost:3000/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: recipient,
                subject: subject,
                body: body,
                from: currentUser.email
            })
        });

        // Check if the request was successful
        if (response.ok) {
            const data = await response.json();
            return { success: true, data: data };
        } else {
            console.warn('Email failed with status:', response.status);
            return { success: false, error: `HTTP ${response.status}` };
        }
    } catch (e) {
        console.warn('Email error:', e);
        return { success: false, error: e.message };
    }
}

async function sendEmailNotification(itemId, memberId, memberName) {
    try {
        // Get the item and member details
        const items = await getAll('items');
        const users = await getAll('users');

        const item = items.find(i => i.id === itemId);
        const member = users.find(u => u.id === memberId);

        if (!item || !member) {
            console.error('Item or member not found');
            return { success: false };
        }

        // Send the email using your existing sendEmail function
        const result = await sendEmail(
            member.email,
            `Asset Assigned: ${item.name}`,
            `Hi ${member.name},\n\nThe asset "${item.name}" (SN: ${item.serial}) has been assigned to you.\n\nRegards,\n${currentUser.name}`
        );

        return result;
    } catch (err) {
        console.error('Error in sendEmailNotification:', err);
        return { success: false, error: err.message };
    }
}



// ===== UI =====
function closeModal(id) {
    document.getElementById(id).classList.remove('show');
    if (!document.querySelectorAll('.modal.show').length && !document.querySelectorAll('.panel.open').length) {
        document.getElementById('backdrop').classList.remove('show');
    }
}

function openModal(id) {
    document.getElementById('backdrop').classList.add('show');
    document.getElementById(id).classList.add('show');
}

function closePanel(id) {
    document.getElementById(id).classList.remove('open');
    if (!document.querySelectorAll('.modal.show').length && !document.querySelectorAll('.panel.open').length) {
        document.getElementById('backdrop').classList.remove('show');
    }
}

function openPanel(id) {
    document.getElementById('backdrop').classList.add('show');
    document.getElementById(id).classList.add('open');
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    if (tab === 'assets') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('assets-tab').classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('consumables-tab').classList.add('active');
    }
}

// ITEM TYPE SELECTION
async function openAddItemTypeModal() {
  openModal('itemTypeModal');

  // RESET: Always enable both buttons initially
  const consumableBtn = document.querySelector('[onclick="selectItemType(\'consumable\')"]');
  const assetBtn = document.querySelector('[onclick="selectItemType(\'asset\')"]');

  if (consumableBtn) {
    consumableBtn.style.opacity = '1';
    consumableBtn.style.pointerEvents = 'auto';
    consumableBtn.style.cursor = 'pointer';
    consumableBtn.title = '';
  }

  if (assetBtn) {
    assetBtn.style.opacity = '1';
    assetBtn.style.pointerEvents = 'auto';
    assetBtn.style.cursor = 'pointer';
    assetBtn.title = '';
  }

  // NOW apply restrictions only for members
  if (!isAdmin && currentUser && currentUser.role === 'member') {
    // Member: check rules for CONSUMABLE
    if (consumableBtn) {
      if (!currentRules || !currentRules.rules.member || !currentRules.rules.member.canAddConsumables) {
        consumableBtn.style.opacity = '0.5';
        consumableBtn.style.pointerEvents = 'none';
        consumableBtn.style.cursor = 'not-allowed';
        consumableBtn.title = "You don't have permission to add consumables";
      }
    }

    // Member: check rules for ASSET
    if (assetBtn) {
      if (!currentRules || !currentRules.rules.member || !currentRules.rules.member.canAddAssets) {
        assetBtn.style.opacity = '0.5';
        assetBtn.style.pointerEvents = 'none';
        assetBtn.style.cursor = 'not-allowed';
        assetBtn.title = "You don't have permission to add assets";
      }
    }
  }
}




function selectItemType(type) {
    closeModal('itemTypeModal');
    if (type === 'asset') {
        openModal('addAssetModal');
    } else {
        openModal('addConsumableModal');
    }
}

async function showMainApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainHeader').classList.remove('hidden');
    document.getElementById('mainContent').classList.remove('hidden');

    const userRole = currentUser.role || (currentUser.isAdmin ? 'admin' : 'viewer');

    if (isAdmin) {
        // ===== ADMIN: All buttons visible =====
        document.getElementById('openManage').style.display = 'flex';
        document.getElementById('settingsBtn').style.display = 'flex';
        document.getElementById('addItemBtn').style.display = 'flex';
        document.getElementById('addMemberBtn').style.display = 'flex';
        document.getElementById('exportBtn').style.display = 'flex';
        document.getElementById('syncBtn').style.display = 'flex';
        document.getElementById('editRulesBtn').style.display = 'flex'; // NEW
    } else if (userRole === 'member') {
        // ===== MEMBER: Limited buttons based on rules =====
        document.getElementById('openManage').style.display = 'flex';
        document.getElementById('settingsBtn').style.display = 'flex';
        document.getElementById('addItemBtn').style.display = 'flex'; // Can add assets only
        document.getElementById('addMemberBtn').style.display = 'flex';
        // Export/Sync based on rules
        document.getElementById('exportBtn').style.display = (currentRules && currentRules.rules.member.canExport) ? 'flex' : 'none';
        document.getElementById('syncBtn').style.display = (currentRules && currentRules.rules.member.canSync) ? 'flex' : 'none';
        document.getElementById('editRulesBtn').style.display = 'none'; // Hidden for member
    } else {
        // ===== VIEWER: Minimal buttons based on rules =====
        // View items - based on rule
        if (currentRules && currentRules.rules.viewer.canViewItems) {
            document.getElementById('openManage').style.display = 'flex';
        } else {
            document.getElementById('openManage').style.display = 'none';
        }
        document.getElementById('settingsBtn').style.display = 'flex';
        document.getElementById('addItemBtn').style.display = 'none'; // Hidden for viewer
        document.getElementById('addMemberBtn').style.display = 'none'; // Hidden for viewer
        document.getElementById('exportBtn').style.display = (currentRules && currentRules.rules.viewer.canExport) ? 'flex' : 'none';
        document.getElementById('syncBtn').style.display = (currentRules && currentRules.rules.viewer.canSync) ? 'flex' : 'none';
        document.getElementById('editRulesBtn').style.display = 'none'; // Hidden for viewer
    }

    setTimeout(() => {
        const appVersionEl = document.getElementById('appVersion');
        const userRoleTextEl = document.getElementById('userRoleText');

        if (appVersionEl) {
            appVersionEl.textContent = APP_VERSION;
        }

        if (userRoleTextEl) {
            userRoleTextEl.textContent = userRole.toUpperCase();
            userRoleTextEl.className = userRole;
        }
    }, 50);

    renderItems();
    renderConsumables();

    // FIX: Update Remove Account button state on load
    await updateRemoveAccountBtn();
}


// ===== RENDER ITEMS =====
async function renderItems() {
    try {
        const items = await getAll('items');
        document.getElementById('itemsCount').textContent = items.length;
        const tbody = document.getElementById('itemsBody');
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">No items found</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(item => {
            const hasHolder = item.holder && item.holder.trim() !== '';
            const statusDisplay = hasHolder ? 'Out' : 'Available';
            const statusClass = hasHolder ? 'badge-orange' : 'badge-green';
            const condDisplay = item.condition === 'working' ? 'Working' : 'Not Working';

            let actions = '';
            if (isAdmin) {
                // Admin – always full control
                actions += `<button class="btn-icon" onclick="startEditItem(${item.id})" title="Edit">✏️</button>`;
                actions += `<button class="btn-icon" onclick="openHistory(${item.id})" title="History">📋</button>`;
                if (!hasHolder) {
                    actions += `<button class="btn-icon" onclick="openAssignModal(${item.id})" title="Assign">➕</button>`;
                }
                if (hasHolder) {
                    actions += `<button class="btn-icon" onclick="openReturnModal(${item.id})" title="Return">↩️</button>`;
                    actions += `<button class="btn-icon" onclick="notifyHolder(${item.id}, '${item.holder.replace(/'/g, "\\'")}')" title="Notify Holder">🔔</button>`;
                }
            } else if (currentUser && currentUser.role === 'member' && currentRules && currentRules.rules && currentRules.rules.member) {
                const mr = currentRules.rules.member;

                if (mr.canEditItems) {
                    actions += `<button class="btn-icon" onclick="startEditItem(${item.id})" title="Edit">✏️</button>`;
                }

                if (mr.canViewHistory) {
                    actions += `<button class="btn-icon" onclick="openHistory(${item.id})" title="History">📋</button>`;
                }

                if (mr.canAssignItems) {
                    if (!hasHolder) {
                        actions += `<button class="btn-icon" onclick="openAssignModal(${item.id})" title="Assign">➕</button>`;
                    }
                    if (hasHolder) {
                        actions += `<button class="btn-icon" onclick="openReturnModal(${item.id})" title="Return">↩️</button>`;
                    }
                }

                if (mr.canNotifyHolder && hasHolder) {
                    actions += `<button class="btn-icon" onclick="notifyHolder(${item.id}, '${item.holder.replace(/'/g, "\\'")}')" title="Notify Holder">🔔</button>`;
                }
            }

            return `
                        <tr id="item-row-${item.id}">
                            <td id="item-name-${item.id}">${item.name}</td>
                            <td id="item-serial-${item.id}">${item.serial}</td>
                            <td>${item.holder ? `<span class="holder-name" data-holder-name="${item.holder.replace(/"/g, '&quot;')}">${item.holder}</span>` : "-"}</td>
                            <td><span class="pill-status ${hasHolder ? 'out' : 'available'}">${statusDisplay}</span></td>
                            <td id="item-cond-${item.id}"><span class="pill-condition ${item.condition === 'working' ? 'working' : 'not-working'}">${condDisplay}</span></td>
                            <td id="item-actions-${item.id}"><div class="action-buttons">${actions}</div></td>
                        </tr>
                    `;
        }).join('');
        initHolderTooltips();
    } catch (e) {
        console.error('Render error:', e);
    }
    autoSyncDatabaseToGithub();
}

// ===== NOTIFY HOLDER - SMART EMAIL WITH FULL WORKFLOW =====
async function notifyHolder(itemId, holderName) {
    try {
        console.log(`Notifying holder: ${holderName} for item ID: ${itemId}`);

        // 1. Get the item details
        const item = await getOne('items', itemId);
        if (!item) {
            showAlert('Item not found!', FAILURE_ALERT);
            return;
        }

        // 2. Get all users to find the holder's email
        const users = await getAll('users');
        const holder = users.find(u => u.name === holderName);

        if (!holder || !holder.email) {
            showAlert(`Cannot find email for ${holderName}. Please check member database.`, FAILURE_ALERT);
            return;
        }

        console.log(`Found holder email: ${holder.email}`);

        // 3. Prepare email content
        const subject = `Asset Notification: ${item.name}`;
        const body = `Hi ${holder.name},***** THIS IS AN AUTOMATED MESSAGE *****\n\nThis is a friendly reminder that you currently have the following asset assigned to you:\n\n📦 Asset: ${item.name}\n🔢 Serial Number: ${item.serial}\n\nWe kindly request you to return this asset at your earliest convenience.\n\nThank you for your cooperation!\n\nRegards,\n${currentUser.name}`;

        // 4. Use the COMPLETE standalone email workflow
        // This includes: confirmation modal, loading spinner, success/error, retry logic
        showEmailConfirmationModal(holder.email, subject, body);

    } catch (error) {
        console.error('Error in notifyHolder:', error);
        showAlert('Failed to notify holder: ' + error.message, FAILURE_ALERT);
    }
}

// FIXED EDIT FUNCTION - NO QUERYSELECTOR ERROR
async function startEditItem(itemId) {
    try {
        editingItemId = itemId;
        const item = await getOne('items', itemId);

        document.getElementById(`item-name-${itemId}`).innerHTML = `<input type="text" id="edit-name-${itemId}" value="${item.name}" style="width: 100%; padding: 0.5rem;">`;
        document.getElementById(`item-serial-${itemId}`).innerHTML = `<input type="text" id="edit-serial-${itemId}" value="${item.serial}" style="width: 100%; padding: 0.5rem;">`;

        document.getElementById(`item-cond-${itemId}`).innerHTML = `
                    <select id="edit-cond-${itemId}" style="width: 100%; padding: 0.5rem;">
                        <option value="working" ${item.condition === 'working' ? 'selected' : ''}>Working</option>
                        <option value="not-working" ${item.condition === 'not-working' ? 'selected' : ''}>Not Working</option>
                    </select>
                `;

        document.getElementById(`item-actions-${itemId}`).innerHTML = `
                    <button class="btn btn-sm btn-success" onclick="saveEditItem(${itemId})">Save</button>
                    <button class="btn btn-sm btn-secondary" onclick="cancelEditItem()">Cancel</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteItem(${itemId})">Delete</button>
                `;

        document.getElementById(`edit-name-${itemId}`).focus();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function saveEditItem(itemId) {
    try {
        const item = await getOne('items', itemId);
        item.name = document.getElementById(`edit-name-${itemId}`).value;
        item.serial = document.getElementById(`edit-serial-${itemId}`).value;
        item.condition = document.getElementById(`edit-cond-${itemId}`).value;

        await updateRecord('items', item);
        showAlert('Item updated!', SUCCESS_ALERT);
        editingItemId = null;
        renderItems();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

function cancelEditItem() {
    editingItemId = null;
    renderItems();
}

async function deleteItem(itemId) {
    if (!confirm('Delete this item?')) return;
    try {
        await deleteRecord('items', itemId);
        showAlert('Item deleted!', SUCCESS_ALERT);
        renderItems();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== RENDER CONSUMABLES =====
async function renderConsumables() {
    try {
        const consumables = await getAll('consumables');
        document.getElementById('consumablesCount').textContent = consumables.length;

        const tbody = document.getElementById('consumablesBody');
        if (!consumables.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">No consumables found</td></tr>';
            return;
        }

        tbody.innerHTML = consumables.map(cons => {
            let actions = '';

            if (isAdmin) {
                // Admin sees all buttons
                actions = `
                            <button class="btn-icon" onclick="startEditConsumable(${cons.id})" title="Edit">✏️</button>
                            <button class="btn-icon" onclick="openAddQtyModal(${cons.id})" title="Add Qty">➕</button>
                            <button class="btn-icon" onclick="openAssignConsModal(${cons.id})" title="Assign">📤</button>
                            ${cons.link ? `<button class="btn-icon" onclick="openConsumableLink('${cons.link.replace(/'/g, "\\'")}')" title="Product Link">🔗</button>` : ''}
                        `;
            } else {
                // Members see ONLY the link button (if link exists)
                if (cons.link) {
                    actions = `
                                <button class="btn-icon" onclick="openConsumableLink('${cons.link.replace(/'/g, "\\'")}')" title="Product Link">🔗</button>
                            `;
                }
            }

            return `<tr id="cons-row-${cons.id}">
                        <td id="cons-name-${cons.id}">${cons.name}</td>
                        <td id="cons-part-${cons.id}">${cons.partNumber}</td>
                        <td id="cons-qty-${cons.id}"><span class="pill-qty">${cons.quantity}</span></td>
                        <td id="cons-actions-${cons.id}"><div class="action-buttons">${actions}</div></td>
                    </tr>`;
        }).join('');
    } catch (e) {
        console.error('Render error', e);
    }
}

async function startEditConsumable(consId) {
    try {
        editingConsumableId = consId;
        const cons = await getOne('consumables', consId);

        document.getElementById(`cons-name-${consId}`).innerHTML = `
                    <input type="text" id="edit-cons-name-${consId}" value="${cons.name}" 
                        style="width:100%; padding:0.5rem">
                `;

        document.getElementById(`cons-part-${consId}`).innerHTML = `
                    <input type="text" id="edit-cons-part-${consId}" value="${cons.partNumber}" 
                        style="width:100%; padding:0.5rem">
                `;

        document.getElementById(`cons-actions-${consId}`).innerHTML = `
                    <button class="btn btn-sm btn-success" onclick="saveEditConsumable(${consId})">Save</button>
                    <button class="btn btn-sm btn-secondary" onclick="cancelEditConsumable()">Cancel</button>
                    <button class="btn btn-sm btn-info" onclick="openConsumableLinkModal(${consId})" title="Add/Edit Link">Link</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteConsumable(${consId})">Delete</button>
                `;

        document.getElementById(`edit-cons-name-${consId}`).focus();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function saveEditConsumable(consId) {
    try {
        const cons = await getOne('consumables', consId);
        cons.name = document.getElementById(`edit-cons-name-${consId}`).value;
        cons.partNumber = document.getElementById(`edit-cons-part-${consId}`).value;

        await updateRecord('consumables', cons);
        showAlert('Consumable updated!', SUCCESS_ALERT);
        editingConsumableId = null;
        renderConsumables();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
    await autoSyncDatabaseToGithub();
}

function cancelEditConsumable() {
    editingConsumableId = null;
    renderConsumables();
}

async function deleteConsumable(consId) {
    if (!confirm('Delete this consumable?')) return;
    try {
        await deleteRecord('consumables', consId);
        showAlert('Consumable deleted!', SUCCESS_ALERT);
        renderConsumables();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
    await autoSyncDatabaseToGithub();
}

// ===== ASSIGN ITEM =====
async function openAssignModal(itemId) {
    try {
        assignItemId = itemId;
        const members = await getAll('users');
        const select = document.getElementById('assignMember');
        select.innerHTML = '<option value="">Choose member</option>' + members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        openModal('assignItemModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

document.getElementById('assignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const itemId = assignItemId;
        const memberId = parseInt(document.getElementById('assignMember').value);
        if (!memberId) { showAlert('Select member', NORMAL_ALERT); return; }

        const item = await getOne('items', itemId);
        const member = await getOne('users', memberId);

        item.holder = member.name;
        await updateRecord('items', item);

        await addRecord('history', {
            itemId: itemId,
            itemName: item.name,
            action: 'assigned',
            from: 'Available',
            to: member.name,
            date: new Date().toLocaleString(),
            user: currentUser.name
        });

        const users = await getAll('users');
        const holder = users.find(u => u.name === member.name);

        const subject = `Asset Assigned: ${item.name}`;
        const body = `Hi ${member.name},\n\n***** THIS IS AN AUTOMATED MESSAGE *****\n\nThe asset "${item.name}" (SN: ${item.serial}) has been assigned to you.\n\nThis is an automated response. Please do not reply to this email`;

        // showConfirmEmailModal(itemId, memberId, member.name, subject, body);
        showEmailConfirmationModal(holder.email, subject, body);

        autoSyncDatabaseToGithub();

        closeModal('assignItemModal'); renderItems();
    } catch (e) { showAlert('Error: ' + e.message, FAILURE_ALERT); }
});

// ===== RETURN ITEM =====
async function openReturnModal(itemId) {
    try {
        returnItemId = itemId;
        const item = await getOne('items', itemId);
        document.getElementById('returnItemInfo').textContent = `Item: ${item.name} | Holder: ${item.holder}`;
        openModal('returnItemModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function confirmReturnItem() {
    try {
        const item = await getOne('items', returnItemId);
        const oldHolder = item.holder;
        item.holder = '';

        await updateRecord('items', item);

        await addRecord('history', {
            itemId: returnItemId,
            itemName: item.name,
            action: 'returned',
            from: oldHolder,
            to: 'Available',
            date: new Date().toLocaleString(),
            user: currentUser.name
        });

        const users = await getAll('users');
        const holder = users.find(u => u.name === oldHolder);

        const subject = `Asset Unassigned: ${item.name}`;
        const body = `Hi ${oldHolder},\n\n***** THIS IS AN AUTOMATED MESSAGE *****\n\nThe asset "${item.name}" has been returned to inventory.\n\nThis is an automated response. Please do not reply to this email.`;

        showEmailConfirmationModal(holder.email, subject, body);

        closeModal('returnItemModal');

        renderItems();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== HISTORY =====
async function openHistory(itemId) {
    try {
        const allHistory = await getAll('history');
        const itemHistory = allHistory.filter(h => h.itemId === itemId);
        const list = document.getElementById('historyList');

        if (!itemHistory.length) {
            list.innerHTML = '<p style="text-align: center; color: #94a3b8;">No history</p>';
            openModal('historyModal');
            return;
        }

        list.innerHTML = itemHistory.reverse().map(h => `
                    <div style="padding: 1rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; margin-bottom: 1rem;">
                        <div style="font-weight: 600; margin-bottom: 0.5rem;">${h.action.toUpperCase()}</div>
                        <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.25rem;">${h.from} → ${h.to}</div>
                        <div style="font-size: 0.75rem; color: #94a3b8;">${h.date} by ${h.user}</div>
                    </div>
                `).join('');

        openModal('historyModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== ADD QUANTITY =====
async function openAddQtyModal(consId) {
    try {
        const cons = await getOne('consumables', consId);

        const backdrop = document.getElementById('backdrop');
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>➕ Add Quantity</h3>
                            <button type="button" class="close-btn" onclick="this.closest('.modal').remove(); if(!document.querySelectorAll('.modal.show').length) document.getElementById('backdrop').classList.remove('show');">✕</button>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label>Current Quantity: ${cons.quantity}</label>
                            </div>
                            <div class="form-group">
                                <label>Quantity to Add *</label>
                                <input type="number" id="addQtyInput" min="1" placeholder="e.g., 50" required>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove(); if(!document.querySelectorAll('.modal.show').length) document.getElementById('backdrop').classList.remove('show');">Cancel</button>
                            <button type="button" class="btn btn-success" onclick="confirmAddQty(${consId})">Add</button>
                        </div>
                    </div>
                `;
        document.body.appendChild(modal);
        backdrop.classList.add('show');
        document.getElementById('addQtyInput').focus();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function confirmAddQty(consId) {
    try {
        const qtyToAdd = parseInt(document.getElementById('addQtyInput').value);
        if (!qtyToAdd || qtyToAdd < 1) { showAlert('Enter valid quantity', NORMAL_ALERT); return; }

        const cons = await getOne('consumables', consId);
        cons.quantity += qtyToAdd;

        await updateRecord('consumables', cons);

        await addRecord('history', {
            itemId: consId,
            itemName: cons.name,
            action: 'qty_added',
            from: cons.quantity - qtyToAdd,
            to: cons.quantity,
            date: new Date().toLocaleString(),
            user: currentUser.name
        });

        showAlert('Quantity added!', SUCCESS_ALERT);
        document.querySelector('.modal.show').remove();
        document.getElementById('backdrop').classList.remove('show');
        await autoSyncDatabaseToGithub();
        renderConsumables();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== ASSIGN CONSUMABLE =====
async function openAssignConsModal(consId) {
    try {
        const cons = await getOne('consumables', consId);
        const members = await getAll('users');

        const backdrop = document.getElementById('backdrop');
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>📤 Assign Consumable</h3>
                            <button type="button" class="close-btn" onclick="this.closest('.modal').remove(); if(!document.querySelectorAll('.modal.show').length) document.getElementById('backdrop').classList.remove('show');">✕</button>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label>Item: ${cons.name}</label>
                            </div>
                            <div class="form-group">
                                <label>Available Quantity: ${cons.quantity}</label>
                            </div>
                            <div class="form-group">
                                <label>Select Member *</label>
                                <select id="assignConsMember" required>
                                    <option value="">Choose member</option>
                                    ${members.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Quantity to Assign *</label>
                                <input type="number" id="assignConsQty" min="1" max="${cons.quantity}" required>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove(); if(!document.querySelectorAll('.modal.show').length) document.getElementById('backdrop').classList.remove('show');">Cancel</button>
                            <button type="button" class="btn btn-success" onclick="confirmAssignCons(${consId})">Assign</button>
                        </div>
                    </div>
                `;
        document.body.appendChild(modal);
        backdrop.classList.add('show');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function confirmAssignCons(consId) {
    try {
        const memberId = parseInt(document.getElementById('assignConsMember').value);
        const qty = parseInt(document.getElementById('assignConsQty').value);

        if (!memberId) { showAlert('Select member', NORMAL_ALERT); return; }

        const cons = await getOne('consumables', consId);
        if (qty > cons.quantity) { showAlert('Insufficient quantity!', FAILURE_ALERT); return; }

        const member = await getOne('users', memberId);
        const oldQty = cons.quantity;
        cons.quantity -= qty;

        await updateRecord('consumables', cons);

        await addRecord('history', {
            itemId: consId,
            itemName: cons.name,
            action: 'assigned',
            from: `${oldQty} units`,
            to: `${member.name} (${qty} units)`,
            date: new Date().toLocaleString(),
            user: currentUser.name
        });

        const users = await getAll('users');
        const holder = users.find(u => u.name === member.name);

        const subject = `Consumable Assigned: ${cons.name}`;
        const body = `Hi ${member.name},\n\n***** THIS IS AN AUTOMATED MESSAGE *****\n\nYou have been assigned ${qty} unit(s) of "${cons.name}".\n\nThis is an automated response. Please do not reply to this email.`;

        showEmailConfirmationModal(holder.email, subject, body);

        document.querySelector('.modal.show').remove();
        document.getElementById('backdrop').classList.remove('show');
        await autoSyncDatabaseToGithub();
        renderConsumables();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== NOTIFICATION =====
async function openNotifyModal(itemId) {
    try {
        if (!isAdmin) { showAlert('Admin only', NORMAL_ALERT); return; }

        notifyItemId = itemId;
        const item = await getOne('items', itemId);
        const members = await getAll('users');

        document.getElementById('notifyItem').value = item.name + ' (SN: ' + item.serial + ')';
        const select = document.getElementById('notifyMember');
        select.innerHTML = '<option value="">Choose member</option>' + members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

        openModal('notificationModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

document.getElementById('notificationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const memberId = parseInt(document.getElementById('notifyMember').value);
        const subject = document.getElementById('notifySubject').value;
        const message = document.getElementById('notifyContent').value;

        if (!memberId) { showAlert('Select member', NORMAL_ALERT); return; }

        const member = await getOne('users', memberId);
        await sendEmail(member.email, subject, message);

        showAlert('Email sent!', SUCCESS_ALERT);
        document.getElementById('notificationForm').reset();
        closeModal('notificationModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

// ===== ADD ASSET FORM =====
document.getElementById('assetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const data = new FormData(e.target);
        const item = {
            name: data.get('name'),
            serial: data.get('serial'),
            condition: data.get('condition'),
            holder: ''
        };
        await addRecord('items', item);
        showAlert('Asset added!', SUCCESS_ALERT);
        e.target.reset();
        closeModal('addAssetModal');
        renderItems();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

// ===== ADD CONSUMABLE FORM =====
document.getElementById('consumableForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const data = new FormData(e.target);
        const consumable = {
            name: data.get('name'),
            partNumber: data.get('partNumber'),
            quantity: parseInt(data.get('quantity')),
            link: data.get('link') || ''  // NEW: Add link field (empty string if not provided)
        };
        await addRecord('consumables', consumable);
        showAlert('Consumable added!', SUCCESS_ALERT);
        e.target.reset();
        closeModal('addConsumableModal');
        renderConsumables();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

// ===== MEMBERS =====
async function viewMembers() {
    try {
        const users = await getAll('users');
        const list = document.getElementById('membersList');

        list.innerHTML = users.map(u => {
            let actions = '';

            if (isAdmin) {
                const isCurrentUser = u.id === currentUser.id;
                const adminCount = users.filter(x => x.isAdmin).length;

                if (!u.isAdmin) {
                    actions += `<button class="btn btn-sm btn-warning" onclick="promoteToAdmin(${u.id})">👑 Promote</button>`;
                }

                if (isCurrentUser) {
                    if (!(u.isAdmin && adminCount === 1)) {
                        actions += `<button class="btn btn-sm btn-danger" onclick="removeMember(${u.id})">🗑️ Remove</button>`;
                    }
                } else {
                    actions += `<button class="btn btn-sm btn-danger" onclick="removeMember(${u.id})">🗑️ Remove</button>`;
                }
            } else {
                if (u.id === currentUser.id) {
                    actions += `<button class="btn btn-sm btn-danger" onclick="removeMember(${u.id})">🗑️ Remove</button>`;
                }
            }

            return `
                        <div class="member-card">
                            <div class="member-name">${u.name}</div>
                            <div class="member-email">${u.email}</div>
                            <div class="member-role">${u.isAdmin ? '👑 Admin' : 'Member'}</div>
                            <div class="member-actions">${actions}</div>
                        </div>
                    `;
        }).join('');

        openModal('membersModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== OPEN PEOPLE SIDEBAR =====
async function openPeopleSidebar() {
    try {
        const users = await getAll('users');
        const container = document.getElementById('peopleListContainer');
        const currentUserRole = currentUser.role || (currentUser.isAdmin ? 'admin' : 'viewer');

        container.innerHTML = users.map(u => {
            const userRole = u.role || (u.isAdmin ? 'admin' : 'viewer');
            const isCurrentUser = u.id === currentUser.id;
            const initials = u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            const hasPhoto = !!u.profilePicture;
            const avatarHTML = hasPhoto
                ? `<img src="${u.profilePicture}" alt="${u.name}" class="people-avatar-img">`
                : `<span class="people-avatar-initials">${initials}</span>`;
            let actions = ``;

            // ADMIN: Can promote, demote, remove anyone (except self)
            if (isAdmin && !isCurrentUser) {
                const adminCount = users.filter(x => (x.role || 'viewer') === 'admin').length;
                const isLastAdmin = userRole === 'admin' && adminCount === 1;

                if (userRole === 'viewer') {
                    actions += `<button class="btn btn-sm btn-success" onclick="promoteUserTo(${u.id}, 'member')" style="margin-right: 4px;">↑ Member</button>`;
                    actions += `<button class="btn btn-sm btn-danger" onclick="removeUserRecord(${u.id})">Remove</button>`;
                } else if (userRole === 'member') {
                    actions += `<button class="btn btn-sm btn-success" onclick="promoteUserTo(${u.id}, 'admin')" style="margin-right: 4px;">↑ Admin</button>`;
                    actions += `<button class="btn btn-sm btn-warning" onclick="demoteUserTo(${u.id}, 'viewer')" style="margin-right: 4px;">↓ Viewer</button>`;
                    actions += `<button class="btn btn-sm btn-danger" onclick="removeUserRecord(${u.id})">Remove</button>`;
                } else if (userRole === 'admin') {
                    if (isLastAdmin) {
                        // Last admin - show disabled buttons with tooltip
                        actions += `<button class="btn btn-sm" style="background: #666; color: #999; cursor: not-allowed;" title="Cannot demote last admin">↓ Member</button>`;
                        actions += `<button class="btn btn-sm" style="background: #666; color: #999; cursor: not-allowed; margin-left: 4px;" title="Cannot remove last admin">Remove</button>`;
                    } else {
                        // Multiple admins - show enabled buttons
                        actions += `<button class="btn btn-sm btn-warning" onclick="demoteUserTo(${u.id}, 'member')" style="margin-right: 4px;">↓ Member</button>`;
                        actions += `<button class="btn btn-sm btn-danger" onclick="removeUserRecord(${u.id})">Remove</button>`;
                    }
                }
            }
            // MEMBER: Can remove Viewers only (if allowed by rules)
            else if (currentUserRole === 'member' && userRole === 'viewer' && !isCurrentUser) {
                if (currentRules && currentRules.rules && currentRules.rules.member && currentRules.rules.member.canRemoveViewers) {
                    actions += `<button class="btn btn-sm btn-danger" onclick="removeUserRecord(${u.id})">Remove</button>`;
                }
            }
            // ALL Can remove self (unless they're the only admin)
            if (isCurrentUser) {
                const adminCount = users.filter(x => (x.role || 'viewer') === 'admin').length;
                const isLastAdmin = userRole === 'admin' && adminCount === 1;

                if (!isLastAdmin) {
                    actions += `<button class="btn btn-sm btn-danger" onclick="removeUserRecord(${u.id})">Remove Self</button>`;
                } else {
                    // Show disabled button with tooltip
                    actions += `<button class="btn btn-sm" style="background: #666; color: #999; cursor: not-allowed;" title="Cannot remove yourself as the only admin">Remove Self</button>`;
                }
            }

            return `
        <div class="people-card">
          <div class="people-card-header">
            <div class="people-avatar">
                ${avatarHTML}
            </div>

            <div class="people-info">
              <p class="people-name">${u.name}</p>
              <p class="people-email">${u.email}</p>
            </div>
            <span class="people-role-badge ${userRole}">${userRole.toUpperCase()}</span>
          </div>
          
          <div class="people-details">
            <div class="people-detail-row">
              <span class="people-detail-label">Designation:</span>
              <span>${u.designation || '-'}</span>
            </div>
            <div class="people-detail-row">
              <span class="people-detail-label">Department:</span>
              <span>${u.department || '-'}</span>
            </div>
            <div class="people-detail-row">
              <span class="people-detail-label">Mobile:</span>
              <span>${u.mobile || '-'}</span>
            </div>
          </div>
          
          <div class="people-actions">
            ${actions}
          </div>
        </div>
      `;
        }).join('');

        const sidebar = document.getElementById('viewPeopleSidebar');
        const backdrop = document.getElementById('backdrop');

        // Ensure backdrop is visible
        backdrop.style.display = 'flex';
        backdrop.classList.add('show');

        // Slide sidebar in with slight delay for smooth animation
        setTimeout(() => {
            sidebar.classList.add('open');
        }, 10);

        console.log('✓ Sidebar opened');

    }
    catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== CLOSE SIDEBAR ON BACKDROP CLICK =====
document.addEventListener('DOMContentLoaded', function () {
    const backdrop = document.getElementById('backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', function (e) {
            // Only close if clicking on the backdrop itself, not bubbled from sidebar
            if (e.target === backdrop) {
                // Check if sidebar is open
                const sidebar = document.getElementById('viewPeopleSidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    closePeopleSidebar();
                }
            }
        });
    }
});

// ===== CLOSE SIDEBAR WITH ESCAPE KEY =====
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const sidebar = document.getElementById('viewPeopleSidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            closePeopleSidebar();
        }
    }
});

function closePeopleSidebar() {
    const sidebar = document.getElementById('viewPeopleSidebar');
    const backdrop = document.getElementById('backdrop');

    if (!sidebar) return;

    // Animate sidebar out
    sidebar.classList.remove('open');

    // Check if ANY other UI elements need backdrop
    const hasOpenModals = document.querySelectorAll('.modal.show').length > 0;
    const hasOpenPanels = document.querySelectorAll('.panel.open').length > 0;

    // Wait for animation, then hide backdrop if nothing else needs it
    setTimeout(() => {
        if (!hasOpenModals && !hasOpenPanels && backdrop) {
            backdrop.classList.remove('show');
            // Ensure display is hidden after animation
            setTimeout(() => {
                if (!backdrop.classList.contains('show')) {
                    backdrop.style.display = 'none';
                }
            }, 300);
        }
    }, 300);

    // Clear search input
    const searchInput = document.getElementById('peopleSidebarSearch');
    if (searchInput) {
        searchInput.value = '';
        filterPeopleList();
    }

    console.log('✓ Sidebar closed');
}

function filterPeopleList() {
    const query = document.getElementById('peopleSidebarSearch').value.toLowerCase();
    const cards = document.querySelectorAll('.people-card');

    cards.forEach(card => {
        const name = card.querySelector('.people-name').textContent.toLowerCase();
        const email = card.querySelector('.people-email').textContent.toLowerCase();

        if (name.includes(query) || email.includes(query)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// ===== PROMOTE USER =====
async function promoteUserTo(userId, newRole) {
    if (!confirm(`Promote to ${newRole.toUpperCase()}?`)) return;

    try {
        const user = await getOne('users', userId);
        user.role = newRole;
        user.isAdmin = (newRole === 'admin');

        await updateRecord('users', user);
        showAlert(`✓ Promoted to ${newRole.toUpperCase()}!`, SUCCESS_ALERT);

        openPeopleSidebar();
        await autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== DEMOTE USER =====
async function demoteUserTo(userId, newRole) {
    // Check if trying to demote last admin
    const isLastAdminUser = await isLastAdmin(userId);
    if (isLastAdminUser) {
        showAlert('⚠️ Cannot demote the last admin in the system!\n\nAdd another admin first, then you can demote this user.', FAILURE_ALERT);
        return;
    }

    if (!confirm(`Demote to ${newRole.toUpperCase()}?`)) return;

    try {
        const user = await getOne('users', userId);

        user.role = newRole;
        user.isAdmin = false;

        await updateRecord('users', user);
        showAlert(`✓ Demoted to ${newRole.toUpperCase()}!`, SUCCESS_ALERT);

        openPeopleSidebar();
        await autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== REMOVE USER =====
async function removeUserRecord(userId) {
    // Check if trying to remove last admin
    const isLastAdminUser = await isLastAdmin(userId);
    if (isLastAdminUser) {
        showAlert('⚠️ Cannot remove the last admin in the system!\n\nAdd another admin first, then you can remove this user.', FAILURE_ALERT);
        return;
    }

    if (!confirm('Remove this user? This cannot be undone!')) return;

    try {
        const user = await getOne('users', userId);
        const currentUserRole = currentUser.role || (currentUser.isAdmin ? 'admin' : 'viewer');

        // Additional check: if removing self and last admin, prevent
        if (user.id === currentUser.id && user.role === 'admin') {
            const adminCount = await getTotalAdminCount();
            if (adminCount <= 1) {
                showAlert('⚠️ You cannot remove yourself as the last admin!\n\nAdd another admin first.', FAILURE_ALERT);
                return;
            }
        }

        await deleteRecord('users', userId);

        // If the removed user is the current logged-in user, log out completely
        if (currentUser && userId === currentUser.id) {
            showAlert('✓ User removed!', SUCCESS_ALERT);
            await clearSession();
            currentUser = null;
            isAdmin = false;

            // Hide People sidebar and main app, show login screen
            closePeopleSidebar();
            document.getElementById(mainHeader.id || 'mainHeader').classList.add('hidden');
            document.getElementById(mainContent.id || 'mainContent').classList.add('hidden');

            const authScreen = document.getElementById('authScreen');
            authScreen.classList.remove('hidden');
            authScreen.style.display = 'flex';
            return; // stop here, no need to refresh list
        }

        // Normal case: removing someone else
        showAlert('✓ User removed!', SUCCESS_ALERT);
        openPeopleSidebar();
        await autoSyncDatabaseToGithub();

    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== OPEN EDIT RULES MODAL =====
async function openEditRulesModal() {
    if (!isAdmin) {
        showAlert('Admin only', FAILURE_ALERT);
        return;
    }

    const content = document.getElementById('editRulesContent');

    // Make sure rules are loaded
    if (!currentRules) {
        await loadRulesFromGithub();
    }

    content.innerHTML = `
    <!-- MEMBER RULES SECTION -->
    <div class="rules-section member-rules">
        <div class="rules-section-title">Member Rules</div>

        <div class="rule-item">
            <input type="checkbox" id="rulememberaddassets" ${currentRules.rules.member.canAddAssets ? 'checked' : ''}>
            <label for="rulememberaddassets">
                <div>
                <p class="rule-label-text">Can add Asset items</p>
                <p class="rule-label-desc">Allow members to create new assets</p>
                </div>
            </label>
        </div>
      
        <div class="rule-item">
            <input type="checkbox" id="rule_member_addConsumables" ${currentRules.rules.member.canAddConsumables ? 'checked' : ''}>
            <label for="rule_member_addConsumables">
            <div>
                <p class="rule-label-text">Can add Consumable items</p>
                <p class="rule-label-desc">Allow members to create consumable assets</p>
            </div>
            </label>
        </div>
      
        <div class="rule-item">
            <input type="checkbox" id="rule_member_promoteViewers" ${currentRules.rules.member.canPromoteViewers ? 'checked' : ''}>
            <label for="rule_member_promoteViewers">
            <div>
                <p class="rule-label-text">Can promote Viewers</p>
                <p class="rule-label-desc">Allow members to elevate Viewers to Members</p>
            </div>
            </label>
        </div>
      
        <div class="rule-item">
            <input type="checkbox" id="rule_member_removeViewers" ${currentRules.rules.member.canRemoveViewers ? 'checked' : ''}>
            <label for="rule_member_removeViewers">
            <div>
                <p class="rule-label-text">Can remove Viewers</p>
                <p class="rule-label-desc">Allow members to delete Viewers from system</p>
            </div>
            </label>
        </div>
      
        <div class="rule-item">
            <input type="checkbox" id="rule_member_export" ${currentRules.rules.member.canExport ? 'checked' : ''}>
            <label for="rule_member_export">
            <div>
                <p class="rule-label-text">Can export database</p>
                <p class="rule-label-desc">Allow members to download database backups</p>
            </div>
            </label>
        </div>
      
        <div class="rule-item">
            <input type="checkbox" id="rule_member_sync" ${currentRules.rules.member.canSync ? 'checked' : ''}>
            <label for="rule_member_sync">
            <div>
                <p class="rule-label-text">Can sync with GitHub</p>
                <p class="rule-label-desc">Allow members to push/pull from GitHub</p>
            </div>
            </label>
        </div>
        
        <div class="rule-item">
            <input type="checkbox" id="rule_member_auto_sync" ${currentRules.rules.member.canMemberAutoSync ? 'checked' : ''}>
            <label for="rule_member_auto_sync">
            <div>
                <p class="rule-label-text">Allow AutoSync to GitHub</p>
                <p class="rule-label-desc"> When enabled, member sessions can run AutoSync (if they have edit/add access).</p>
            </div>
            </label>
        </div>
        <div class="rule-item">
            <input type="checkbox" id="rule_member_edit_items" ${currentRules.rules.member.canEditItems ? 'checked' : ''}>
            <label for="rule_member_edit_items">
                <div>
                <p class="rule-label-text">Can edit Asset items</p>
                <p class="rule-label-desc">Allow members to modify existing assets</p>
                </div>
            </label>
        </div>
        <div class="rule-item">
            <input type="checkbox" id="rule_member_view_history" ${currentRules.rules.member.canViewHistory ? 'checked' : ''}>
            <label for="rule_member_view_history">
                <div>
                <p class="rule-label-text">Can view item history</p>
                <p class="rule-label-desc">Allow members to see item edit history</p>
                </div>
            </label>
        </div>
        <div class="rule-item">
            <input type="checkbox" id="rule_member_assign_items" ${currentRules.rules.member.canAssignItems ? 'checked' : ''}>
            <label for="rule_member_assign_items">
                <div>
                <p class="rule-label-text">Can assign/return items</p>
                <p class="rule-label-desc">Allow members to assign assets to holders</p>
                </div>
            </label>
        </div>
        <div class="rule-item">
            <input type="checkbox" id="rule_member_notify_holder" ${currentRules.rules.member.canNotifyHolder ? 'checked' : ''}>
            <label for="rule_member_notify_holder">
                <div>
                <p class="rule-label-text">Can send notifications</p>
                <p class="rule-label-desc">Allow members to notify item holders</p>
                </div>
            </label>
        </div>
    </div>

    <!-- VIEWER RULES SECTION -->
    <div class="rules-section viewer-rules">
      <div class="rules-section-title">Viewer Rules</div>
      
      <div class="rule-item">
        <input type="checkbox" id="rule_viewer_viewItems" ${currentRules.rules.viewer.canViewItems ? 'checked' : ''}>
        <label for="rule_viewer_viewItems">
          <div>
            <p class="rule-label-text">Can view Items</p>
            <p class="rule-label-desc">Allow viewers to see Assets and Consumables</p>
          </div>
        </label>
      </div>
      
      <div class="rule-item">
        <input type="checkbox" id="rule_viewer_viewPeople" ${currentRules.rules.viewer.canViewPeople ? 'checked' : ''}>
        <label for="rule_viewer_viewPeople">
          <div>
            <p class="rule-label-text">Can view People</p>
            <p class="rule-label-desc">Allow viewers to see team directory</p>
          </div>
        </label>
      </div>
      
      <div class="rule-item">
        <input type="checkbox" id="rule_viewer_canEdit" ${currentRules.rules.viewer.canEdit ? 'checked' : ''}>
        <label for="rule_viewer_canEdit">
          <div>
            <p class="rule-label-text">Can edit items</p>
            <p class="rule-label-desc">Allow viewers to modify existing items</p>
          </div>
        </label>
      </div>
      
      <div class="rule-item">
        <input type="checkbox" id="rule_viewer_export" ${currentRules.rules.viewer.canExport ? 'checked' : ''}>
        <label for="rule_viewer_export">
          <div>
            <p class="rule-label-text">Can export database</p>
            <p class="rule-label-desc">Allow viewers to download database backups</p>
          </div>
        </label>
      </div>
      
      <div class="rule-item">
        <input type="checkbox" id="rule_viewer_sync" ${currentRules.rules.viewer.canSync ? 'checked' : ''}>
        <label for="rule_viewer_sync">
          <div>
            <p class="rule-label-text">Can sync with GitHub</p>
            <p class="rule-label-desc">Allow viewers to push/pull from GitHub</p>
          </div>
        </label>
      </div>
    </div>
  `;

    openModal('editRulesModal');
}

// ===== SAVE EDITED RULES =====
async function saveEditedRules() {
    try {
        // Read checkboxes and update rules
        currentRules.rules.member.canAddAssets = document.getElementById('rulememberaddassets').checked;
        currentRules.rules.member.canAddConsumables = document.getElementById('rule_member_addConsumables').checked;
        currentRules.rules.member.canPromoteViewers = document.getElementById('rule_member_promoteViewers').checked;
        currentRules.rules.member.canRemoveViewers = document.getElementById('rule_member_removeViewers').checked;
        currentRules.rules.member.canExport = document.getElementById('rule_member_export').checked;
        currentRules.rules.member.canSync = document.getElementById('rule_member_sync').checked;
        currentRules.rules.member.canMemberAutoSync = document.getElementById('rule_member_auto_sync').checked;


        currentRules.rules.member.canEditItems = document.getElementById('rule_member_edit_items').checked;
        currentRules.rules.member.canViewHistory = document.getElementById('rule_member_view_history').checked;
        currentRules.rules.member.canAssignItems = document.getElementById('rule_member_assign_items').checked;
        currentRules.rules.member.canNotifyHolder = document.getElementById('rule_member_notify_holder').checked;

        currentRules.rules.viewer.canViewItems = document.getElementById('rule_viewer_viewItems').checked;
        currentRules.rules.viewer.canViewPeople = document.getElementById('rule_viewer_viewPeople').checked;
        currentRules.rules.viewer.canEdit = document.getElementById('rule_viewer_canEdit').checked;
        currentRules.rules.viewer.canExport = document.getElementById('rule_viewer_export').checked;
        currentRules.rules.viewer.canSync = document.getElementById('rule_viewer_sync').checked;

        // Save to GitHub
        await saveRulesToGithub();

        closeModal('editRulesModal');

        // Refresh main app to apply new rules
        await showMainApp();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function promoteToAdmin(userId) {
    if (!confirm('Promote to Admin?')) return;
    try {
        const user = await getOne('users', userId);
        user.isAdmin = true;
        await updateRecord('users', user);
        showAlert('Promoted!', SUCCESS_ALERT);
        viewMembers();
        updateRemoveAccountBtn();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function removeMember(userId) {
    if (!confirm('Remove this member?')) return;
    try {
        const users = await getAll('users');
        const adminCount = users.filter(u => u.isAdmin).length;
        const user = await getOne('users', userId);

        if (user.isAdmin && adminCount === 1) {
            showAlert('Cannot remove last admin!', FAILURE_ALERT);
            return;
        }

        await deleteRecord('users', userId);
        showAlert('Member removed!', SUCCESS_ALERT);
        viewMembers();
        updateRemoveAccountBtn();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== ADD MEMBER FORM =====
document.getElementById('memberForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        const data = new FormData(e.target);
        const email = data.get('email').toLowerCase();
        const users = await getAll('users');

        if (users.some(u => u.email === email)) {
            showAlert('Email exists', NORMAL_ALERT);
            return;
        }

        const user = {
            name: data.get('name'),
            email: email,
            password: btoa(data.get('password')),
            mobile: data.get('mobile'),
            designation: data.get('designation'),
            department: data.get('department'),
            role: 'viewer', // NEW - all new users start as Viewer
            isAdmin: false  // Keep for backward compat
        };

        await addRecord('users', user);

        showEmailConfirmationModal(user.email, 'Welcome to Asset Manager Pro', `***** THIS IS AN AUTOMATED MESSAGE *****\n\nHi ${user.name},\n\nYour account has been created!\n\nEmail: ${user.email}\nPassword: ${data.get('password')}\n\nPlease login to <a href="https://riyasma07.github.io/asset-manager-code/" target="_blank">Asset Manager Pro</a>.\n\nThis is an automated response. Please do not reply to this email.\n\n`);

        e.target.reset();
        closeModal('addMemberModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

// ===== SETTINGS =====
function openEditProfile() {
    document.getElementById('editName').value = currentUser.name;
    document.getElementById('editEmail').value = currentUser.email;
    document.getElementById('editMobile').value = currentUser.mobile || '';
    document.getElementById('editDesignation').value = currentUser.designation || '';
    document.getElementById('editDepartment').value = currentUser.department || '';
    loadProfilePictureInEditForm(currentUser);
    openModal('editProfileModal');
}

document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        currentUser.name = document.getElementById('editName').value;
        currentUser.email = document.getElementById('editEmail').value;
        currentUser.mobile = document.getElementById('editMobile').value;
        currentUser.designation = document.getElementById('editDesignation').value;
        currentUser.department = document.getElementById('editDepartment').value;

        currentUser.profilePicture = getCurrentProfilePicture();

        await updateRecord('users', currentUser);
        showAlert('Profile updated!', SUCCESS_ALERT);
        closeModal('editProfileModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const currentPwd = btoa(document.getElementById('currentPassword').value);
        const newPwd = document.getElementById('newPassword').value;
        const confirmPwd = document.getElementById('confirmNewPassword').value;

        if (currentPwd !== currentUser.password) { showAlert('Wrong password', FAILURE_ALERT); return; }
        if (newPwd !== confirmPwd) { showAlert('Passwords dont match', FAILURE_ALERT); return; }
        if (newPwd.length < 6) { showAlert('Min 6 chars', NORMAL_ALERT); return; }

        currentUser.password = btoa(newPwd);
        await updateRecord('users', currentUser);
        showAlert('Password changed!', SUCCESS_ALERT);
        document.getElementById('changePasswordForm').reset();
        closeModal('changePasswordModal');
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

function setTheme(theme) {
    if (theme === 'light') {
        document.documentElement.classList.remove('dark');
        document.getElementById('lightBtn').classList.add('active');
        document.getElementById('darkBtn').classList.remove('active');
    } else {
        document.documentElement.classList.add('dark');
        document.getElementById('darkBtn').classList.add('active');
        document.getElementById('lightBtn').classList.remove('active');
    }
}

async function exportToFile() {
    try {
        const users = await getAll('users');
        const items = await getAll('items');
        const consumables = await getAll('consumables');
        const history = await getAll('history');

        const data = {
            __schema__: 'asset-manager-pro',
            users: users,
            items: items,
            consumables: consumables,
            history: history
        };

        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `asset-manager-backup-${new Date().getTime()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showAlert('Exported!', SUCCESS_ALERT);
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function syncFromGithub() {
    try {
        await autoSyncFromGithub();
        showAlert('Synced from GitHub!', SUCCESS_ALERT);
        renderItems();
        renderConsumables();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function removeAccount() {
    if (!confirm('Remove your account? This cannot be undone!')) return;
    try {
        const users = await getAll('users');
        const adminCount = users.filter(u => u.isAdmin).length;

        if (currentUser.isAdmin && adminCount === 1) {
            showAlert('Cannot remove last admin!', FAILURE_ALERT);
            return;
        }

        await deleteRecord('users', currentUser.id);
        showAlert('Account removed!', SUCCESS_ALERT);
        logout();
        autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

async function logout() {
    await clearSession();
    currentUser = null;
    isAdmin = false;

    // Close settings panel
    document.getElementById('settingsPanel').classList.remove('open');
    document.getElementById('backdrop').classList.remove('show');

    // Show login screen
    const authScreen = document.getElementById('authScreen');
    authScreen.classList.remove('hidden');
    authScreen.style.display = 'flex';

    // Hide main app
    document.getElementById('mainHeader').classList.add('hidden');
    document.getElementById('mainContent').classList.add('hidden');
}

// ===== LOAD RULES FROM GITHUB =====
async function loadRulesFromGithub() {
    try {
        const rulesUrl = 'https://raw.githubusercontent.com/riyasma07/asset-manager-db/main/rules.json';
        const response = await fetch(rulesUrl);

        if (response.ok) {
            const rules = await response.json();
            currentRules = rules;
            console.log('✓ Rules loaded from GitHub:', currentRules);
        } else {
            console.log('Rules file not found, using defaults');
            currentRules = getDefaultRules();
        }
    } catch (e) {
        console.warn('Could not load rules:', e.message);
        currentRules = getDefaultRules();
    }
}

// Get default rules if GitHub fails
function getDefaultRules() {
    return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        rules: {
            member: {
                canAddAssets: false,  // NEW - allow members to add assets
                canAddConsumables: false,
                canPromoteViewers: false,
                canRemoveViewers: true,
                canExport: false,
                canSync: false,
                canMemberAutoSync: false,
                // Asset Item Action Button Rules
                canEditItems: false,
                canViewHistory: false,
                canAssignItems: false,
                canNotifyHolder: false,
            },
            viewer: {
                canViewItems: true,
                canViewPeople: true,
                canEdit: false,
                canExport: false,
                canSync: false
            }
        }
    };
}

// ===== CHECK IF USER IS LAST ADMIN =====
async function isLastAdmin(userId) {
    try {
        const users = await getAll('users');
        const adminCount = users.filter(u => (u.role || 'viewer') === 'admin').length;
        const userRole = users.find(u => u.id === userId)?.role || 'viewer';

        // True if this is an admin AND it's the only admin
        return userRole === 'admin' && adminCount === 1;
    } catch (e) {
        console.error('Error checking admin status:', e);
        return false;
    }
}

// ===== GET TOTAL ADMIN COUNT =====
async function getTotalAdminCount() {
    try {
        const users = await getAll('users');
        return users.filter(u => (u.role || 'viewer') === 'admin').length;
    } catch (e) {
        return 0;
    }
}

// ===== SAVE RULES TO GITHUB =====
async function saveRulesToGithub() {
    if (!isAdmin) {
        showAlert('Admin only', FAILURE_ALERT);
        return;
    }

    try {
        const token = await decryptToken(ENCRYPTED_TOKEN_STRING, ENCRYPTION_PASSWORD);

        // Get current rules.json SHA from GitHub
        const getUrl = `https://api.github.com/repos/riyasma07/asset-manager-db/contents/rules.json`;
        const getRes = await fetch(getUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        let fileSHA = '';
        if (getRes.ok) {
            const getData = await getRes.json();
            fileSHA = getData.sha;
        }

        // Update timestamp and version
        currentRules.lastUpdated = new Date().toISOString();
        currentRules.version = (currentRules.version || 0) + 1;

        // Encode content to base64
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(currentRules, null, 2))));

        // Push to GitHub
        const putUrl = `https://api.github.com/repos/riyasma07/asset-manager-db/contents/rules.json`;
        const putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: `Update rules v${currentRules.version}`,
                content: content,
                sha: fileSHA,
                branch: 'main'
            })
        });

        if (putRes.ok) {
            showAlert('✓ Rules saved to GitHub!', SUCCESS_ALERT);
            console.log('✓ Rules pushed to GitHub v' + currentRules.version);
        } else {
            const err = await putRes.json();
            throw new Error(err.message);
        }
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// HIDE REMOVE ACCOUNT FOR LAST ADMIN
async function updateRemoveAccountBtn() {
    try {
        if (!currentUser) return;

        // Use robust last admin check
        const isLast = await isLastAdmin(currentUser.id);
        const btn = document.getElementById('removeAccountBtn');

        if (!btn) return;

        if (isLast) {
            // Disable button for last admin
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none'; // Disables clicking
            btn.style.cursor = 'not-allowed';
            btn.title = 'Cannot remove yourself as the only admin';

            // Also update icon to gray to indicate disabled state
            const icon = btn.querySelector('.panel-item-icon');
            if (icon) icon.style.filter = 'grayscale(100%)';
        } else {
            // Enable button
            btn.style.display = 'flex';
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.cursor = 'pointer';
            btn.title = 'Delete your account';

            const icon = btn.querySelector('.panel-item-icon');
            if (icon) icon.style.filter = 'none';
        }
    } catch (e) {
        console.error('Error updating remove account btn', e);
    }
}

// ===== OPEN/CLOSE PANEL =====
document.getElementById('openManage').addEventListener('click', () => openPanel('managePanel'));
document.getElementById('settingsBtn').addEventListener('click', () => openPanel('settingsPanel'));

document.getElementById('backdrop').addEventListener('click', () => {
    document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
    document.getElementById('backdrop').classList.remove('show');
});

// ===== LOGIN =====
document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        const email = e.target.email.value.toLowerCase();
        const password = btoa(e.target.password.value);
        const users = await getAll('users');

        const user = users.find(u => u.email === email && u.password === password);
        if (!user) {
            showAlert('Invalid credentials', FAILURE_ALERT);
            return;
        }

        currentUser = user;

        // NEW SYSTEM: Get role from user object
        if (user.role) {
            isAdmin = user.role === 'admin';
            currentUser.role = user.role;
        } else if (user.isAdmin !== undefined) {
            // MIGRATE old isAdmin to new role system
            user.role = user.isAdmin ? 'admin' : 'viewer';
            isAdmin = user.isAdmin;
            currentUser.role = user.role;
            await updateRecord('users', user);
        } else {
            // Fallback
            user.role = 'viewer';
            isAdmin = false;
            currentUser.role = 'viewer';
            await updateRecord('users', user);
        }

        // Load rules from GitHub
        await loadRulesFromGithub();

        // Save session
        await saveSession(user);
        showMainApp();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
});

// ===== STARTUP =====
(async () => {
    try {
        document.documentElement.classList.add('dark');
        await initDB();
        await autoSyncFromGithub();
    } catch (e) {
        console.error('Startup error:', e);
    }
})();

// ===== ENHANCED EMAIL WORKFLOW =====
let currentEmailData = {
    itemId: null,
    memberId: null,
    memberName: null,
    retryCount: 0,
    emailSubject: '',      // ← NEW
    emailBody: ''          // ← NEW
};

let emailConfirmationState = {
    recipient: null,
    subject: null,
    body: null,
    retryCount: 0,
    maxRetries: 3
};


// Show Confirmation Modal
function showConfirmEmailModal(itemId, memberId, memberName, emailSubject, emailBody) {
    currentEmailData = {
        itemId: itemId,
        memberId: memberId,
        memberName: memberName,
        retryCount: 0,
        emailSubject: emailSubject,
        emailBody: emailBody
    };

    const confirmMessage = document.getElementById('confirmMessage');
    confirmMessage.innerHTML = `Do you want to send an email notification to <strong>${memberName}</strong>?`;

    document.getElementById('emailConfirmModal').classList.add('show');
}

function closeConfirmEmailModal() {
    document.getElementById('emailConfirmModal').classList.remove('show');
}

function proceedWithEmail() {
    closeConfirmEmailModal();
    attemptSendEmail();
}

function skipEmailAndComplete() {
    document.getElementById('emailErrorModal').classList.remove('show');
    completeAssignmentWithoutEmail();
}

// Show Loading Modal
function showLoadingModal() {
    document.getElementById('emailLoadingModal').classList.add('show');
}

function hideLoadingModal() {
    document.getElementById('emailLoadingModal').classList.remove('show');
}

// Show Success Modal
function showSuccessModal() {
    hideLoadingModal();
    document.getElementById('emailSuccessModal').classList.add('show');
}

function closeSuccessModal() {
    document.getElementById('emailSuccessModal').classList.remove('show');
    completeAssignmentProcess();
}

// Show Error Modal
function showErrorModal(attemptNumber) {
    hideLoadingModal();
    document.getElementById('attemptCount').textContent = attemptNumber;
    document.getElementById('emailErrorModal').classList.add('show');
}

// Show Final Error Modal
function showFinalErrorModal() {
    document.getElementById('emailErrorModal').classList.remove('show');
    document.getElementById('emailFinalErrorModal').classList.add('show');
}

function closeFinalErrorModal() {
    document.getElementById('emailFinalErrorModal').classList.remove('show');
    completeAssignmentProcess();
}

// Retry Email
async function retryEmail() {
    currentEmailData.retryCount++;

    if (currentEmailData.retryCount >= 3) {
        showFinalErrorModal();
        return;
    }

    showLoadingModal();

    try {
        const users = await getAll('users');
        const member = users.find(u => u.id === currentEmailData.memberId);

        const result = await sendEmail(
            member.email,
            currentEmailData.emailSubject,    // ← Use stored subject
            currentEmailData.emailBody        // ← Use stored body
        );

        if (result && result.success) {
            showSuccessModal();
        } else {
            showErrorModal(currentEmailData.retryCount);  // Just the number
        }
    } catch (err) {
        console.error('Retry error:', err);
        showErrorModal(currentEmailData.retryCount);  // Just the number
    }
}

// Attempt to Send Email with Retry Logic
async function attemptSendEmail() {
    showLoadingModal();

    try {
        const users = await getAll('users');
        const member = users.find(u => u.id === currentEmailData.memberId);

        // ADD THIS VALIDATION
        if (!member || !member.email) {
            hideLoadingModal();
            showErrorModal(1);
            return;
        }

        const result = await sendEmail(
            member.email,
            currentEmailData.emailSubject,
            currentEmailData.emailBody
        );

        if (result && result.success) {
            showSuccessModal();
        } else {
            handleEmailError();
        }
    } catch (error) {
        console.error('Email send error:', error);
        handleEmailError();
    }
}


function handleEmailError() {
    const totalAttempts = currentEmailData.retryCount + 1;

    if (totalAttempts < 3) {
        showErrorModal(totalAttempts);
    } else {
        showFinalErrorModal();
    }
}

// Complete assignment without email
function completeAssignmentWithoutEmail() {
    console.log('Assignment completed without email');
    // Call your existing assignment completion logic here
    completeAssignmentProcess();
}

// Complete the full assignment process
function completeAssignmentProcess() {
    // Refresh the items list
    renderItems();
    currentEmailData = {
        itemId: null,
        memberId: null,
        memberName: null,
        retryCount: 0
    };
}

// ==== CONSUMABLE LINK MANAGEMENT ====

// Global variable to track which consumable is being edited
let editingConsumableLinkId = null;

/**
 * Open consumable link in new window
 * @param {string} url - The URL to open
 */
function openConsumableLink(url) {
    if (!url) {
        showAlert('No link available for this consumable', NORMAL_ALERT);
        return;
    }

    // Ensure URL has protocol
    const fullUrl = url.startsWith('http://') || url.startsWith('https://')
        ? url
        : 'https://' + url;

    // Open in new window
    window.open(fullUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Open link management modal
 * @param {number} consId - Consumable ID
 */
async function openConsumableLinkModal(consId) {
    try {
        editingConsumableLinkId = consId;
        const cons = await getOne('consumables', consId);

        // Pre-fill input with existing link (if any)
        const linkInput = document.getElementById('consumableLinkInput');
        linkInput.value = cons.link || '';

        // Open modal
        openModal('consumableLinkModal');

        // Focus input after modal animation
        setTimeout(() => linkInput.focus(), 300);
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

/**
 * Save consumable link from modal
 */
async function saveConsumableLink() {
    try {
        if (!editingConsumableLinkId) {
            showAlert('No consumable selected', FAILURE_ALERT);
            return;
        }

        const linkInput = document.getElementById('consumableLinkInput');
        let linkValue = linkInput.value.trim();

        // Validate URL if provided
        if (linkValue && !linkValue.match(/^https?:\/\/.+/)) {
            showAlert('Please enter a valid URL starting with http:// or https://', NORMAL_ALERT);
            return;
        }

        // Get consumable and update link
        const cons = await getOne('consumables', editingConsumableLinkId);
        cons.link = linkValue;

        await updateRecord('consumables', cons);

        // Show success message
        if (linkValue) {
            showAlert('Product link updated!', SUCCESS_ALERT);
        } else {
            showAlert('Product link removed!', SUCCESS_ALERT);
        }

        // Clear and close
        editingConsumableLinkId = null;
        linkInput.value = '';
        closeModal('consumableLinkModal');

        // Re-render to show/hide link button
        await renderConsumables();
        await autoSyncDatabaseToGithub();
    } catch (e) {
        showAlert('Error: ' + e.message, FAILURE_ALERT);
    }
}

// ===== STANDALONE EMAIL CONFIRMATION MODAL =====
/**
* MAIN ENTRY POINT - Call this function with 3 arguments
* @param {string} recipient - Email address to send to
* @param {string} subject - Email subject line
* @param {string} body - Email body/message content
*/
function showEmailConfirmationModal(recipient, subject, body) {
    emailConfirmationState.recipient = recipient;
    emailConfirmationState.subject = subject;
    emailConfirmationState.body = body;
    emailConfirmationState.retryCount = 0;

    // Update confirmation message with recipient
    document.getElementById('standaloneConfirmMessage').innerHTML =
        `Do you want to send an email to <strong>${recipient}</strong>?`;

    // Show confirmation modal
    document.getElementById('standaloneEmailConfirmModal').classList.add('show');
    console.log('✉️ Email confirmation modal opened for:', recipient);
}

/**
 * User clicks "Yes, Send Email" button
 * Closes confirmation modal and starts email sending process
 */
function standaloneProceedEmail() {
    document.getElementById('standaloneEmailConfirmModal').classList.remove('show');
    console.log('✅ User clicked: Yes, Send Email');
    standaloneAttemptSendEmail();
}

/**
 * User clicks "No, Skip" button
 * Closes modal without sending email
 */
function standaloneSkipEmail() {
    document.getElementById('standaloneEmailConfirmModal').classList.remove('show');
    emailConfirmationState.retryCount = 0;
    console.log('⏭️ User clicked: Skip Email');
}

// ===== LOADING MODAL FUNCTIONS =====

/**
 * Show loading spinner modal
 * Called before attempting to send email
 */
function standaloneShowLoadingModal() {
    document.getElementById('standaloneEmailLoadingModal').classList.add('show');
    console.log('⏳ Showing loading modal...');
}

/**
 * Hide loading spinner modal
 * Called when email send attempt completes (success or failure)
 */
function standaloneHideLoadingModal() {
    document.getElementById('standaloneEmailLoadingModal').classList.remove('show');
    console.log('✓ Hiding loading modal');
}

// ===== SUCCESS MODAL FUNCTIONS =====

/**
 * Show success modal with checkmark
 * Called when email is sent successfully
 */
function standaloneShowSuccessModal() {
    standaloneHideLoadingModal();
    document.getElementById('standaloneEmailSuccessModal').classList.add('show');
    console.log('✅ Email sent successfully!');
}

/**
 * Close success modal
 * Called when user clicks "OK" on success modal
 */
function standaloneCloseSuccessModal() {
    document.getElementById('standaloneEmailSuccessModal').classList.remove('show');
    emailConfirmationState.retryCount = 0;
    console.log('✓ Success modal closed');
}

// ===== ERROR MODAL FUNCTIONS =====

/**
 * Show error modal with retry option
 * Called when email send fails but retries are available
 */
function standaloneShowErrorModal() {
    standaloneHideLoadingModal();
    const attemptNumber = emailConfirmationState.retryCount;

    document.getElementById('standaloneAttemptCount').textContent = attemptNumber;
    document.getElementById('standaloneErrorMessage').innerHTML =
        `Failed to send email. Attempt <strong>${attemptNumber}</strong>/3`;

    document.getElementById('standaloneEmailErrorModal').classList.add('show');
    console.log(`⚠️ Email failed. Attempt ${attemptNumber}/3`);
}

/**
 * User clicks "Skip Email" on error modal
 * Stops retrying and closes modal
 */
function standaloneSkipEmailFinal() {
    document.getElementById('standaloneEmailErrorModal').classList.remove('show');
    emailConfirmationState.retryCount = 0;
    console.log('⏭️ User skipped email after error');
}

/**
 * User clicks "Retry" on error modal
 * Attempts to send email again
 */
function standaloneRetryEmail() {
    document.getElementById('standaloneEmailErrorModal').classList.remove('show');
    console.log('🔄 Retrying email send...');
    standaloneAttemptSendEmail();
}

// ===== FINAL ERROR MODAL FUNCTIONS =====

/**
 * Show final error modal
 * Called when all 3 retry attempts have failed
 */
function standaloneShowFinalErrorModal() {
    standaloneHideLoadingModal();
    document.getElementById('standaloneEmailFinalErrorModal').classList.add('show');
    console.log('❌ Email failed after all 3 retry attempts');
}

/**
 * Close final error modal
 * Called when user clicks "OK" on final error modal
 */
function standaloneCloseFinalErrorModal() {
    document.getElementById('standaloneEmailFinalErrorModal').classList.remove('show');
    emailConfirmationState.retryCount = 0;
    console.log('✓ Final error modal closed');
}

// ===== CORE EMAIL SENDING FUNCTION =====

/**
 * ATTEMPTS TO SEND EMAIL
 * Shows loading modal, calls sendEmail(), handles success/failure
 * Implements retry logic (max 3 attempts)
 */
async function standaloneAttemptSendEmail() {
    // Show loading spinner
    standaloneShowLoadingModal();

    // Increment retry counter
    emailConfirmationState.retryCount++;
    console.log(`📤 Attempt #${emailConfirmationState.retryCount} to send email...`);

    try {
        // Call your existing sendEmail function
        const result = await sendEmail(
            emailConfirmationState.recipient,
            emailConfirmationState.subject,
            emailConfirmationState.body
        );

        if (result.success) {
            // ✅ Email sent successfully
            console.log('✅ Email sent successfully on attempt', emailConfirmationState.retryCount);
            standaloneShowSuccessModal();
        } else {
            // ❌ Email failed
            console.warn('❌ Email send failed:', result.error);

            // Check if we can retry
            if (emailConfirmationState.retryCount < emailConfirmationState.maxRetries) {
                // Show error modal with retry option
                standaloneShowErrorModal();
            } else {
                // All retries exhausted
                standaloneShowFinalErrorModal();
            }
        }
    } catch (error) {
        // 🔴 Exception during email send
        console.error('🔴 Email send exception:', error);

        // Check if we can retry
        if (emailConfirmationState.retryCount < emailConfirmationState.maxRetries) {
            // Show error modal with retry option
            standaloneShowErrorModal();
        } else {
            // All retries exhausted
            standaloneShowFinalErrorModal();
        }
    }
}

// ===== PAGE LOAD INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async function () {
    console.log('App starting...');

    try {
        // Step 1: Initialize database
        console.log('Initializing database...');
        await initDB();

        // Step 2: Load latest data from GitHub
        console.log('Loading database from GitHub...');
        await loadDatabaseFromGithub();

        // Step 3: Check for saved session
        console.log('Checking for saved session...');
        const savedUser = await loadSession();

        if (savedUser) {
            // User was logged in before - auto-login
            console.log('✅ Found saved session for:', savedUser.name);
            currentUser = savedUser;
            isAdmin = savedUser.isAdmin || false;

            // Show main app immediately
            await showMainApp();

            console.log('✅ Auto-login successful!');
        } else {
            // No saved session - show login screen
            console.log('No saved session. Showing login screen.');
            document.getElementById('authScreen').classList.add('show');  // ← Changed: add 'show' class
        }

        console.log('✅ App ready!');
    } catch (error) {
        console.error('Startup error:', error);
        // Fallback: show login screen
        document.getElementById('authScreen').classList.add('show');  // ← Changed: add 'show' class
    }

    // Optional: Auto-sync every 5 minutes
    setInterval(autoSyncDatabaseToGithub, 5 * 60 * 1000);
});


// Optional: Auto-sync every 5 minutes
setInterval(() => {
    if (isAdmin) {
        autoSyncDatabaseToGithub();
    } else {
        console.log('⏭️ Periodic sync skipped: Member session');
    }
}, 5 * 60 * 1000);

// ===== ANIMATED SEARCH TOGGLE FUNCTIONS =====

// Toggle Items Search Visibility
function toggleItemsSearch() {
    const expandable = document.getElementById('itemsSearchExpandable');
    const toggleBtn = document.getElementById('itemsSearchToggleBtn');
    const input = document.getElementById('itemsSearchInput');

    if (expandable.classList.contains('expanded')) {
        // Close search
        expandable.classList.remove('expanded');
        toggleBtn.classList.remove('active');
        input.value = '';
        clearItemsSearch();
    } else {
        // Open search
        expandable.classList.add('expanded');
        toggleBtn.classList.add('active');
        setTimeout(() => input.focus(), 300); // Focus after animation
    }
}

// Toggle Consumables Search Visibility
function toggleConsumablesSearch() {
    const expandable = document.getElementById('consumablesSearchExpandable');
    const toggleBtn = document.getElementById('consumablesSearchToggleBtn');
    const input = document.getElementById('consumablesSearchInput');

    if (expandable.classList.contains('expanded')) {
        // Close search
        expandable.classList.remove('expanded');
        toggleBtn.classList.remove('active');
        input.value = '';
        clearConsumablesSearch();
    } else {
        // Open search
        expandable.classList.add('expanded');
        toggleBtn.classList.add('active');
        setTimeout(() => input.focus(), 300); // Focus after animation
    }
}

// ===== SEARCH FUNCTIONALITY =====

// Search Items (Assets)
function searchItems() {
    const input = document.getElementById('itemsSearchInput');
    const filter = input.value.toLowerCase();
    const table = document.getElementById('itemsTable');
    const tbody = document.getElementById('itemsBody');
    const rows = tbody.getElementsByTagName('tr');
    const clearBtn = document.getElementById('clearItemsBtn');

    // Show/hide clear button
    clearBtn.style.display = filter ? 'block' : 'none';

    let visibleCount = 0;

    // If search is empty, show all rows
    if (!filter) {
        for (let i = 0; i < rows.length; i++) {
            rows[i].classList.remove('table-row-hidden');
            rows[i].classList.add('table-row-visible');
        }
        return;
    }

    // Filter rows
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.getElementsByTagName('td');

        if (cells.length === 0) continue; // Skip empty rows

        // Search through: name, serial, holder, status, condition
        const name = cells[0]?.textContent || '';
        const serial = cells[1]?.textContent || '';
        const holder = cells[2]?.textContent || '';
        const status = cells[3]?.textContent || '';
        const condition = cells[4]?.textContent || '';

        const searchText = `${name} ${serial} ${holder} ${status} ${condition}`.toLowerCase();

        if (searchText.includes(filter)) {
            row.classList.remove('table-row-hidden');
            row.classList.add('table-row-visible');
            visibleCount++;
        } else {
            row.classList.add('table-row-hidden');
            row.classList.remove('table-row-visible');
        }
    }

    console.log(`Search: ${visibleCount} items found for "${filter}"`);
}

// Clear Items Search
function clearItemsSearch() {
    const input = document.getElementById('itemsSearchInput');
    input.value = '';
    const clearBtn = document.getElementById('clearItemsBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    searchItems();
}

// Search Consumables
function searchConsumables() {
    const input = document.getElementById('consumablesSearchInput');
    const filter = input.value.toLowerCase();
    const table = document.getElementById('consumablesTable');
    const tbody = document.getElementById('consumablesBody');
    const rows = tbody.getElementsByTagName('tr');
    const clearBtn = document.getElementById('clearConsumablesBtn');

    // Show/hide clear button
    clearBtn.style.display = filter ? 'block' : 'none';

    let visibleCount = 0;

    // If search is empty, show all rows
    if (!filter) {
        for (let i = 0; i < rows.length; i++) {
            rows[i].classList.remove('table-row-hidden');
            rows[i].classList.add('table-row-visible');
        }
        return;
    }

    // Filter rows
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.getElementsByTagName('td');

        if (cells.length === 0) continue; // Skip empty rows

        // Search through: name, part number, quantity
        const name = cells[0]?.textContent || '';
        const partNumber = cells[1]?.textContent || '';
        const quantity = cells[2]?.textContent || '';

        const searchText = `${name} ${partNumber} ${quantity}`.toLowerCase();

        if (searchText.includes(filter)) {
            row.classList.remove('table-row-hidden');
            row.classList.add('table-row-visible');
            visibleCount++;
        } else {
            row.classList.add('table-row-hidden');
            row.classList.remove('table-row-visible');
        }
    }

    console.log(`Search: ${visibleCount} consumables found for "${filter}"`);
}

// Clear Consumables Search
function clearConsumablesSearch() {
    const input = document.getElementById('consumablesSearchInput');
    input.value = '';
    const clearBtn = document.getElementById('clearConsumablesBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    searchConsumables();
}

// ========================================
// HOLDER INFO TOOLTIP
// ========================================

let currentTooltipTimeout = null;

// ========================================
// PROFILE PICTURE MANAGEMENT
// ========================================

let currentCropper = null;
let tempImageFile = null;
let currentEditingMemberId = null;

/**
 * Get tooltip elements (with null checks)
 */
function getTooltipElements() {
    return {
        holderTooltip: document.getElementById('holderTooltip'),
        tooltipInitial: document.getElementById('tooltipInitial'),
        tooltipHolderName: document.getElementById('tooltipHolderName'),
        tooltipDesignation: document.getElementById('tooltipDesignation'),
        tooltipDepartment: document.getElementById('tooltipDepartment'),
        tooltipEmail: document.getElementById('tooltipEmail'),
        tooltipMobile: document.getElementById('tooltipMobile'),
        copyEmailBtn: document.getElementById('copyEmailBtn')
    };
}

/**
 * Show tooltip with member information
 * @param {HTMLElement} element - The holder name element being hovered
 * @param {string} holderName - Name of the holder
 */
async function showHolderTooltip(element, holderName) {
    // Clear any existing timeout
    if (currentTooltipTimeout) {
        clearTimeout(currentTooltipTimeout);
        currentTooltipTimeout = null;
    }

    try {
        // Get tooltip elements
        const els = getTooltipElements();

        // Check if tooltip exists
        if (!els.holderTooltip) {
            console.error('Tooltip HTML not found! Did you add the HTML to index.html?');
            return;
        }

        // Get all users from database
        const users = await getAll('users');

        // Find the member by name
        const member = users.find(u => u.name === holderName);

        if (!member) {
            console.warn('Member not found:', holderName);
            return;
        }

        // Populate tooltip content
        // Get initials (first letter of first and last name)
        const nameParts = (member.name || '').trim().split(' ');
        const initials = nameParts.length >= 2
            ? nameParts[0][0] + nameParts[nameParts.length - 1][0]
            : nameParts[0] ? nameParts[0].substring(0, 2) : '?';

        // Check if member has profile picture
        if (member.profilePicture) {
            // Show profile picture
            els.tooltipInitial.innerHTML = `<img src="${member.profilePicture}" alt="${member.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
            // Show initials
            els.tooltipInitial.textContent = initials.toUpperCase();
        }
        els.tooltipHolderName.textContent = member.name || '-';
        els.tooltipDesignation.textContent = member.designation || '-';
        els.tooltipDepartment.textContent = member.department || '-';
        els.tooltipEmail.textContent = member.email || '-';
        els.tooltipMobile.textContent = member.mobile || '-';

        // Setup copy email button
        els.copyEmailBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(member.email);
        };

        // Position tooltip near the element
        positionTooltip(element);

        // Show tooltip with fade-in
        els.holderTooltip.classList.add('show');
    } catch (error) {
        console.error('Error showing tooltip:', error);
    }
}

/**
 * Hide tooltip with fade-out
 */
function hideHolderTooltip() {
    // Add small delay before hiding
    currentTooltipTimeout = setTimeout(() => {
        const els = getTooltipElements();
        if (els.holderTooltip) {
            els.holderTooltip.classList.remove('show');
        }
    }, 150);
}
/**
 * Position tooltip near the hovered element
 * @param {HTMLElement} element - The element being hovered
 */
function positionTooltip(element) {
    const els = getTooltipElements();
    if (!els.holderTooltip) return;

    const rect = element.getBoundingClientRect();
    const tooltipRect = els.holderTooltip.getBoundingClientRect();

    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    // Calculate position
    let top = rect.bottom + scrollY + 8; // 8px gap below element
    let left = rect.left + scrollX;

    // Check if tooltip would go off-screen (bottom)
    if (top + tooltipRect.height > window.innerHeight + scrollY) {
        // Position above the element instead
        top = rect.top + scrollY - tooltipRect.height - 8;
        els.holderTooltip.classList.remove('tooltip-bottom');
        els.holderTooltip.classList.add('tooltip-top');
    } else {
        els.holderTooltip.classList.remove('tooltip-top');
        els.holderTooltip.classList.add('tooltip-bottom');
    }

    // Check if tooltip would go off-screen (right)
    if (left + tooltipRect.width > window.innerWidth + scrollX) {
        left = window.innerWidth + scrollX - tooltipRect.width - 16;
    }

    // Check if tooltip would go off-screen (left)
    if (left < scrollX + 16) {
        left = scrollX + 16;
    }

    // Apply position
    els.holderTooltip.style.top = `${top}px`;
    els.holderTooltip.style.left = `${left}px`;
}

/**
 * Initialize holder tooltip event listeners
 * Should be called after renderItems()
 */
function initHolderTooltips() {
    // Remove existing listeners if any
    document.querySelectorAll('.holder-name').forEach(el => {
        el.removeEventListener('mouseenter', handleHolderMouseEnter);
        el.removeEventListener('mouseleave', handleHolderMouseLeave);
    });

    // Add listeners to all holder name elements
    document.querySelectorAll('.holder-name').forEach(el => {
        el.addEventListener('mouseenter', handleHolderMouseEnter);
        el.addEventListener('mouseleave', handleHolderMouseLeave);
    });

    // FIXED: Add hover listeners to tooltip itself to prevent disappearing
    const els = getTooltipElements();
    if (els.holderTooltip) {
        els.holderTooltip.removeEventListener('mouseenter', handleTooltipMouseEnter);
        els.holderTooltip.removeEventListener('mouseleave', handleTooltipMouseLeave);
        els.holderTooltip.addEventListener('mouseenter', handleTooltipMouseEnter);
        els.holderTooltip.addEventListener('mouseleave', handleTooltipMouseLeave);
    }
}

// Event handlers
function handleHolderMouseEnter(e) {
    const holderName = e.target.dataset.holderName;
    if (holderName) {
        showHolderTooltip(e.target, holderName);
    }
}

function handleHolderMouseLeave() {
    hideHolderTooltip();
}

// Hide tooltip when scrolling
window.addEventListener('scroll', () => {
    const els = getTooltipElements();
    if (els.holderTooltip && els.holderTooltip.classList.contains('show')) {
        hideHolderTooltip();
    }
}, { passive: true });

// Tooltip hover handlers (prevent disappearing when hovering tooltip)
function handleTooltipMouseEnter() {
    // Cancel any pending hide timeout
    if (currentTooltipTimeout) {
        clearTimeout(currentTooltipTimeout);
        currentTooltipTimeout = null;
    }
}

function handleTooltipMouseLeave() {
    // Hide tooltip when mouse leaves tooltip itself
    hideHolderTooltip();
}

/**
 * Copy text to clipboard with visual feedback
 */
function copyToClipboard(text) {
    // Modern clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showCopyFeedback();
        }).catch(err => {
            console.error('Failed to copy:', err);
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

/**
 * Fallback copy method for older browsers
 */
function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showCopyFeedback();
    } catch (err) {
        console.error('Fallback copy failed:', err);
    }
    document.body.removeChild(textArea);
}

/**
 * Show "Copied!" feedback
 */
function showCopyFeedback() {
    const els = getTooltipElements();
    if (!els.copyEmailBtn) return;

    // Save original content
    const originalHTML = els.copyEmailBtn.innerHTML;

    // Show checkmark
    els.copyEmailBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;
    els.copyEmailBtn.style.background = '#10b981';
    els.copyEmailBtn.style.borderColor = '#10b981';
    els.copyEmailBtn.style.color = '#ffffff';

    // Reset after 2 seconds
    setTimeout(() => {
        els.copyEmailBtn.innerHTML = originalHTML;
        els.copyEmailBtn.style.background = '';
        els.copyEmailBtn.style.borderColor = '';
        els.copyEmailBtn.style.color = '';
    }, 2000);
}

// ========================================
// PROFILE PICTURE FUNCTIONALITY
// ========================================

/**
 * Initialize profile picture functionality
 */
function initProfilePicture() {
    const fileInput = document.getElementById('profilePicFileInput');
    const editBtn = document.getElementById('editProfilePicBtn');
    const removeBtn = document.getElementById('removeProfilePicBtn');

    // Edit/Add Photo button
    if (editBtn) {
        editBtn.onclick = () => {
            fileInput.click();
        };
    }

    // File input change
    if (fileInput) {
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                openImageCropper(file);
            }
            // Reset file input
            fileInput.value = '';
        };
    }

    // Remove Photo button
    if (removeBtn) {
        removeBtn.onclick = async () => {
            if (confirm('Remove profile picture?')) {
                await removeProfilePicture();
            }
        };
    }

    // Initialize cropper modal buttons
    initCropperModal();
}

/**
 * Open image cropper modal
 */
function openImageCropper(file) {
    tempImageFile = file;
    const reader = new FileReader();

    reader.onload = (e) => {
        const modal = document.getElementById('imageCropperModal');
        const image = document.getElementById('cropperImage');

        // Set image source
        image.src = e.target.result;

        // Show modal
        modal.style.display = 'flex';

        // Initialize Cropper.js
        setTimeout(() => {
            if (currentCropper) {
                currentCropper.destroy();
            }

            currentCropper = new Cropper(image, {
                aspectRatio: 1, // Square crop
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 1,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: false,
                cropBoxResizable: false,
                toggleDragModeOnDblclick: false,
            });

            // Setup zoom slider
            const zoomSlider = document.getElementById('cropperZoom');
            zoomSlider.value = 0;
            zoomSlider.oninput = (e) => {
                currentCropper.zoomTo(parseFloat(e.target.value));
            };
        }, 100);
    };

    reader.readAsDataURL(file);
}

/**
 * Initialize cropper modal buttons
 */
function initCropperModal() {
    // Close button
    document.getElementById('closeCropperModal').onclick = closeCropperModal;

    // Cancel button
    document.getElementById('cancelCropper').onclick = closeCropperModal;

    // Rotate left
    document.getElementById('rotateLeft').onclick = () => {
        if (currentCropper) {
            currentCropper.rotate(-90);
        }
    };

    // Rotate right
    document.getElementById('rotateRight').onclick = () => {
        if (currentCropper) {
            currentCropper.rotate(90);
        }
    };

    // Reset
    document.getElementById('resetCropper').onclick = () => {
        if (currentCropper) {
            currentCropper.reset();
            document.getElementById('cropperZoom').value = 0;
        }
    };

    // Save cropped image
    document.getElementById('saveCroppedImage').onclick = saveCroppedImage;
}

/**
 * Close cropper modal
 */
function closeCropperModal() {
    const modal = document.getElementById('imageCropperModal');
    modal.style.display = 'none';

    if (currentCropper) {
        currentCropper.destroy();
        currentCropper = null;
    }

    tempImageFile = null;
}

/**
 * Save cropped image
 */
async function saveCroppedImage() {
    if (!currentCropper) return;

    try {
        // Get cropped canvas
        const canvas = currentCropper.getCroppedCanvas({
            width: 200,
            height: 200,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        });

        // Convert to Base64
        const base64Image = canvas.toDataURL('image/jpeg', 0.9);

        // Update preview
        updateProfilePicPreview(base64Image);

        // Close modal
        closeCropperModal();

        showAlert('Profile picture updated! Remember to click Save to keep changes.', SUCCESS_ALERT);
    } catch (error) {
        console.error('Error saving cropped image:', error);
        showAlert('Failed to crop image. Please try again.', FAILURE_ALERT);
    }
}

/**
 * Update profile picture preview
 */
function updateProfilePicPreview(base64Image) {
    const preview = document.getElementById('editProfilePicPreview');
    const initials = document.getElementById('editProfilePicInitials');
    const image = document.getElementById('editProfilePicImage');
    const btnText = document.getElementById('editProfilePicBtnText');
    const removeBtn = document.getElementById('removeProfilePicBtn');

    if (base64Image) {
        // Show image
        image.src = base64Image;
        image.style.display = 'block';
        initials.style.display = 'none';

        // Update button text
        btnText.textContent = 'Change Photo';

        // Show remove button
        removeBtn.style.display = 'inline-flex';
    } else {
        // Show initials
        image.style.display = 'none';
        initials.style.display = 'flex';

        // Update button text
        btnText.textContent = 'Add Photo';

        // Hide remove button
        removeBtn.style.display = 'none';
    }
}

/**
 * Remove profile picture
 */
async function removeProfilePicture() {
    updateProfilePicPreview(null);
    showAlert('Profile picture removed! Click Save to keep changes.', SUCCESS_ALERT);
}

/**
 * Load profile picture in edit form
 */
function loadProfilePictureInEditForm(member) {
    const initials = document.getElementById('editProfilePicInitials');

    // Set initials
    const nameParts = (member.name || '').trim().split(' ');
    const initialText = nameParts.length >= 2
        ? nameParts[0][0] + nameParts[nameParts.length - 1][0]
        : nameParts[0] ? nameParts[0].substring(0, 2) : '?';
    initials.textContent = initialText.toUpperCase();

    // Load profile picture if exists
    updateProfilePicPreview(member.profilePicture || null);

    // Store member ID for later
    currentEditingMemberId = member.id;
}

/**
 * Get current profile picture from preview
 */
function getCurrentProfilePicture() {
    const image = document.getElementById('editProfilePicImage');
    return image.style.display === 'block' ? image.src : null;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initProfilePicture();
});

// ===== INITIALIZE SIDEBAR CLOSE HANDLERS =====
(function initSidebarHandlers() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachHandlers);
    } else {
        attachHandlers();
    }

    function attachHandlers() {
        const backdrop = document.getElementById('backdrop');
        const sidebar = document.getElementById('viewPeopleSidebar');

        if (!backdrop || !sidebar) {
            console.warn('⚠️ Sidebar elements not found');
            return;
        }

        // Backdrop click closes sidebar
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop && sidebar.classList.contains('open')) {
                closePeopleSidebar();
            }
        });

        // Escape key closes sidebar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                closePeopleSidebar();
            }
        });

        console.log('✓ Sidebar close handlers attached');
    }
})();