/* ============================================================
   NOWPLACE — MVP
   Câmera dupla (input nativo) · Geolocalização + reverse geocode
   Storage local (regra das 24h) · Cards com drag-and-drop

   NOTA SOBRE STORAGE:
   Este projeto roda fora do ambiente de artifacts da Claude, então
   trocamos a API window.storage por localStorage. Isso funciona
   perfeitamente para testar a regra "só posso ver Nows se postei
   nas últimas 24h" sozinho, no seu navegador.

   Só que localStorage é local a cada navegador/dispositivo — ele
   NÃO compartilha dados entre usuários diferentes. Para um feed
   de verdade, com várias pessoas postando e vendo os Nows umas
   das outras, você vai precisar trocar essas funções por chamadas
   a um backend real (Firebase, Supabase, seu próprio servidor +
   banco de dados, etc). O resto do app (câmera, geo, drag&drop,
   regra das 24h) já está pronto e não muda.
   ============================================================ */

const DAY_MS = 24 * 60 * 60 * 1000;

const state = {
  me: null,              // {userId, nickname, lastPostAt}
  position: null,        // {lat, lon}
  positionError: null,
  feed: [],
  feedLoaded: false,
  capture: { step: 0, env: null, selfie: null, place: null, coords: null, caption: '' },
  cardMainOverride: {}   // postId -> 'env' | 'selfie'  (preferência de visualização, client-side)
};

/* ---------------- STORAGE HELPERS (localStorage) ---------------- */
function storeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) { console.error('storage.set falhou', e); return null; }
}
function storeListKeys(prefix) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

