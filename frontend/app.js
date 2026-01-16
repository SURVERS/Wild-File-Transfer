const checkIntervalMs = 1500; 

// === ELEMENTS ===
const tabs = { receive: document.getElementById('tabReceive'), send: document.getElementById('tabSend') };
const panels = { receive: document.getElementById('panelReceive'), send: document.getElementById('panelSend') };

// Receive Elements
const startScreen = document.getElementById('startScreen');
const btnCreateSession = document.getElementById('btnCreateSession');
const loaderReceive = document.getElementById('loaderReceive');
const qrBlock = document.getElementById('qrBlock');
const qrImage = document.getElementById('qrImage');
const shareLink = document.getElementById('shareLink');
const statusDot = document.getElementById('statusDot');
const connectionText = document.getElementById('connectionText');
const successBlock = document.getElementById('successBlock');
const receivedFileList = document.getElementById('receivedFileList');
const receivedText = document.getElementById('receivedText');
const receivedTextContainer = document.getElementById('receivedTextContainer');
const btnCopyText = document.getElementById('btnCopyText');
const btnDownloadAll = document.getElementById('btnDownloadAll');
const btnNewSession = document.getElementById('btnNewSession');
const btnDeleteFiles = document.getElementById('btnDeleteFiles');

// Send Elements
const discoveryInterface = document.getElementById('discoveryInterface');
const sessionsList = document.getElementById('sessionsList');
const noSessionsMsg = document.getElementById('noSessionsMsg');
const uploadInterface = document.getElementById('uploadInterface');
const btnBack = document.getElementById('btnBack');
const sessionIdDisplay = document.getElementById('sessionIdDisplay');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadPreview = document.getElementById('uploadPreview');
const textInput = document.getElementById('textInput');
const btnSend = document.getElementById('btnSend');
const sendLoader = document.getElementById('sendLoader');

// State
let mySessionId = null;
let targetSessionId = null;
let pollInterval = null;
let discoveryInterval = null;
let selectedFiles = [];

// === INIT ===
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionFromUrl = urlParams.get('session');
    if (sessionFromUrl) {
        connectToSession(sessionFromUrl);
    } else {
        switchTab('receive');
        resetReceiveUI();
    }
}

// === TABS ===
function switchTab(mode) {
    if (mode === 'receive') {
        tabs.receive.classList.add('active');
        tabs.send.classList.remove('active');
        panels.receive.classList.add('active');
        panels.send.classList.remove('active');
        stopDiscovery();
    } else {
        tabs.send.classList.add('active');
        tabs.receive.classList.remove('active');
        panels.send.classList.add('active');
        panels.receive.classList.remove('active');
        
        if (targetSessionId) showUpload();
        else showDiscovery();
    }
}

tabs.receive.addEventListener('click', () => switchTab('receive'));
tabs.send.addEventListener('click', () => switchTab('send'));

// === RECEIVE LOGIC ===
btnCreateSession.addEventListener('click', async () => {
    startScreen.classList.add('hidden');
    loaderReceive.classList.remove('hidden');
    try {
        const res = await fetch('/get_qr_code');
        const data = await res.json();
        mySessionId = data.sessionId;
        qrImage.src = data.qrCodeUrl;
        shareLink.href = data.shareUrl;
        shareLink.textContent = data.shareUrl;
        loaderReceive.classList.add('hidden');
        qrBlock.classList.remove('hidden');
        startPolling();
    } catch (e) {
        alert("Ошибка сервера");
        resetReceiveUI();
    }
});

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        if (!mySessionId) return;
        try {
            const res = await fetch(`/session/${mySessionId}`);
            if (res.status === 404) return;
            const data = await res.json();
            
            if (data.connected) {
                statusDot.classList.add('connected');
                connectionText.textContent = "Устройство подключено";
                connectionText.style.color = "#4CF48E";
            }
            if (data.ready) {
                renderSuccess(data);
                clearInterval(pollInterval);
                pollInterval = null;
            }
        } catch(e) {}
    }, checkIntervalMs);
}

