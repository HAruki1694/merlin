const API_BASE = `http://${window.location.hostname}:8000/api`;
const WS_BASE = `ws://${window.location.hostname}:8000/ws`;
const WEBSOCKET_URL = `${WS_BASE}/dashboard`;
let ws;

const nodesContainer = document.getElementById('nodes-container');
const connectionStatus = document.getElementById('connection-status');
const dot = document.querySelector('.dot');
const tabBar = document.getElementById('tab-bar');

// State to track agents
const agents = new Map();
let activeFilter = "";
let globalTags = [];

async function fetchGlobalTags() {
    try {
        const res = await fetch(`${API_BASE}/tags`);
        const data = await res.json();
        globalTags = data.tags || [];
        renderTabs();
        renderAll();
    } catch (e) {
        console.error('Failed to fetch global tags', e);
    }
}

function renderTabs() {
    let tabsHTML = `
        <button class="new-tab-btn" onclick="openTagModal()" title="Create new tag">+</button>
        <div class="tab ${activeFilter === '' ? 'active' : ''}" onclick="switchTab('')">All Machines</div>
    `;
    
    globalTags.forEach(tag => {
        tabsHTML += `
        <div class="tab ${activeFilter === tag ? 'active' : ''}">
            <span onclick="switchTab('${tag}')" style="flex: 1;">${tag}</span>
            <div class="tab-menu-wrapper">
                <button class="tab-menu-btn">⋮</button>
                <div class="tab-menu-dropdown">
                    <button onclick="deleteGlobalTag('${tag}')">Delete</button>
                </div>
            </div>
        </div>`;
    });
    
    tabBar.innerHTML = tabsHTML;
}

window.switchTab = function(tag) {
    activeFilter = tag;
    renderTabs();
    renderAll();
}

function connect() {
    ws = new WebSocket(WEBSOCKET_URL);

    ws.onopen = () => {
        connectionStatus.textContent = 'Connected';
        dot.style.backgroundColor = '#10B981'; // Green
        dot.style.boxShadow = '0 0 10px #10B981';
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === 'init') {
            // Initial data load
            message.data.forEach(agent => {
                agents.set(agent.agent_id, agent);
            });
            renderAll();
        } else if (message.type === 'update') {
            // Real-time update
            agents.set(message.data.agent_id, message.data);
            updateOrRenderCard(message.data);
        } else if (message.type === 'global_tags_update') {
            fetchGlobalTags();
        }
    };

    ws.onclose = () => {
        connectionStatus.textContent = 'Disconnected - Retrying...';
        dot.style.backgroundColor = '#EF4444'; // Red
        dot.style.boxShadow = '0 0 10px #EF4444';
        setTimeout(connect, 3000); // Auto-reconnect
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error: ', error);
    };
}

function createCardHTML(agent, isDead) {
    const tags = agent.tags || [];
    const tagsHTML = tags.length > 0 
        ? tags.map(tag => `<span class="tag" onclick="removeTag('${agent.agent_id}', '${tag}')">${tag}</span>`).join('')
        : `<span class="no-tag-assigned" style="color: #9CA3AF; font-size: 0.85rem; font-style: italic;">No tag assigned</span>`;

    const availableTags = globalTags.filter(t => !tags.includes(t));
    const optionsHTML = availableTags.map(t => `<option value="${t}">${t}</option>`).join('');
    
    const selectHTML = availableTags.length > 0 ? `
        <div class="add-tag-wrapper">
            <select class="tag-select" onchange="if(this.value) addTag(this, '${agent.agent_id}', this.value)">
                <option value="">+ Assign tag</option>
                ${optionsHTML}
            </select>
        </div>` : '';

    const sshHTML = agent.ssh_status 
        ? `<span class="ssh-status ssh-good">● Good to go</span>` 
        : `<span class="ssh-status ssh-failed">● Failed</span>`;

    const unreachableBanner = isDead ? `<div class="unreachable-banner">UNREACHABLE</div>` : '';

    return `
        ${unreachableBanner}
        <div class="card-header">
            <span class="agent-id">ID: ${agent.agent_id}</span>
            <h3 class="ip-address">${agent.ip_address}</h3>
            <div class="hostname-wrapper">
                <span class="hostname-label">${agent.hostname}</span>
                ${sshHTML}
            </div>
        </div>
        <div class="tags-container">
            ${tagsHTML}
            ${selectHTML}
        </div>
        <div class="metrics">
            <div class="metric">
                <span class="label">CPU (${agent.total_cpu_cores || 0} Cores)</span>
                <span class="value">${agent.cpu_percent.toFixed(1)}%</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar ${getColorClass(agent.cpu_percent)}" style="width: ${agent.cpu_percent}%"></div>
                </div>
            </div>
            <div class="metric">
                <span class="label">RAM (${(agent.total_ram_gb || 0).toFixed(1)} GB)</span>
                <span class="value">${agent.ram_percent.toFixed(1)}%</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar ${getColorClass(agent.ram_percent)}" style="width: ${agent.ram_percent}%"></div>
                </div>
            </div>
            <div class="metric">
                <span class="label">Storage (${(agent.total_disk_gb || 0).toFixed(1)} GB)</span>
                <span class="value">${agent.disk_percent.toFixed(1)}%</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar ${getColorClass(agent.disk_percent)}" style="width: ${agent.disk_percent}%"></div>
                </div>
            </div>
        </div>
        <div class="card-footer">
            <button class="show-more-btn" onclick="toggleDetails('${agent.agent_id}')">Show More ▼</button>
            <div class="extra-details hidden" id="details-${agent.agent_id}">
                <div class="detail-row">
                    <span class="detail-label">Last Seen:</span>
                    <span class="detail-value">${agent.last_seen ? new Date(agent.last_seen * 1000).toLocaleString() : 'Never'}</span>
                </div>
            </div>
        </div>
    `;
}

