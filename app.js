/* ------------ Config for server backend ------------ */
const API = {
	LIST: 'list.php',
	UPLOAD: 'upload.php',
	DELETE: 'delete.php',
	RENAME: 'rename.php',
	BASE_URL: 'uploads/'
};

/* ------------ Utilities & Global State ------------ */
const STORAGE_KEY = 'neondrive_files_v1';
const META_KEY = 'neondrive_meta_v1';
const LOCALSTORAGE_BUDGET = 5 * 1024 * 1024; // unused now; left for UI usage bar text
let STATE = {
	files: [],
	adminClicks: 0,
	adminClickTimer: null,
	loggedIn: false,
	sortKey: 'updated-desc',
	search: ''
};

const qs = (sel, el=document) => el.querySelector(sel);
const qsa = (sel, el=document) => Array.from(el.querySelectorAll(sel));

function formatBytes(bytes){ if(bytes === 0) return '0 B'; const k = 1024, sizes = ['B','KB','MB','GB','TB']; const i = Math.floor(Math.log(bytes)/Math.log(k)); return parseFloat((bytes/Math.pow(k,i)).toFixed(2))+' '+sizes[i]; }

function nowIST(){ const now = new Date(); const utc = now.getTime() + (now.getTimezoneOffset()*60000); return new Date(utc + (5*60+30)*60000); }
function istDay(){ return nowIST().getDate(); }
function istClockStr(){ const t = nowIST(); let h = t.getHours(), m = t.getMinutes(); const pad = n => (n<10?'0':'')+n; return pad(h)+':'+pad(m); }

