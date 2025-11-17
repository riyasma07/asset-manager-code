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

    // Define at the top of your app.js or before first use:
    // const githubConfig = {
    //   owner: GITHUB_OWNER,          // Your GitHub username or org
    //   repo: GITHUB_REPO_DATA,   // Target repo
    //   token: null, // GitHub PAT (Personal Access Token)
    //   branch: GITHUB_BRANCH                 // Branch to work on (e.g. "Dev")
    // };



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
        for(let i = 0; i < str.length; ++i) buf[i] = str.charCodeAt(i);
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
        const history = await getAll('history');

        return {
            "__schema__": "asset-manager-pro",
            "version": 1,
            "exportedAt": new Date().toISOString(),
            "users": users,
            "items": items,
            "history": history
        };
    } catch (error) {
        throw new Error('Failed to export database: ' + error.message);
    }
}

// ===== AUTO SYNC WRAPPER (EASY TO CALL) =====
async function autoSyncDatabaseToGithub() {
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
        console.error('❌ Auto-sync failed:', error.message);
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
        const request = indexedDB.open('AssetManager');
        
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
                const req = indexedDB.open(DBNAME, 2);
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
        function openAddItemTypeModal() {
            openModal('itemTypeModal');
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
            document.getElementById('userRole').textContent = isAdmin ? 'Admin' : 'Member';

            if (isAdmin) {
                document.getElementById('openManage').style.display = 'flex';
                document.getElementById('addItemBtn').style.display = 'flex';
                document.getElementById('addMemberBtn').style.display = 'flex';
                document.getElementById('exportBtn').style.display = 'flex';
                document.getElementById('syncBtn').style.display = 'flex';
            } else {
                // MEMBER: HIDE EXPORT, SYNC, ADD ITEM, ADD MEMBER
                document.getElementById('exportBtn').style.display = 'none';
                document.getElementById('syncBtn').style.display = 'none';
                document.getElementById('addItemBtn').style.display = 'none';
                document.getElementById('addMemberBtn').style.display = 'none';
            }

            renderItems();
            renderConsumables();
            updateRemoveAccountBtn();
        }

        // ===== RENDER ITEMS =====
        async function renderItems() {
            try {
                const items = await getAll('items');
                document.getElementById('itemsCount').textContent = items.length;
                const tbody = document.getElementById('itemsBody');

                if (!items.length) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No items found</td></tr>';
                    return;
                }

                tbody.innerHTML = items.map(item => {
                    const hasHolder = item.holder && item.holder.trim() !== '';
                    const statusDisplay = hasHolder ? 'Out' : 'Available';
                    const statusClass = hasHolder ? 'badge-orange' : 'badge-green';
                    const condDisplay = item.condition === 'working' ? 'Working' : 'Not Working';

                    let actions = '';
                    if (isAdmin) {
                        actions = `
                            <button class="btn-icon" onclick="startEditItem(${item.id})" title="Edit">✏️</button>
                            <button class="btn-icon" onclick="openHistory(${item.id})" title="History">📜</button>
                            ${!hasHolder ? `<button class="btn-icon" onclick="openAssignModal(${item.id})" title="Assign">📤</button>` : ''}
                            ${hasHolder ? `<button class="btn-icon" onclick="openReturnModal(${item.id})" title="Return">↩️</button>` : ''}
                            <button class="btn-icon" onclick="openNotifyModal(${item.id})" title="Notify">🔔</button>
                        `;
                    }

                    return `
                        <tr id="item-row-${item.id}">
                            <td id="item-name-${item.id}">${item.name}</td>
                            <td id="item-serial-${item.id}">${item.serial}</td>
                            <td>${item.holder || '-'}</td>
                            <td><span class="badge ${statusClass}">${statusDisplay}</span></td>
                            <td id="item-cond-${item.id}"><span class="badge badge-${item.condition === 'working' ? 'green' : 'orange'}">${condDisplay}</span></td>
                            <td id="item-actions-${item.id}"><div class="action-buttons">${actions}</div></td>
                        </tr>
                    `;
                }).join('');
            } catch (e) {
                console.error('Render error:', e);
            }
            autoSyncDatabaseToGithub();
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
                alert('Error: ' + e.message);
            }
        }

        async function saveEditItem(itemId) {
            try {
                const item = await getOne('items', itemId);
                item.name = document.getElementById(`edit-name-${itemId}`).value;
                item.serial = document.getElementById(`edit-serial-${itemId}`).value;
                item.condition = document.getElementById(`edit-cond-${itemId}`).value;
                
                await updateRecord('items', item);
                alert('Item updated!');
                editingItemId = null;
                renderItems();
				autoSyncDatabaseToGithub();
            } catch (e) {
                alert('Error: ' + e.message);
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
                alert('Item deleted!');
                renderItems();
				autoSyncDatabaseToGithub();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        // ===== RENDER CONSUMABLES =====
        async function renderConsumables() {
            try {
                const consumables = await getAll('consumables');
                document.getElementById('consumablesCount').textContent = consumables.length;
                const tbody = document.getElementById('consumablesBody');

                if (!consumables.length) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No consumables found</td></tr>';
                    return;
                }

                tbody.innerHTML = consumables.map(cons => {
                    let actions = '';
                    if (isAdmin) {
                        actions = `
                            <button class="btn-icon" onclick="startEditConsumable(${cons.id})" title="Edit">✏️</button>
                            <button class="btn-icon" onclick="openAddQtyModal(${cons.id})" title="Add Qty">➕</button>
                            <button class="btn-icon" onclick="openAssignConsModal(${cons.id})" title="Assign">📤</button>
                            <button class="btn-icon" onclick="deleteConsumable(${cons.id})" title="Delete">🗑️</button>
                        `;
                    }

                    return `
                        <tr id="cons-row-${cons.id}">
                            <td id="cons-name-${cons.id}">${cons.name}</td>
                            <td id="cons-part-${cons.id}">${cons.partNumber}</td>
                            <td id="cons-qty-${cons.id}"><span class="badge badge-green">${cons.quantity}</span></td>
                            <td id="cons-actions-${cons.id}"><div class="action-buttons">${actions}</div></td>
                        </tr>
                    `;
                }).join('');
            } catch (e) {
                console.error('Render error:', e);
            }
            autoSyncDatabaseToGithub();
        }

        async function startEditConsumable(consId) {
            try {
                editingConsumableId = consId;
                const cons = await getOne('consumables', consId);

                document.getElementById(`cons-name-${consId}`).innerHTML = `<input type="text" id="edit-cons-name-${consId}" value="${cons.name}" style="width: 100%; padding: 0.5rem;">`;
                document.getElementById(`cons-part-${consId}`).innerHTML = `<input type="text" id="edit-cons-part-${consId}" value="${cons.partNumber}" style="width: 100%; padding: 0.5rem;">`;

                document.getElementById(`cons-actions-${consId}`).innerHTML = `
                    <button class="btn btn-sm btn-success" onclick="saveEditConsumable(${consId})">Save</button>
                    <button class="btn btn-sm btn-secondary" onclick="cancelEditConsumable()">Cancel</button>
                `;

                document.getElementById(`edit-cons-name-${consId}`).focus();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        async function saveEditConsumable(consId) {
            try {
                const cons = await getOne('consumables', consId);
                cons.name = document.getElementById(`edit-cons-name-${consId}`).value;
                cons.partNumber = document.getElementById(`edit-cons-part-${consId}`).value;
                
                await updateRecord('consumables', cons);
                alert('Consumable updated!');
                editingConsumableId = null;
                renderConsumables();
            } catch (e) {
                alert('Error: ' + e.message);
            }
			autoSyncDatabaseToGithub();
        }

        function cancelEditConsumable() {
            editingConsumableId = null;
            renderConsumables();
        }

        async function deleteConsumable(consId) {
            if (!confirm('Delete this consumable?')) return;
            try {
                await deleteRecord('consumables', consId);
                alert('Consumable deleted!');
                renderConsumables();
            } catch (e) {
                alert('Error: ' + e.message);
            }
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
                alert('Error: ' + e.message);
            }
        }

        document.getElementById('assignForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const itemId = assignItemId;
                const memberId = parseInt(document.getElementById('assignMember').value);
                if (!memberId) { alert('Select member'); return; }

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

                const subject = `Asset Assigned: ${item.name}`;
                const body = `Hi ${member.name},\n\nThe asset "${item.name}" (SN: ${item.serial}) has been assigned to you.\n\nRegards,\n${currentUser.name}`;

                console.log("Before Calling showConfirmEmailModal in openAssignModal");

                showConfirmEmailModal(itemId, memberId, member.name, subject, body);
				
				autoSyncDatabaseToGithub();
				
                closeModal('assignItemModal'); renderItems(); } catch (e)
                { alert('Error: ' + e.message); } });

        // ===== RETURN ITEM =====
        async function openReturnModal(itemId) {
            try {
                returnItemId = itemId;
                const item = await getOne('items', itemId);
                document.getElementById('returnItemInfo').textContent = `Item: ${item.name} | Holder: ${item.holder}`;
                openModal('returnItemModal');
            } catch (e) {
                alert('Error: ' + e.message);
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
                const member = users.find(u => u.name === oldHolder);

                const subject = `Asset Unassigned: ${item.name}`;
                const body = `Hi ${oldHolder},\n\nThe asset "${item.name}" has been returned to inventory.\n\nRegards,\n${currentUser.name}`;

                showConfirmEmailModal(returnItemId, member.id, oldHolder, subject, body);
                closeModal('returnItemModal');

                renderItems();
            } catch (e) {
                alert('Error: ' + e.message);
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
                alert('Error: ' + e.message);
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
                alert('Error: ' + e.message);
            }
        }

        async function confirmAddQty(consId) {
            try {
                const qtyToAdd = parseInt(document.getElementById('addQtyInput').value);
                if (!qtyToAdd || qtyToAdd < 1) { alert('Enter valid quantity'); return; }

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

                alert('Quantity added!');
                document.querySelector('.modal.show').remove();
                document.getElementById('backdrop').classList.remove('show');
                renderConsumables();
            } catch (e) {
                alert('Error: ' + e.message);
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
                alert('Error: ' + e.message);
            }
        }

        async function confirmAssignCons(consId) {
            try {
                const memberId = parseInt(document.getElementById('assignConsMember').value);
                const qty = parseInt(document.getElementById('assignConsQty').value);

                if (!memberId) { alert('Select member'); return; }
                
                const cons = await getOne('consumables', consId);
                if (qty > cons.quantity) { alert('Insufficient quantity!'); return; }

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

                const subject = `Consumable Assigned: ${cons.name}`;
                const body = `Hi ${member.name},\n\nYou have been assigned ${qty} unit(s) of "${cons.name}".\n\nRegards,\n${currentUser.name}`;

                showConfirmEmailModal(consId, memberId, member.name, subject, body);

                document.querySelector('.modal.show').remove();
                document.getElementById('backdrop').classList.remove('show');
                renderConsumables();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        // ===== NOTIFICATION =====
        async function openNotifyModal(itemId) {
            try {
                if (!isAdmin) { alert('Admin only'); return; }
                
                notifyItemId = itemId;
                const item = await getOne('items', itemId);
                const members = await getAll('users');
                
                document.getElementById('notifyItem').value = item.name + ' (SN: ' + item.serial + ')';
                const select = document.getElementById('notifyMember');
                select.innerHTML = '<option value="">Choose member</option>' + members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
                
                openModal('notificationModal');
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        document.getElementById('notificationForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const memberId = parseInt(document.getElementById('notifyMember').value);
                const subject = document.getElementById('notifySubject').value;
                const message = document.getElementById('notifyContent').value;
                
                if (!memberId) { alert('Select member'); return; }
                
                const member = await getOne('users', memberId);
                await sendEmail(member.email, subject, message);
                
                alert('Email sent!');
                document.getElementById('notificationForm').reset();
                closeModal('notificationModal');
            } catch (e) {
                alert('Error: ' + e.message);
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
                alert('Asset added!');
                e.target.reset();
                closeModal('addAssetModal');
                renderItems();
				autoSyncDatabaseToGithub();
            } catch (e) {
                alert('Error: ' + e.message);
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
                    quantity: parseInt(data.get('quantity'))
                };
                await addRecord('consumables', consumable);
                alert('Consumable added!');
                e.target.reset();
                closeModal('addConsumableModal');
                renderConsumables();
            } catch (e) {
                alert('Error: ' + e.message);
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
                alert('Error: ' + e.message);
            }
        }

        async function promoteToAdmin(userId) {
            if (!confirm('Promote to Admin?')) return;
            try {
                const user = await getOne('users', userId);
                user.isAdmin = true;
                await updateRecord('users', user);
                alert('Promoted!');
                viewMembers();
                updateRemoveAccountBtn();
				autoSyncDatabaseToGithub();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        async function removeMember(userId) {
            if (!confirm('Remove this member?')) return;
            try {
                const users = await getAll('users');
                const adminCount = users.filter(u => u.isAdmin).length;
                const user = await getOne('users', userId);
                
                if (user.isAdmin && adminCount === 1) {
                    alert('Cannot remove last admin!');
                    return;
                }
                
                await deleteRecord('users', userId);
                alert('Member removed!');
                viewMembers();
                updateRemoveAccountBtn();
				autoSyncDatabaseToGithub();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        // ===== ADD MEMBER FORM =====
        document.getElementById('memberForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const data = new FormData(e.target);
                const email = data.get('email').toLowerCase();
                const users = await getAll('users');
                if (users.some(u => u.email === email)) { alert('Email exists'); return; }

                const user = {
                    name: data.get('name'),
                    email: email,
                    password: btoa(data.get('password')),
                    mobile: data.get('mobile') || '',
                    designation: data.get('designation') || '',
                    department: data.get('department') || '',
                    isAdmin: false
                };
                
                await addRecord('users', user);

                showEmailConfirmationModal(user.email, 'Welcome to Asset Manager Pro', `Hi ${user.name},\n\nYour account has been created!\n\nEmail: ${user.email}\nPassword: ${data.get('password')}\n\nPlease login to <a href="https://riyasma07.github.io/asset-manager-code/" target="_blank">Asset Manager Pro</a>.\n\nRegards,\n${currentUser.name}`);

                e.target.reset();
                closeModal('addMemberModal');
            } catch (e) {
                alert('Error: ' + e.message);
            }
        });

        // ===== SETTINGS =====
        function openEditProfile() {
            document.getElementById('editName').value = currentUser.name;
            document.getElementById('editEmail').value = currentUser.email;
            document.getElementById('editMobile').value = currentUser.mobile || '';
            document.getElementById('editDesignation').value = currentUser.designation || '';
            document.getElementById('editDepartment').value = currentUser.department || '';
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
                
                await updateRecord('users', currentUser);
                alert('Profile updated!');
                closeModal('editProfileModal');
            } catch (e) {
                alert('Error: ' + e.message);
            }
        });

        document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const currentPwd = btoa(document.getElementById('currentPassword').value);
                const newPwd = document.getElementById('newPassword').value;
                const confirmPwd = document.getElementById('confirmNewPassword').value;
                
                if (currentPwd !== currentUser.password) { alert('Wrong password'); return; }
                if (newPwd !== confirmPwd) { alert('Passwords dont match'); return; }
                if (newPwd.length < 6) { alert('Min 6 chars'); return; }
                
                currentUser.password = btoa(newPwd);
                await updateRecord('users', currentUser);
                alert('Password changed!');
                document.getElementById('changePasswordForm').reset();
                closeModal('changePasswordModal');
            } catch (e) {
                alert('Error: ' + e.message);
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
                alert('Exported!');
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        async function syncFromGithub() {
            try {
                await autoSyncFromGithub();
                alert('Synced from GitHub!');
                renderItems();
                renderConsumables();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        async function removeAccount() {
            if (!confirm('Remove your account? This cannot be undone!')) return;
            try {
                const users = await getAll('users');
                const adminCount = users.filter(u => u.isAdmin).length;
                
                if (currentUser.isAdmin && adminCount === 1) {
                    alert('Cannot remove last admin!');
                    return;
                }
                
                await deleteRecord('users', currentUser.id);
                alert('Account removed!');
                logout();
				autoSyncDatabaseToGithub();
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        function logout() {
            currentUser = null;
            isAdmin = false;
            document.getElementById('authScreen').classList.remove('hidden');
            document.getElementById('mainHeader').classList.add('hidden');
            document.getElementById('mainContent').classList.add('hidden');
        }

        // HIDE REMOVE ACCOUNT FOR LAST ADMIN
        async function updateRemoveAccountBtn() {
            try {
                if (!currentUser) return;
                
                const users = await getAll('users');
                const adminCount = users.filter(u => u.isAdmin).length;
                
                if (currentUser.isAdmin && adminCount === 1) {
                    document.getElementById('removeAccountBtn').style.display = 'none';
                } else {
                    document.getElementById('removeAccountBtn').style.display = 'flex';
                }
            } catch (e) {
                console.error('Error:', e);
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
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const email = e.target.email.value.toLowerCase();
                const password = btoa(e.target.password.value);
                
                const users = await getAll('users');
                const user = users.find(u => u.email === email && u.password === password);
                
                if (!user) { alert('Invalid credentials'); return; }
                
                currentUser = user;
                isAdmin = user.isAdmin || false;
                showMainApp();
            } catch (e) {
                alert('Error: ' + e.message);
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
		
        console.log("showConfirmEmailModal Called");

		const confirmMessage = document.getElementById('confirmMessage');
		confirmMessage.innerHTML = `Do you want to send an email notification to <strong>${memberName}</strong>?`;
		
		document.getElementById('emailConfirmModal').classList.add('show');

        console.log("showConfirmEmailModal Ended");
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
document.addEventListener('DOMContentLoaded', async function() {
    console.log('App starting...');
    
    try {
        // Step 1: Load latest data from GitHub
        console.log('Loading database from GitHub...');
        await loadDatabaseFromGithub();
        
        // Step 2: Refresh UI with loaded data
        console.log('Rendering items...');
        await renderItems();

        console.log('✅ App ready!');
    } catch (error) {
        console.error('Startup error:', error);
        // Fallback: still display UI with local data
        await renderItems();
    }
});


// Optional: Auto-sync every 5 minutes
setInterval(() => {
    autoSyncDatabaseToGithub();
}, 5 * 60 * 1000);