function renderSuccess(data) {
    qrBlock.classList.add('hidden');
    successBlock.classList.remove('hidden');

    // 1. Текст
    if (data.text && data.text.trim() !== "") {
        receivedTextContainer.classList.remove('hidden');
        receivedText.textContent = data.text;
    } else {
        receivedTextContainer.classList.add('hidden');
    }

    // 2. Файлы
    receivedFileList.innerHTML = '';
    
    // Проверка на наличие файлов
    if (data.files && data.files.length > 0) {
        // Убираем возможный скрывающий класс
        receivedFileList.classList.remove('hidden'); 
        
        data.files.forEach(file => {
            const a = document.createElement('a');
            a.className = 'file-card';
            a.href = file.url;
            a.target = '_blank';
            a.download = file.name;

            a.innerHTML = `
                <div class="file-icon-box">
                    ${getIconSvg(file.name)}
                </div>
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-meta">${formatBytes(file.size)}</div>
                </div>
                <div class="btn-dl-icon">⬇</div>
            `;
            receivedFileList.appendChild(a);
        });

        // Кнопка скачать всё
        if (data.files.length > 1) {
            btnDownloadAll.classList.remove('hidden');
        } else {
            btnDownloadAll.classList.add('hidden');
        }
    } else {
        // Если файлов нет, скрываем кнопку скачивания
        btnDownloadAll.classList.add('hidden');
    }
}

// Кнопки получателя
btnNewSession.addEventListener('click', async () => {
    if (mySessionId) { try { await fetch(`/delete/${mySessionId}`); } catch(e){} }
    mySessionId = null;
    resetReceiveUI();
});
btnDeleteFiles.addEventListener('click', async () => {
    if (confirm("Удалить файлы?")) { 
        await fetch(`/delete/${mySessionId}`); 
        mySessionId = null; 
        resetReceiveUI(); 
    }
});

function resetReceiveUI() {
    startScreen.classList.remove('hidden');
    loaderReceive.classList.add('hidden');
    qrBlock.classList.add('hidden');
    successBlock.classList.add('hidden');
    statusDot.classList.remove('connected');
    connectionText.textContent = "Ожидание отправителя...";
    connectionText.style.color = "";
    receivedFileList.innerHTML = '';
    receivedTextContainer.classList.add('hidden');
    btnDownloadAll.classList.add('hidden');
}

// === SEND LOGIC ===

function showDiscovery() {
    uploadInterface.classList.add('hidden');
    discoveryInterface.classList.remove('hidden');
    fetchSessions();
    if (discoveryInterval) clearInterval(discoveryInterval);
    discoveryInterval = setInterval(fetchSessions, 1000);
}

function stopDiscovery() {
    if (discoveryInterval) {
        clearInterval(discoveryInterval);
        discoveryInterval = null;
    }
}

async function fetchSessions() {
    try {
        const res = await fetch('/sessions');
        const sessions = await res.json();
        renderSessions(sessions);
    } catch(e) {}
}

function renderSessions(sessions) {
    sessionsList.innerHTML = '';
    const filtered = sessions.filter(s => s.sessionId !== mySessionId);

    if (!filtered || filtered.length === 0) {
        sessionsList.classList.add('hidden');
        noSessionsMsg.classList.remove('hidden');
        return;
    }

    noSessionsMsg.classList.add('hidden');
    sessionsList.classList.remove('hidden');

    filtered.forEach(s => {
        const created = new Date(s.createdAt);
        const now = new Date();
        const diff = Math.floor((now - created) / 1000);
        
        const row = document.createElement('div');
        row.className = 'session-row';
        const icon = s.deviceType === 'Mobile' ? '📱' : '💻';
        
        row.innerHTML = `
            <div class="dev-icon">${icon}</div>
            <div class="dev-info">
                <span class="dev-type">${s.deviceType}</span>
                <span class="dev-name">${s.deviceName}</span>
            </div>
            <div class="dev-timer">${formatTime(diff)}</div>
        `;
        row.addEventListener('click', () => connectToSession(s.sessionId));
        sessionsList.appendChild(row);
    });
}

function formatTime(s) {
    const m = Math.floor(s/60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2,'0')}`;
}

function connectToSession(id) {
    targetSessionId = id;
    sessionIdDisplay.textContent = id;
    switchTab('send');
    showUpload();
    fetch(`/connect?sessionId=${id}`);
}

function showUpload() {
    discoveryInterface.classList.add('hidden');
    uploadInterface.classList.remove('hidden');
    stopDiscovery();
}

btnBack.addEventListener('click', () => {
    targetSessionId = null;
    window.history.pushState({}, document.title, window.location.pathname);
    showDiscovery();
});

// UPLOAD FORM
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
['dragenter','dragover','dragleave','drop'].forEach(e => dropZone.addEventListener(e, preventDefaults));
['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragging')));
['dragleave','drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragging')));

dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
    if (!files.length) return;
    // Добавляем новые файлы к уже выбранным, а не перезаписываем
    const newFiles = Array.from(files);
    selectedFiles = selectedFiles.concat(newFiles);
    
    renderPreview();
    updateSendBtn();
}

function renderPreview() {
    uploadPreview.innerHTML = '';
    if (selectedFiles.length > 0) {
        uploadPreview.classList.remove('hidden');
        selectedFiles.forEach((file, index) => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            // Добавляем кнопку удаления (крестик)
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                    ${getIconSvg(file.name)} <span>${file.name}</span>
                </div>
                <span class="remove-file" onclick="removeFile(${index})">✕</span>
            `;
            uploadPreview.appendChild(div);
        });
        document.querySelector('.drop-title').textContent = `Готово: ${selectedFiles.length} файл(а)`;
    } else {
        uploadPreview.classList.add('hidden');
        document.querySelector('.drop-title').textContent = "Нажмите или перетащите";
    }
}