function showToast(message, type='success', timeout=2600){
	const stack = qs('#toastStack');
	const el = document.createElement('div');
	el.className = `toast ${type}`;
	el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
		<div style="font-weight:800">${message}</div>
		<button class="btn mini" style="padding:6px 8px" aria-label="dismiss">Close</button>
	</div>`;
	stack.appendChild(el);
	const close = () => { el.style.animation = 'toastOut .35s ease forwards'; setTimeout(()=> el.remove(), 340); };
	el.querySelector('button').onclick = close;
	if(timeout) setTimeout(close, timeout);
}

// Modal
let modalResolve = null;
function openModal({title, bodyHTML, okText='OK', cancelText='Cancel', showCancel=true}){
	qs('#modalTitle').textContent = title || '';
	qs('#modalBody').innerHTML = bodyHTML || '';
	qs('#modalOk').textContent = okText;
	qs('#modalCancel').textContent = cancelText;
	qs('#modalCancel').style.display = showCancel ? '' : 'none';
	qs('#modalBackdrop').classList.add('active');
	return new Promise((resolve)=>{ modalResolve = resolve; });
}
function closeModal(result=null){ qs('#modalBackdrop').classList.remove('active'); if(modalResolve){ modalResolve(result); modalResolve = null; } }
qs('#modalOk').addEventListener('click', ()=> closeModal({ok:true}));
qs('#modalCancel').addEventListener('click', ()=> closeModal({ok:false}));
qs('#modalBackdrop').addEventListener('click', (e)=> { if(e.target.id==='modalBackdrop') closeModal({ok:false}); });

/* ------------ Server API helpers ------------ */
async function apiList(){
	const res = await fetch(API.LIST, {cache:'no-store'});
	if(!res.ok) throw new Error('List failed');
	return res.json(); // [{name,size,type,mtime,url}]
}
async function apiUpload(files){
	const fd = new FormData();
	for(const f of files) {
		// Preserve folder structure by using webkitRelativePath if available
		const fileName = f.webkitRelativePath || f.name;
		// Add file path as separate field for PHP to access
		fd.append('file_paths[]', fileName);
		fd.append('files[]', f);
	}
	const res = await fetch(API.UPLOAD, { method: 'POST', body: fd });
	if(!res.ok) throw new Error('Upload failed');
	return res.json();
}
async function apiDelete(name){
	const res = await fetch(API.DELETE, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
	if(!res.ok) throw new Error('Delete failed');
	return res.json();
}
async function apiRename(oldName, newName){
	const res = await fetch(API.RENAME, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ oldName, newName }) });
	if(!res.ok) throw new Error('Rename failed');
	return res.json();
}

/* ------------ Auth ------------ */
const FIXED_ID = 'something';
const PW_BASE = 'qw%&:L$%619';
function computedUserPassword(){ return PW_BASE + String(istDay()); }
function tryLogin(id, pw){ if(id !== FIXED_ID){ showToast('Invalid ID', 'error'); return false; } if(pw !== computedUserPassword()){ showToast('Incorrect password', 'error'); return false; } STATE.loggedIn = true; try{ sessionStorage.setItem('neondrive_logged_in', '1'); }catch(e){} showToast('Logged in', 'success'); switchSection('drive'); refreshList(); return true; }
function logout(){ STATE.loggedIn = false; try{ sessionStorage.removeItem('neondrive_logged_in'); localStorage.removeItem('neondrive_logged_in'); }catch(e){} switchSection('login'); showToast('Logged out', 'warn'); }

/* ------------ UI Switch ------------ */
function switchSection(key){ qs('#sectionLogin').classList.remove('active'); qs('#sectionDrive').classList.remove('active'); if(key==='drive'){ qs('#sectionDrive').classList.add('active'); qs('#btnLogout').style.display = ''; renderFiles(); } else { qs('#sectionLogin').classList.add('active'); qs('#btnLogout').style.display = 'none'; } }

/* ------------ Files (server-backed) ------------ */
function toStateFiles(serverItems){
	return serverItems.map(it=>({
		id: `${it.name}-${it.mtime}`,
		name: it.name,
		type: it.type || 'application/octet-stream',
		size: it.size || 0,
		url: it.url || (API.BASE_URL + encodeURIComponent(it.name)),
		createdAt: it.mtime || Date.now(),
		updatedAt: it.mtime || Date.now(),
		backend: 'server'
	}));
}

async function refreshList(){
	try{
		const list = await apiList();
		STATE.files = toStateFiles(list);
		renderFiles();
		updateUsage();
		showToast('Synced with server', 'success');
	}catch(e){ showToast('Could not load files', 'error'); }
}

async function addFiles(fileList){
	const files = Array.from(fileList); if(files.length===0) return;
	
	// Check if this is a folder upload (has webkitRelativePath)
	const isFolderUpload = files.some(f => f.webkitRelativePath);
	
	// Debug logging
	console.log('Uploading files:', files.length);
	if(isFolderUpload) {
		console.log('Folder upload detected');
		files.forEach(f => {
			console.log('File:', f.name, 'Path:', f.webkitRelativePath);
		});
	}
	
	try{ 
		const result = await apiUpload(files); 
		console.log('Upload result:', result);
		
		if(result.errors && result.errors.length > 0) {
			console.error('Upload errors:', result.errors);
			showToast(`Upload completed with ${result.errors.length} error${result.errors.length===1?'':'s'}`, 'warn');
		} else {
			if(isFolderUpload) {
				const folderCount = new Set(files.map(f => f.webkitRelativePath ? f.webkitRelativePath.split('/')[0] : 'root')).size;
				showToast(`Uploaded folder with ${result.uploaded.length} file${result.uploaded.length===1?'':'s'}`, 'success'); 
			} else {
				showToast(`Uploaded ${result.uploaded.length} file${result.uploaded.length===1?'':'s'}`, 'success'); 
			}
		}
		await refreshList(); 
	} catch(e){ 
		console.error('Upload failed:', e);
		showToast('Upload failed: ' + e.message, 'error'); 
	}
}

function downloadFile(file){ const a = document.createElement('a'); a.href = file.url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); }

async function deleteFileById(id){ const f = STATE.files.find(x=>x.id===id); if(!f) return; try{ await apiDelete(f.name); showToast('Deleted', 'warn'); await refreshList(); } catch(e){ showToast('Delete failed', 'error'); } }

async function renameFile(id, newName){ const f = STATE.files.find(x=>x.id===id); if(!f) return; try{ await apiRename(f.name, newName); showToast('Renamed', 'success'); await refreshList(); } catch(e){ showToast('Rename failed', 'error'); } }

function fileIconEmoji(type, name){ 
	if(type.startsWith('image/')) return '🖼️'; 
	if(type.startsWith('video/')) return '🎞️'; 
	if(type==='application/pdf') return '📄'; 
	if(type.includes('zip') || type.includes('compressed')) return '🗜️'; 
	if(type.includes('audio')) return '🎵'; 
	// Check if it's in a folder (has path separators)
	if(name.includes('/') || name.includes('\\')) return '📂';
	return '📁'; 
}

function getFilteredSorted(){ const s = STATE.search.trim().toLowerCase(); let arr = STATE.files.filter(f => f.name.toLowerCase().includes(s)); const [key, dir] = STATE.sortKey.split('-'); arr.sort((a,b)=>{ let v = 0; if(key==='name') v = a.name.localeCompare(b.name); else if(key==='size') v = a.size - b.size; else if(key==='updated') v = a.updatedAt - b.updatedAt; return dir==='asc' ? v : -v; }); return arr; }

function renderFiles(){
	const grid = qs('#fileGrid'); grid.innerHTML = '';
	const list = getFilteredSorted();
	if(list.length===0){ const empty = document.createElement('div'); empty.className = 'tile'; empty.innerHTML = `<div class="row"><div class="name">No files match</div></div><div class="thumb" style="place-items:center; color:var(--text-3); font-weight:800; font-size:48px">✨</div><div class="meta">Upload or change search</div>`; grid.appendChild(empty); return; }
	for(const f of list){
		const div = document.createElement('div'); div.className = 'tile'; const type = f.type || '';
		const isImg = type.startsWith('image/'); const isVid = type.startsWith('video/'); const isPdf = type==='application/pdf';
		const placeholder = `<div style="font-size:42px">${fileIconEmoji(type, f.name)}</div>`;
		let mediaHTML = placeholder;
		if(isImg) mediaHTML = `<img src="${f.url}" alt="" onerror="this.onerror=null; this.replaceWith(document.createElement('div'));">`;
		else if(isVid) mediaHTML = `<video src="${f.url}" muted onerror="this.onerror=null; this.replaceWith(document.createElement('div'));"></video>`;
		else if(isPdf) mediaHTML = `<object data="${f.url}" type="application/pdf" onerror="this.outerHTML='<div></div>'"></object>`;
		const thumbTypeClass = isImg ? 'image' : (isVid ? 'video' : (isPdf ? 'pdf' : ''));
		
		// Show folder structure in the name
		const displayName = f.name.includes('/') ? f.name.split('/').pop() : f.name;
		const folderPath = f.name.includes('/') ? f.name.substring(0, f.name.lastIndexOf('/')) : '';
		
		div.innerHTML = `
			<div class="row">
				<div class="name" title="${f.name}">
					${folderPath ? `<span style="color:var(--text-3);font-size:0.8em">${folderPath}/</span>` : ''}
					${displayName}
				</div>
				<div class="badge">${fileIconEmoji(type, f.name)}</div>
			</div>
			<div class="thumb ${thumbTypeClass}" data-id="${f.id}" data-preview="1">${mediaHTML}</div>
			<div class="row">
				<div class="meta">
					<span>${formatBytes(f.size)}</span>
					<span>•</span>
					<span>${new Date(f.updatedAt).toLocaleString()}</span>
					<span>•</span>
					<span>On Server</span>
				</div>
				<div class="tile-actions">
					<button class="btn mini" data-act="download" data-id="${f.id}">Download</button>
					<button class="btn mini" data-act="rename" data-id="${f.id}">Rename</button>
					<button class="btn mini danger" data-act="delete" data-id="${f.id}">Delete</button>
				</div>
			</div>`;
		grid.appendChild(div);
	}
}

async function openPreview(file){
	let content = ''; const t = file.type || '';
	if(t.startsWith('image/')){ content = `<div style="display:grid;place-items:center"><img src="${file.url}" alt="" style="max-width:100%;border-radius:12px"/></div>`; }
	else if(t.startsWith('video/')){ content = `<video src="${file.url}" controls style="width:100%;border-radius:12px"></video>`; }
	else if(t==='application/pdf'){ content = `<object data="${file.url}" type="application/pdf" style="width:100%;height:70vh;border-radius:12px"></object>`; }
	else{ content = `<div class="badge">No inline preview for this type. You can download it.</div>`; }
	openModal({ title: file.name, bodyHTML: `<div style="display:grid;gap:12px">${content}<div class="row"><span class="badge">${formatBytes(file.size)}</span><a class="btn" href="${file.url}" download>Download</a></div></div>`, okText: 'Close', cancelText: 'Close', showCancel:false }).then(()=>{});
}

/* ------------ Event Wiring ------------ */
// Login
qs('#btnShowPw').addEventListener('click', ()=>{ const el = qs('#loginPw'); el.type = el.type==='password' ? 'text':'password'; });
qs('#btnLogin').addEventListener('click', ()=>{ tryLogin(qs('#loginId').value.trim(), qs('#loginPw').value); });
qs('#btnLogout').addEventListener('click', ()=> logout());

// Enter key submit
qs('#loginPw').addEventListener('keydown', (e)=>{ if(e.key==='Enter') qs('#btnLogin').click(); });
qs('#loginId').addEventListener('keydown', (e)=>{ if(e.key==='Enter') qs('#btnLogin').click(); });

// Drive
qs('#fileInput').addEventListener('change', (e)=> addFiles(e.target.files));
qs('#folderInput').addEventListener('change', (e)=> addFiles(e.target.files));
qs('#searchInput').addEventListener('input', (e)=>{ STATE.search = e.target.value; renderFiles(); });
qs('#sortSelect').addEventListener('change', (e)=>{ STATE.sortKey = e.target.value; renderFiles(); });

qs('#fileGrid').addEventListener('click', async (e)=>{
	const btn = e.target.closest('button'); const thumb = e.target.closest('.thumb');
	if(thumb && thumb.dataset.preview){ const id = thumb.dataset.id; const file = STATE.files.find(f=>f.id===id); if(file) openPreview(file); return; }
	if(!btn) return; const act = btn.dataset.act; const id = btn.dataset.id; const file = STATE.files.find(f=>f.id===id); if(!file) return;
	if(act==='download'){ downloadFile(file); }
	else if(act==='rename'){
		const html = `<div class="input-row"><label>New name</label>
			<input id="renameInput" class="input" value="${file.name}"/></div>`;
		const resP = openModal({title:'Rename File', bodyHTML: html, okText:'Save'});
		setTimeout(()=> qs('#renameInput')?.focus(), 50);
		const res = await resP;
		if(res?.ok){ const newName = qs('#renameInput').value.trim(); if(!newName) return showToast('Name cannot be empty', 'error'); await renameFile(id, newName); }
	}else if(act==='delete'){
		const res = await openModal({ title:'Delete File', bodyHTML:`<div class="badge">Delete <b>${file.name}</b>?</div>`, okText:'Delete', cancelText:'Cancel' });
		if(res?.ok) await deleteFileById(id);
	}
});

// New Folder helper (client-only note)
qs('#btnNewFolder').addEventListener('click', async ()=>{
	const res = await openModal({ title:'Create Folder', bodyHTML:`<div class="badge">Server folders are virtual via names. Use prefixes like <b>Projects/file.png</b> when naming.</div>`, okText:'OK', showCancel:false });
	if(res?.ok){}
});

/* ------------ Clocks & Boot ------------ */
function tickClock(){ const t = istClockStr(); qs('#clockBig').textContent = t; qs('#istClockBadge').textContent = 'IST ' + t; }
setInterval(tickClock, 1000);

tickClock(); if((()=>{ try { return sessionStorage.getItem('neondrive_logged_in')==='1'; } catch(e){ return false; }})()){ STATE.loggedIn = true; switchSection('drive'); refreshList(); } else { switchSection('login'); }

// Drag and drop support
const dropzone = qs('#dropzone');
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
dropzone.addEventListener('drop', (e) => { 
	e.preventDefault(); 
	dropzone.classList.remove('dragover'); 
	const files = Array.from(e.dataTransfer.files);
	if(files.length > 0) addFiles(files);
});

// Shortcut Ctrl/Cmd+K -> focus search
window.addEventListener('keydown', (e)=>{ if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); qs('#searchInput')?.focus(); } });

// Enforce logout on refresh/close and when tab hidden
window.addEventListener('beforeunload', ()=>{ try { sessionStorage.removeItem('neondrive_logged_in'); localStorage.removeItem('neondrive_logged_in'); } catch(e){} });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden'){ try { sessionStorage.removeItem('neondrive_logged_in'); localStorage.removeItem('neondrive_logged_in'); } catch(e){} } });