/* ---------------- GEO + REVERSE GEOCODE ---------------- */
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocalização indisponível neste navegador.')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}
async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1`);
    if (!res.ok) throw new Error('geocode falhou');
    const data = await res.json();
    const a = data.address || {};
    const place = a.amenity || a.shop || a.leisure || a.building || a.office || a.tourism;
    const street = a.road;
    const city = a.suburb || a.city || a.town || a.village || a.municipality;
    const label = [place, street || city].filter(Boolean).join(', ');
    return label || data.display_name || 'Local não identificado';
  } catch (e) {
    return 'Local não identificado';
  }
}
function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60); if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24); return `há ${d} d`;
}

/* ---------------- IMAGE HELPERS (câmera nativa) ---------------- */
function fileToCompressedDataURL(file, maxWidth = 480, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Foto inválida.'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- INIT / ONBOARDING ---------------- */
async function initApp() {
  state.me = storeGet('nowplace:me');
  if (!state.me) {
    renderOnboarding();
    return;
  }
  await refreshLockState();
}

function isLocked() {
  if (!state.me || !state.me.lastPostAt) return true;
  return (Date.now() - state.me.lastPostAt) > DAY_MS;
}

async function refreshLockState() {
  if (isLocked()) {
    render();
    return;
  }
  await loadFeed();
  render();
}

async function loadFeed() {
  try { state.position = await getPosition(); state.positionError = null; }
  catch (e) { state.positionError = e.message || 'Não foi possível obter sua localização.'; }

  const keys = storeListKeys('nowplace:post:');
  const posts = keys.map(k => storeGet(k)).filter(Boolean);
  posts.sort((a, b) => b.timestamp - a.timestamp);
  if (state.position) {
    posts.forEach(p => { p._dist = distanceKm(state.position, { lat: p.lat, lon: p.lon }); });
  }
  state.feed = posts;
  state.feedLoaded = true;
}

/* ---------------- RENDER: ONBOARDING ---------------- */
function renderOnboarding() {
  const root = document.getElementById('appRoot');
  document.getElementById('fabBtn').style.display = 'none';
  root.innerHTML = `
    <div class="onboard">
      <div class="wordmark display" style="font-size:30px;"><span class="dot"></span>NowPlace</div>
      <h1 class="display" style="margin-top:22px;">Onde você<br>está agora?</h1>
      <p>Registre o ambiente e uma selfie, sem edição, sem atraso. Você só vê o que está perto quando também mostra onde está.</p>
      <div class="field">
        <label>Como querem te chamar</label>
        <input id="nickInput" maxlength="20" placeholder="ex: bia.cruzeiro" autocomplete="off">
      </div>
      <button class="btn-primary" id="nickBtn" disabled>Entrar no NowPlace</button>
    </div>
  `;
  const input = document.getElementById('nickInput');
  const btn = document.getElementById('nickBtn');
  input.addEventListener('input', () => { btn.disabled = input.value.trim().length < 2; });
  btn.addEventListener('click', async () => {
    const nickname = input.value.trim();
    if (nickname.length < 2) return;
    state.me = { userId: crypto.randomUUID(), nickname, lastPostAt: null };
    storeSet('nowplace:me', state.me);
    document.getElementById('fabBtn').style.display = 'flex';
    await refreshLockState();
  });
}

/* ---------------- RENDER: MAIN APP ---------------- */
function render() {
  const root = document.getElementById('appRoot');
  const locked = isLocked();
  const statusHtml = locked
    ? `<div class="status-pill locked"><span class="pulse-dot"></span>BLOQUEADO</div>`
    : `<div class="status-pill unlocked"><span class="pulse-dot"></span>DESBLOQUEADO</div>`;

  root.innerHTML = `
    <header class="hud">
      <div class="hud-row">
        <div class="wordmark display"><span class="dot"></span>NowPlace</div>
        ${statusHtml}
      </div>
      <div class="subrow">
        <span>${state.me.nickname}</span>
        <button class="devlink" id="devReset">simular novo dia (reset)</button>
      </div>
    </header>
    <main id="mainArea"></main>
  `;
  document.getElementById('devReset').addEventListener('click', async () => {
    state.me.lastPostAt = null;
    storeSet('nowplace:me', state.me);
    render();
  });

  const main = document.getElementById('mainArea');
  if (locked) {
    main.innerHTML = gateHTML();
    startCountdown();
  } else {
    main.innerHTML = feedHTML();
    wireCardDrag();
  }
}

/* ---------------- GATE (BLOQUEADO) ---------------- */
function gateHTML() {
  return `
    <div class="gate">
      <div class="radar">
        <div class="ring r1"></div>
        <div class="ring r2"></div>
        <div class="lock">🔒</div>
      </div>
      <h2 class="display">Área bloqueada</h2>
      <p>Para ver os Nows de quem está por perto, primeiro registre onde você está. É assim que o NowPlace garante que todo mundo mostrou o jogo antes de assistir.</p>
      ${state.me.lastPostAt ? `<div class="countdown mono" id="countdown"></div>` : ''}
      <button class="btn-primary" onclick="openCapture()" style="max-width:280px;">Registrar meu Now</button>
    </div>
  `;
}
function startCountdown() {
  const el = document.getElementById('countdown');
  if (!el) return;
  const tick = () => {
    const remain = DAY_MS - (Date.now() - state.me.lastPostAt);
    if (remain <= 0) { render(); return; }
    const h = Math.floor(remain / 3600000);
    const m = Math.floor((remain % 3600000) / 60000);
    el.textContent = `desbloqueia em ${h}h ${m}min`;
  };
  tick();
  clearInterval(window.__cd);
  window.__cd = setInterval(tick, 30000);
}

/* ---------------- FEED (DESBLOQUEADO) ---------------- */
function feedHTML() {
  const posErr = state.positionError
    ? `<div class="subrow" style="color:var(--pulse); margin-bottom:6px;">${state.positionError}</div>` : '';
  if (!state.feed.length) {
    return `
      ${posErr}
      <div class="feed-title"><h2 class="display">Por perto</h2><span class="mono">0 nows</span></div>
      <div class="empty">
        <div class="display">Ninguém por aqui ainda</div>
        <p>Seja o primeiro Now da região.</p>
      </div>
    `;
  }
  return `
    ${posErr}
    <div class="feed-title"><h2 class="display">Por perto</h2><span class="mono">${state.feed.length} now(s)</span></div>
    ${state.feed.map(cardHTML).join('')}
  `;
}

function cardHTML(post) {
  const mainKey = state.cardMainOverride[post.id] || 'env';
  const mainPhoto = mainKey === 'env' ? post.env : post.selfie;
  const insetPhoto = mainKey === 'env' ? post.selfie : post.env;
  const dist = (post._dist !== undefined) ? `<span class="card-dist">${fmtDist(post._dist)}</span>` : '';
  return `
    <div class="card">
      <div class="card-meta">
        <span class="card-user">${escapeHtml(post.nickname)}</span>
        <span class="card-time mono">${timeAgo(post.timestamp)}</span>
      </div>
      <div class="card-stack" data-post-id="${post.id}">
        <div class="photo-main" style="background-image:url('${mainPhoto}')"></div>
        <div class="photo-inset" style="background-image:url('${insetPhoto}')" draggable="true"></div>
        <div class="swap-hint">arraste p/ trocar</div>
      </div>
      ${post.caption ? `<div class="card-caption">${escapeHtml(post.caption)}</div>` : ''}
      <div class="card-place">📍 ${escapeHtml(post.place)} ${dist}</div>
    </div>
  `;
}
function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

/* ---------------- DRAG & DROP NOS CARDS ---------------- */
// Implementado via Pointer Events para funcionar em mouse E touch
// (a API nativa de HTML5 Drag&Drop não é confiável em telas touch/mobile).
function wireCardDrag() {
  document.querySelectorAll('.card-stack').forEach(stack => {
    const inset = stack.querySelector('.photo-inset');
    const main = stack.querySelector('.photo-main');
    const postId = stack.dataset.postId;
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    inset.addEventListener('pointerdown', e => {
      dragging = true;
      inset.setPointerCapture(e.pointerId);
      inset.classList.add('dragging');
      const r = inset.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      origLeft = r.left; origTop = r.top;
      inset.style.position = 'fixed';
      inset.style.left = origLeft + 'px';
      inset.style.top = origTop + 'px';
      inset.style.width = r.width + 'px';
      inset.style.margin = '0';
    });

    inset.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      inset.style.left = (origLeft + dx) + 'px';
      inset.style.top = (origTop + dy) + 'px';
      const mainRect = main.getBoundingClientRect();
      const over = e.clientX >= mainRect.left && e.clientX <= mainRect.right && e.clientY >= mainRect.top && e.clientY <= mainRect.bottom;
      main.classList.toggle('drop-hover', over);
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      inset.classList.remove('dragging');
      inset.style.position = '';
      inset.style.left = ''; inset.style.top = ''; inset.style.width = ''; inset.style.margin = '';
      const mainRect = main.getBoundingClientRect();
      const over = e.clientX >= mainRect.left && e.clientX <= mainRect.right && e.clientY >= mainRect.top && e.clientY <= mainRect.bottom;
      main.classList.remove('drop-hover');
      if (over) {
        const cur = state.cardMainOverride[postId] || 'env';
        state.cardMainOverride[postId] = cur === 'env' ? 'selfie' : 'env';
        const post = state.feed.find(p => p.id === postId);
        stack.outerHTML = cardHTML(post);
        wireCardDrag(); // re-wire (o DOM do card foi substituído)
      }
    }
    inset.addEventListener('pointerup', endDrag);
    inset.addEventListener('pointercancel', endDrag);
  });
}

/* ============================================================
   FLUXO DE CAPTURA — Câmera Dupla + Aqui e Agora
   ============================================================ */
let overlay, fileEnv, fileSelfie;
let currentStream = null;     // MediaStream ativo (getUserMedia)
let videoDevices = [];        // lista de câmeras disponíveis (enumerateDevices)
let currentDeviceIndex = 0;

function openCapture() {
  state.capture = { step: 1, env: null, selfie: null, place: null, coords: null, caption: '' };
  overlay.classList.remove('hidden');
  renderCapture();
}
function closeCapture() {
  stopCamera();
  overlay.classList.add('hidden');
}
window.openCapture = openCapture;
window.closeCapture = closeCapture;

function stepTrack(active) {
  const labels = [1, 2, 3, 4];
  return `<div class="step-track">${labels.map(n => `<div class="seg ${n <= active ? 'done' : ''}"></div>`).join('')}</div>`;
}

/* ---------- getUserMedia: liga a webcam dentro da própria página ---------- */
function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

async function refreshDeviceList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === 'videoinput');
  } catch (e) {
    videoDevices = [];
  }
}

// Tenta abrir a câmera preferida (facingMode) e cai para qualquer câmera
// disponível se o dispositivo (ex: um notebook) não tiver câmera traseira/frontal distintas.
async function requestCameraStream(facingMode) {
  const attempts = [];
  if (videoDevices[currentDeviceIndex]) {
    attempts.push({ video: { deviceId: { exact: videoDevices[currentDeviceIndex].deviceId } }, audio: false });
  }
  attempts.push({ video: { facingMode: { ideal: facingMode } }, audio: false });
  attempts.push({ video: true, audio: false });

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Não foi possível acessar a câmera.');
}

// Liga a câmera para o step atual e monta o preview + botão de disparo dentro de #camFrame.
async function initCameraStep(step) {
  const facingMode = step === 1 ? 'environment' : 'user';
  const frame = document.getElementById('camFrame');
  const controls = document.getElementById('camControls');
  if (!frame) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    renderCameraError(frame, controls, step, 'Este navegador não permite ligar a câmera pela página.');
    return;
  }

  frame.innerHTML = `<div class="cam-loading mono">solicitando câmera...</div>`;
  stopCamera();

  try {
    if (!videoDevices.length) await refreshDeviceList();
    const stream = await requestCameraStream(facingMode);
    currentStream = stream;
    await refreshDeviceList(); // labels só ficam disponíveis após a permissão ser concedida

    frame.innerHTML = `
      <video id="camVideo" autoplay playsinline muted class="${step === 2 ? 'mirror' : ''}"></video>
      ${videoDevices.length > 1 ? `<button class="switch-cam" id="switchCamBtn" title="Trocar câmera">🔄</button>` : ''}
    `;
    const video = document.getElementById('camVideo');
    video.srcObject = stream;
    await video.play().catch(() => {});

    controls.innerHTML = `
      <button class="shutter-btn" id="shutterBtn" aria-label="Capturar foto"></button>
      <button class="link-btn" id="fallbackBtn">usar arquivo em vez da câmera</button>
    `;
    document.getElementById('shutterBtn').addEventListener('click', () => onShutter(step));
    document.getElementById('fallbackBtn').addEventListener('click', () => useFileFallback(step));
    const switchBtn = document.getElementById('switchCamBtn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
        initCameraStep(step);
      });
    }
  } catch (e) {
    renderCameraError(frame, controls, step, 'Não conseguimos acessar a câmera. Verifique a permissão do navegador.');
  }
}

function renderCameraError(frame, controls, step, message) {
  frame.innerHTML = `<div class="cam-error mono">${message}</div>`;
  controls.innerHTML = `<button class="btn-primary" id="fallbackBtn" style="max-width:280px;">Usar arquivo em vez da câmera</button>`;
  document.getElementById('fallbackBtn').addEventListener('click', () => useFileFallback(step));
}

function useFileFallback(step) {
  stopCamera();
  if (step === 1) fileEnv.click(); else fileSelfie.click();
}

// Tira o frame atual do <video> e devolve um dataURL já reduzido.
// mirror=true espelha horizontalmente (usado na selfie, pra bater com o preview espelhado).
function captureFrame(mirror) {
  const video = document.getElementById('camVideo');
  const maxWidth = 480;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale) || maxWidth;
  const h = Math.round(video.videoHeight * scale) || Math.round(maxWidth * 4 / 3);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.62);
}

function onShutter(step) {
  const dataUrl = captureFrame(step === 2);
  stopCamera();
  if (step === 1) {
    state.capture.env = dataUrl;
    state.capture.step = 2;
  } else {
    state.capture.selfie = dataUrl;
    state.capture.step = 3;
  }
  renderCapture();
  if (step === 2) captureLocation();
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    const btn = document.getElementById('shutterBtn');

    if (btn) {
      e.preventDefault();
      btn.click();
    }
  }
});

function renderCapture() {
  const c = state.capture;
  let body = '';

  if (c.step === 1 || c.step === 2) {
    const title = c.step === 1 ? '1. Fotografe o ambiente' : '2. Agora, sua selfie';
    const desc = c.step === 1
      ? 'Enquadre onde você está e capture — sem filtro, sem repetir.'
      : 'Vira a câmera pra você. É a sua prova de presença.';
    body = `
      <div class="capture-body">
        <div class="cam-frame" id="camFrame"></div>
        <h2 class="display">${title}</h2>
        <p>${desc}</p>
        <div class="cam-controls" id="camControls"></div>
      </div>
    `;
  } else if (c.step === 3) {
    body = `
      <div class="capture-body">
        <div class="cam-circle">📡</div>
        <h2 class="display">3. Aqui e agora</h2>
        <p>Capturando sua localização e buscando o nome do lugar...</p>
        <div class="status-line mono" id="geoStatus">localizando...</div>
      </div>
    `;
  } else if (c.step === 4) {
    body = `
      <div class="capture-body">
        <div class="confirm-stack">
          <div class="photo-main" style="background-image:url('${c.env}');position:absolute;inset:0;border-radius:14px;background-size:cover;background-position:center;border:1px solid var(--line);"></div>
          <div class="photo-inset" style="background-image:url('${c.selfie}');position:absolute;width:34%;aspect-ratio:3/4;top:12px;left:12px;border-radius:10px;background-size:cover;background-position:center;border:2px solid var(--ink);"></div>
        </div>
        <div class="card-place mono" style="justify-content:center;margin-bottom:16px;">📍 ${escapeHtml(c.place)}</div>
        <textarea class="caption-input" id="captionInput" rows="2" maxlength="80" placeholder="O que você está fazendo agora?"></textarea>
        <button class="btn-primary" id="publishBtn" style="max-width:280px;">Publicar Now</button>
      </div>
    `;
  }

  overlay.innerHTML = `
    <div class="overlay-top">
      <span class="mono" style="font-size:11px;color:var(--muted);">NOVO NOW</span>
      <button class="close-btn" onclick="closeCapture()">✕</button>
    </div>
    ${stepTrack(c.step)}
    ${body}
  `;

  if (c.step === 4) {
    const btn = document.getElementById('publishBtn');
    const cap = document.getElementById('captionInput');
    btn.addEventListener('click', () => publishNow(cap.value.trim()));
  }

  if (c.step === 1 || c.step === 2) {
    initCameraStep(c.step);
  }
}

async function captureLocation() {
  const statusEl = document.getElementById('geoStatus');
  try {
    const coords = await getPosition();
    if (statusEl) statusEl.textContent = 'localização obtida, buscando endereço...';
    const place = await reverseGeocode(coords.lat, coords.lon);
    state.capture.coords = coords;
    state.capture.place = place;
    state.capture.step = 4;
    renderCapture();
  } catch (e) {
    if (statusEl) statusEl.textContent = 'não foi possível obter sua localização.';
    setTimeout(() => {
      state.capture.coords = null;
      state.capture.place = 'Localização não disponível';
      state.capture.step = 4;
      renderCapture();
    }, 1200);
  }
}

async function publishNow(caption) {
  const c = state.capture;
  const post = {
    id: crypto.randomUUID(),
    userId: state.me.userId,
    nickname: state.me.nickname,
    env: c.env,
    selfie: c.selfie,
    place: c.place || 'Local não identificado',
    lat: c.coords ? c.coords.lat : null,
    lon: c.coords ? c.coords.lon : null,
    caption: caption || '',
    timestamp: Date.now()
  };
  storeSet(`nowplace:post:${post.id}`, post);
  state.me.lastPostAt = Date.now();
  storeSet('nowplace:me', state.me);
  closeCapture();
  await refreshLockState();
}

/* ---------------- BOOT ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  overlay = document.getElementById('captureOverlay');
  fileEnv = document.getElementById('fileEnv');
  fileSelfie = document.getElementById('fileSelfie');

  document.getElementById('fabBtn').addEventListener('click', openCapture);

  // Fallback: só usado quando getUserMedia falha (permissão negada, sem câmera, etc).
  fileEnv.addEventListener('change', async () => {
    const f = fileEnv.files[0];
    fileEnv.value = '';
    if (!f) return;
    try {
      state.capture.env = await fileToCompressedDataURL(f);
      state.capture.step = 2;
      renderCapture();
    } catch (e) { alert('Não foi possível usar essa foto. Tente novamente.'); }
  });

  fileSelfie.addEventListener('change', async () => {
    const f = fileSelfie.files[0];
    fileSelfie.value = '';
    if (!f) return;
    try {
      state.capture.selfie = await fileToCompressedDataURL(f);
      state.capture.step = 3;
      renderCapture();
      await captureLocation();
    } catch (e) { alert('Não foi possível usar essa foto. Tente novamente.'); }
  });

  initApp();
});