function getColorClass(percentage) {
    if (percentage < 50) return 'good';
    if (percentage < 80) return 'warning';
    return 'danger';
}

function renderAll() {
    nodesContainer.innerHTML = '';
    agents.forEach(agent => {
        if (shouldShowAgent(agent)) {
            updateOrRenderCard(agent);
        }
    });
}

function shouldShowAgent(agent) {
    if (!activeFilter) return true;
    const tags = agent.tags || [];
    return tags.some(t => t.toLowerCase().includes(activeFilter));
}

function updateOrRenderCard(agent) {
    let card = document.getElementById(`agent-${agent.agent_id}`);
    const shouldShow = shouldShowAgent(agent);
    
    const isDead = agent.status === 'unreachable';

    // Preserve the state of the "Show More" section if the card exists
    let isDetailsExpanded = false;
    if (card) {
        const detailsElem = card.querySelector(`#details-${agent.agent_id}`);
        if (detailsElem && !detailsElem.classList.contains('hidden')) {
            isDetailsExpanded = true;
        }
    }

    if (card) {
        if (shouldShow) {
            // Update existing
            card.className = `node-card glass ${isDead ? 'dead-machine' : ''}`;
            card.innerHTML = createCardHTML(agent, isDead);
            
            // Re-apply expansion state
            if (isDetailsExpanded) {
                const detailsElem = card.querySelector(`#details-${agent.agent_id}`);
                const btn = card.querySelector('.show-more-btn');
                if (detailsElem) detailsElem.classList.remove('hidden');
                if (btn) btn.textContent = 'Show Less ▲';
            }
        } else {
            // Remove because it no longer matches filter
            card.remove();
        }
    } else if (shouldShow) {
        // Create new
        card = document.createElement('div');
        card.className = `node-card glass fade-in ${isDead ? 'dead-machine' : ''}`;
        card.id = `agent-${agent.agent_id}`;
        card.innerHTML = createCardHTML(agent, isDead);
        nodesContainer.appendChild(card);
    }
}

window.toggleDetails = function(agentId) {
    const details = document.getElementById(`details-${agentId}`);
    const card = document.getElementById(`agent-${agentId}`);
    const btn = card.querySelector('.show-more-btn');
    
    if (details.classList.contains('hidden')) {
        details.classList.remove('hidden');
        btn.textContent = 'Show Less ▲';
    } else {
        details.classList.add('hidden');
        btn.textContent = 'Show More ▼';
    }
}

// Custom Modal Logic
window.openTagModal = function() {
    const modal = document.getElementById('tag-modal');
    const input = document.getElementById('modal-tag-input');
    modal.classList.remove('hidden');
    input.value = '';
    setTimeout(() => input.focus(), 50); // focus after transition
}

window.closeTagModal = function() {
    document.getElementById('tag-modal').classList.add('hidden');
}

window.submitGlobalTag = async function() {
    const inputElem = document.getElementById('modal-tag-input');
    if (!inputElem) return;
    
    const tag = inputElem.value.trim();
    if (!tag) return;
    
    try {
        await fetch(`${API_BASE}/tags`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: tag})
        });
        
        closeTagModal();
        // Auto-switch to the newly created tab
        switchTab(tag);
    } catch (e) {
        console.error('Failed to create global tag', e);
    }
}

window.deleteGlobalTag = function(tag) {
    window.tagToDelete = tag;
    document.getElementById('delete-tag-name').textContent = `"${tag}"`;
    document.getElementById('delete-tag-modal').classList.remove('hidden');
}

window.closeDeleteTagModal = function() {
    window.tagToDelete = null;
    document.getElementById('delete-tag-modal').classList.add('hidden');
}

window.confirmDeleteGlobalTag = async function() {
    if (!window.tagToDelete) return;
    
    try {
        await fetch(`${API_BASE}/tags/${encodeURIComponent(window.tagToDelete)}`, {
            method: 'DELETE'
        });
        
        if (activeFilter === window.tagToDelete) {
            switchTab(''); // reset filter if active tab is deleted
        }
        closeDeleteTagModal();
    } catch (e) {
        console.error('Failed to delete global tag', e);
    }
}

window.openAddAgentModal = function() {
    document.getElementById('add-agent-modal').classList.remove('hidden');
    
    // Inject the current frontend IP into the bash template so they don't have to change it manually
    const template = document.getElementById('agent-script-template').textContent;
    const backendUrl = `http://${window.location.hostname}:8000/api/metrics`;
    const finalScript = template.replace('__BACKEND_URL__', backendUrl).trim();
    
    document.getElementById('install-script-code').textContent = finalScript;
}

window.closeAddAgentModal = function() {
    document.getElementById('add-agent-modal').classList.add('hidden');
}

window.copyInstallScript = function() {
    const text = document.getElementById('install-script-code').textContent;
    navigator.clipboard.writeText(text);
    
    const btn = document.querySelector('.code-block button');
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
}

window.addTag = async function(selectElem, agentId, tagValue) {
    const tag = tagValue.trim();
    if (!tag) return;
    
    try {
        await fetch(`${API_BASE}/agents/${agentId}/tags`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({tag})
        });
        
        // Reset select dropdown
        if (selectElem) {
            selectElem.value = '';
        }
    } catch (e) {
        console.error('Failed to assign tag', e);
    }
}

window.removeTag = async function(agentId, tag) {
    try {
        await fetch(`${API_BASE}/agents/${agentId}/tags/${tag}`, {
            method: 'DELETE'
        });
    } catch (e) {
        console.error('Failed to remove tag', e);
    }
}

// Periodic check removed since backend now pushes status updates

// Start app
fetchGlobalTags();
connect();
