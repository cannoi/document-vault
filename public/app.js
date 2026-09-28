let currentUser = null;
let storageInfo = null;
let documents = [];
let folders = [];
let tags = [];
let currentFilter = { folder: '', tag: '', status: 'active', search: '' };

async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API request failed');
    return data;
  } catch (err) {
    alert(err.message);
    throw err;
  }
}

async function init() {
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    storageInfo = me.storage;
    await loadAppData();
    renderDashboard();
  } catch (e) {
    renderAuth();
  }
}

async function loadAppData() {
  [documents, folders, tags] = await Promise.all([
    api(`/api/documents?status=${currentFilter.status}${currentFilter.folder ? '&folder_id='+currentFilter.folder : ''}${currentFilter.tag ? '&tag_id='+currentFilter.tag : ''}${currentFilter.search ? '&search='+encodeURIComponent(currentFilter.search) : ''}`),
    api('/api/folders'),
    api('/api/tags')
  ]);
}

function renderAuth() {
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-indigo-800 p-4">
      <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-8">
        <div class="text-center mb-8">
          <i class="fa-solid fa-vault text-5xl text-blue-600 mb-2"></i>
          <h1 class="text-2xl font-bold text-gray-900">Document Vault</h1>
          <p class="text-sm text-gray-500">Secure personal records storage & manager</p>
        </div>

        <div id="auth-form">
          <div class="mb-4">
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Email Address</label>
            <input type="email" id="auth-email" class="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="mb-6">
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Password</label>
            <input type="password" id="auth-password" class="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500">
          </div>

          <button onclick="handleLogin()" class="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition mb-3">Sign In</button>
          <button onclick="handleRegister()" class="w-full bg-gray-100 text-gray-700 font-semibold py-3 rounded-lg hover:bg-gray-200 transition">Create Account</button>
        </div>
      </div>
    </div>
  `;
}

async function handleLogin() {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  if (!email || !password) return alert('Please enter email and password');
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    init();
  } catch (e) {}
}

async function handleRegister() {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  if (!email || !password) return alert('Please enter email and password');
  try {
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    init();
  } catch (e) {}
}

async function handleLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  renderAuth();
}

function renderDashboard() {
  const usedGB = (storageInfo.used_bytes / (1024*1024*1024)).toFixed(2);
  const quotaGB = (storageInfo.quota_bytes / (1024*1024*1024)).toFixed(1);

  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col">
      <!-- Top Header -->
      <header class="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm">
        <div class="flex items-center space-x-3">
          <i class="fa-solid fa-vault text-2xl text-blue-600"></i>
          <span class="text-xl font-bold text-gray-900">Document Vault</span>
        </div>
        <div class="flex items-center space-x-4">
          <div class="text-right hidden sm:block">
            <p class="text-sm font-semibold text-gray-800">${currentUser.display_name || currentUser.email}</p>
            <p class="text-xs text-gray-500">Storage: ${usedGB} GB / ${quotaGB} GB (${storageInfo.percentage}%)</p>
          </div>
          <button onclick="handleLogout()" class="text-gray-500 hover:text-red-600 p-2" title="Sign Out"><i class="fa-solid fa-right-from-bracket text-lg"></i></button>
        </div>
      </header>

      <div class="flex-1 flex flex-col md:flex-row">
        <!-- Sidebar -->
        <aside class="w-full md:w-64 bg-white border-r border-gray-200 p-4 space-y-6">
          <button onclick="openUploadModal()" class="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-cloud-arrow-up"></i><span>Upload Document</span>
          </button>

          <div>
            <p class="text-xs font-semibold uppercase text-gray-400 mb-2 px-2">Navigation</p>
            <div class="space-y-1">
              <button onclick="filterStatus('active', '')" class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${currentFilter.status === 'active' && !currentFilter.folder && !currentFilter.tag ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}">
                <i class="fa-solid fa-folder-open w-6"></i> All Documents
              </button>
              <button onclick="filterStatus('deleted', '')" class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${currentFilter.status === 'deleted' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}">
                <i class="fa-solid fa-trash w-6"></i> Trash
              </button>
            </div>
          </div>

          <div>
            <div class="flex justify-between items-center px-2 mb-2">
              <p class="text-xs font-semibold uppercase text-gray-400">Folders</p>
              <button onclick="openFolderModal()" class="text-blue-600 hover:text-blue-800 text-xs"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
            <div class="space-y-1 max-h-40 overflow-y-auto">
              ${folders.map(f => `
                <button onclick="filterFolder(${f.id})" class="w-full text-left px-3 py-1.5 rounded-lg text-sm truncate ${currentFilter.folder == f.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-100'}">
                  <i class="fa-solid fa-folder w-5 text-yellow-500"></i> ${f.name}
                </button>
              `).join('')}
            </div>
          </div>

          <div>
            <div class="flex justify-between items-center px-2 mb-2">
              <p class="text-xs font-semibold uppercase text-gray-400">Tags</p>
              <button onclick="openTagModal()" class="text-blue-600 hover:text-blue-800 text-xs"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
            <div class="flex flex-wrap gap-1 px-2">
              ${tags.map(t => `
                <button onclick="filterTag(${t.id})" class="px-2.5 py-1 rounded-full text-xs font-medium ${currentFilter.tag == t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}">
                  #${t.name}
                </button>
              `).join('')}
            </div>
          </div>
        </aside>

        <!-- Main Content -->
        <main class="flex-1 p-6">
          <!-- Search & Filters Bar -->
          <div class="mb-6 flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div class="relative w-full sm:w-96">
              <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400"><i class="fa-solid fa-search"></i></span>
              <input type="text" id="search-input" value="${currentFilter.search || ''}" oninput="handleSearchInput(this.value)" placeholder="Search documents, notes, tags..." class="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
            </div>
            <div class="text-sm text-gray-500">
              Showing ${documents.length} records
            </div>
          </div>

          <!-- Documents Table / Grid -->
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th class="p-4">Document Name</th>
                    <th class="p-4">Folder</th>
                    <th class="p-4">Tags</th>
                    <th class="p-4">Size</th>
                    <th class="p-4">Uploaded</th>
                    <th class="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 text-sm">
                  ${documents.length === 0 ? `
                    <tr><td colspan="6" class="p-8 text-center text-gray-400">No documents found</td></tr>
                  ` : documents.map(d => `
                    <tr class="hover:bg-gray-50">
                      <td class="p-4">
                        <div class="font-semibold text-gray-900">${d.original_name}</div>
                        <div class="text-xs text-gray-500 truncate max-w-xs">${d.description || d.notes || ''}</div>
                      </td>
                      <td class="p-4 text-gray-600">${d.folder_name || '-'}</td>
                      <td class="p-4">
                        <div class="flex flex-wrap gap-1">
                          ${d.tags.map(t => `<span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">#${t.name}</span>`).join('')}
                        </div>
                      </td>
                      <td class="p-4 text-gray-500">${(d.size_bytes / 1024).toFixed(1)} KB</td>
                      <td class="p-4 text-gray-500">${new Date(d.created_at).toLocaleDateString()}</td>
                      <td class="p-4 text-right space-x-2">
                        <button onclick="previewDoc(${d.id}, '${d.mime_type}')" class="text-blue-600 hover:text-blue-800" title="Preview"><i class="fa-solid fa-eye"></i></button>
                        <button onclick="downloadDoc(${d.id})" class="text-gray-600 hover:text-gray-800" title="Download"><i class="fa-solid fa-download"></i></button>
                        ${currentFilter.status === 'deleted' ? `
                          <button onclick="restoreDoc(${d.id})" class="text-green-600 hover:text-green-800" title="Restore"><i class="fa-solid fa-rotate-left"></i></button>
                          <button onclick="permDeleteDoc(${d.id})" class="text-red-600 hover:text-red-800" title="Delete Permanently"><i class="fa-solid fa-trash"></i></button>
                        ` : `
                          <button onclick="editDoc(${d.id})"; class="text-gray-600 hover:text-gray-800" title="Edit"><i class="fa-solid fa-pen"></i></button>
                          <button onclick="trashDoc(${d.id})" class="text-red-600 hover:text-red-800" title="Move to Trash"><i class="fa-solid fa-trash"></i></button>
                        `}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>

    <!-- Modal Container -->
    <div id="modal-root"></div>
  `;
}

function filterStatus(status, folder) {
  currentFilter.status = status;
  currentFilter.folder = folder;
  currentFilter.tag = '';
  loadAppData().then(renderDashboard);
}

function filterFolder(folderId) {
  currentFilter.folder = folderId;
  currentFilter.tag = '';
  loadAppData().then(renderDashboard);
}

function filterTag(tagId) {
  currentFilter.tag = tagId;
  currentFilter.folder = '';
  loadAppData().then(renderDashboard);
}

let searchTimer;
function handleSearchInput(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentFilter.search = val;
    loadAppData().then(renderDashboard);
  }, 300);
}

function openUploadModal() {
  document.getElementById('modal-root').innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-xl max-w-lg w-full p-6">
        <h2 class="text-lg font-bold mb-4">Upload Document</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Select File</label>
            <input type="file" id="upload-file" class="w-full border rounded-lg p-2 text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Folder</label>
            <select id="upload-folder" class="w-full border rounded-lg p-2 text-sm">
              <option value="">None (Root)</option>
              ${folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Description</label>
            <input type="text" id="upload-desc" class="w-full border rounded-lg p-2 text-sm" placeholder="Brief description">
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Notes</label>
            <textarea id="upload-notes" class="w-full border rounded-lg p-2 text-sm" placeholder="Additional secure notes"></textarea>
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-gray-600 mb-1">Tags</label>
            <div class="flex flex-wrap gap-2 max-h-24 overflow-y-auto border p-2 rounded-lg">
              ${tags.map(t => `<label class="inline-flex items-center space-x-1 text-xs"><input type="checkbox" value="${t.id}" class="upload-tag-cb"><span>#${t.name}</span></label>`).join('')}
            </div>
          </div>
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button onclick="closeModal()" class="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          <button onclick="submitUpload()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">Upload</button>
        </div>
      </div>
    </div>
  `;
}

async function submitUpload() {
  const fileInput = document.getElementById('upload-file');
  if (!fileInput.files[0]) return alert('Please select a file');
  const file = fileInput.files[0];

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64 = e.target.result.split(',')[1];
    const folder_id = document.getElementById('upload-folder').value;
    const description = document.getElementById('upload-desc').value;
    const notes = document.getElementById('upload-notes').value;
    const tag_ids = Array.from(document.querySelectorAll('.upload-tag-cb:checked')).map(cb => parseInt(cb.value));

    try {
      await api('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          original_name: file.name,
          content_base64: base64,
          mime_type: file.type,
          folder_id: folder_id ? parseInt(folder_id) : null,
          description,
          notes,
          tag_ids
        })
      });
      closeModal();
      init();
    } catch (err) {}
  };
  reader.readAsDataURL(file);
}

function openFolderModal() {
  document.getElementById('modal-root').innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-xl max-w-sm w-full p-6">
        <h2 class="text-lg font-bold mb-4">Create Folder</h2>
        <input type="text" id="new-folder-name" class="w-full border rounded-lg p-2 text-sm mb-4" placeholder="Folder Name">
        <div class="flex justify-end space-x-2">
          <button onclick="closeModal()" class="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
          <button onclick="submitFolder()" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Create</button>
        </div>
      </div>
    </div>
  `;
}