// Глобальная функция для удаления файла из списка
window.removeFile = function(index) {
    selectedFiles.splice(index, 1);
    renderPreview();
    updateSendBtn();
}

textInput.addEventListener('input', updateSendBtn);

function updateSendBtn() {
    const has = selectedFiles.length > 0 || textInput.value.trim().length > 0;
    btnSend.disabled = !has;
}

btnSend.addEventListener('click', async () => {
    if (!targetSessionId) return;
    
    const fd = new FormData();
    fd.append('sessionId', targetSessionId);
    if (textInput.value.trim()) fd.append('text', textInput.value.trim());
    
    // ВАЖНО: Добавляем файлы правильно
    selectedFiles.forEach(f => fd.append('files', f));
    
    btnSend.classList.add('hidden');
    sendLoader.classList.remove('hidden');
    
    try {
        const res = await fetch('/send_files', { method:'POST', body:fd });
        if(!res.ok) throw new Error();
        
        sendLoader.innerHTML = '<span style="color:#4cf48e; font-weight:bold;">Успешно!</span>';
        setTimeout(() => {
            selectedFiles=[]; 
            textInput.value=''; 
            renderPreview();
            document.querySelector('.drop-title').textContent = "Нажмите или перетащите"; // Сброс текста
            
            sendLoader.classList.add('hidden'); 
            sendLoader.innerHTML='<div class="loader small"></div><span>Загрузка...</span>';
            btnSend.classList.remove('hidden'); 
            updateSendBtn();
        }, 1500);
    } catch(e) {
        console.error(e);
        sendLoader.innerHTML = '<span style="color:#ff5555">Ошибка отправки</span>';
        setTimeout(() => {
            sendLoader.classList.add('hidden'); 
            sendLoader.innerHTML='<div class="loader small"></div><span>Загрузка...</span>';
            btnSend.classList.remove('hidden');
        }, 2000);
    }
});

// === UTILS ===

// Исправленное копирование для HTTP
btnCopyText.addEventListener('click', () => {
    const text = receivedText.textContent;
    fallbackCopyTextToClipboard(text);
});

function fallbackCopyTextToClipboard(text) {
    // 1. Попытка через современный API (работает в HTTPS и Localhost)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopyFeedback, tryManualCopy);
    } else {
        // 2. Фоллбэк для HTTP (старый метод)
        tryManualCopy(text);
    }
}

function tryManualCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text || receivedText.textContent;
    
    // Делаем элемент невидимым, но существующим
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) showCopyFeedback();
        else alert('Не удалось скопировать текст.');
    } catch (err) {
        alert('Браузер блокирует копирование.');
    }
    
    document.body.removeChild(textArea);
}

function showCopyFeedback() {
    btnCopyText.innerHTML = '<span class="copy-icon">✔</span> Скопировано!';
    btnCopyText.style.background = 'rgba(76, 244, 142, 0.2)';
    btnCopyText.style.color = '#4cf48e';
    
    setTimeout(() => {
        btnCopyText.innerHTML = 'Скопировать';
        btnCopyText.style.background = '';
        btnCopyText.style.color = '';
    }, 2000);
}

btnDownloadAll.addEventListener('click', () => {
    if(mySessionId) window.location.href=`/zip/${mySessionId}`;
});

function getIconSvg(name) {
    const ext = name.split('.').pop().toLowerCase();
    let c='#ccc'; let t='FILE';
    if(['jpg','png','jpeg','webp'].includes(ext)) { c='#4CB6F4'; t='IMG'; }
    if(['mp4','mov','avi'].includes(ext)) { c='#F44C4C'; t='VID'; }
    if(['zip','rar','7z'].includes(ext)) { c='#F4D03F'; t='ZIP'; }
    if(['mp3','wav'].includes(ext)) { c='#4CF48E'; t='AUD'; }
    if(['pdf','doc','docx','txt'].includes(ext)) { c='#FFFFFF'; t='DOC'; }
    
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><text x="12" y="18" font-size="6" fill="${c}" stroke="none" text-anchor="middle" font-weight="bold">${t}</text></svg>`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

init();