async function submitFolder() {
  const name = document.getElementById('new-folder-name').value;
  if (!name) return;
  await api('/api/folders', { method: 'POST', body: JSON.stringify({ name }) });
  closeModal();
  init();
}

function openTagModal() {
  document.getElementById('modal-root').innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-xl max-w-sm w-full p-6">
        <h2 class="text-lg font-bold mb-4">Create Tag</h2>
        <input type="text" id="new-tag-name" class="w-full border rounded-lg p-2 text-sm mb-4" placeholder="Tag Name">
        <div class="flex justify-end space-x-2">
          <button onclick="closeModal()" class="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
          <button onclick="submitTag()" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Create</button>
        </div>
      </div>
    </div>
  `;
}

async function submitTag() {
  const name = document.getElementById('new-tag-name').value;
  if (!name) return;
  await api('/api/tags', { method: 'POST', body: JSON.stringify({ name }) });
  closeModal();
  init();
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

function downloadDoc(id) {
  window.open(`/api/documents/${id}/download`, '_blank');
}

function previewDoc(id, mimeType) {
  if (mimeType.includes('pdf') || mimeType.includes('image')) {
    document.getElementById('modal-root').innerHTML = `
      <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl max-w-4xl w-full h-[85vh] flex flex-col p-4">
          <div class="flex justify-between items-center mb-2">
            <h3 class="font-bold">Document Preview</h3>
            <button onclick="closeModal()" class="text-gray-500 hover:text-black"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <div class="flex-1 bg-gray-100 rounded overflow-hidden flex items-center justify-center">
            <iframe src="/api/documents/${id}/preview" class="w-full h-full border-0"></iframe>
          </div>
        </div>
      </div>
    `;
  } else {
    downloadDoc(id);
  }
}

async function trashDoc(id) {
  if (!confirm('Move document to trash?')) return;
  await api(`/api/documents/${id}/trash`, { method: 'POST' });
  init();
}

async function restoreDoc(id) {
  await api(`/api/documents/${id}/restore`, { method: 'POST' });
  init();
}

async function permDeleteDoc(id) {
  if (!confirm('Permanently delete this document? This cannot be undone.')) return;
  await api(`/api/documents/${id}`, { method: 'DELETE' });
  init();
}

init();
