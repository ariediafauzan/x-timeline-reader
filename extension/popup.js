const TTS_SERVER = "http://localhost:8787";

const btnPlay = document.getElementById("btnPlay");
const btnPause = document.getElementById("btnPause");
const btnSkip = document.getElementById("btnSkip");
const btnStop = document.getElementById("btnStop");
const rateSlider = document.getElementById("rateSlider");
const rateDisplay = document.getElementById("rateDisplay");
const filterInput = document.getElementById("filterInput");
const speakerSelect = document.getElementById("speakerSelect");
const toggleQuotes = document.getElementById("toggleQuotes");
const toggleLong = document.getElementById("toggleLong");
const nrAuthor = document.getElementById("nrAuthor");
const nrText = document.getElementById("nrText");
const statusEl = document.getElementById("status");
const engineBadge = document.getElementById("engineBadge");
const serverHint = document.getElementById("serverHint");
const speakerSetting = document.getElementById("speakerSetting");
const modelList = document.getElementById("modelList");
const modelError = document.getElementById("modelError");
const ramAmount = document.getElementById("ramAmount");
const ramFill = document.getElementById("ramFill");
const trendingList = document.getElementById("trendingList");
const cacheList = document.getElementById("cacheList");
const cacheTotalSize = document.getElementById("cacheTotalSize");
const downloadOverlay = document.getElementById("downloadOverlay");
const dlTitle = document.getElementById("dlTitle");
const dlSubtitle = document.getElementById("dlSubtitle");
const dlCancel = document.getElementById("dlCancel");
const dlProgressFill = document.getElementById("dlProgressFill");
const dlPercent = document.getElementById("dlPercent");

const serverDot = document.getElementById("serverDot");
const serverLabel = document.getElementById("serverLabel");
const serverBtn = document.getElementById("serverBtn");
const serverBar = document.getElementById("serverBar");

let tabId = null;
let filterTimeout = null;
let currentEngineId = "edge-tts";
let activeHfModelId = null;
let engines = [];
let downloadAbort = null;
let progressInterval = null;
let serverOnline = false;
let serverPollInterval = null;

// ── Tab switching ───────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "models") loadEngines();
  });
});

// ── Messaging ───────────────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn(chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(resp);
      }
    });
  });
}

async function serverFetch(path, opts = {}) {
  try {
    const resp = await fetch(`${TTS_SERVER}${path}`, opts);
    return await resp.json();
  } catch {
    return null;
  }
}

// ── UI helpers ──────────────────────────────────────────────────────
function updateUI(playing, paused) {
  btnPlay.disabled = playing && !paused;
  btnPlay.textContent = paused ? "Resume" : "Play";
  btnPause.disabled = !playing || paused;
  btnSkip.disabled = !playing;
  btnStop.disabled = !playing && !paused;
  statusEl.textContent = playing
    ? paused ? "Paused" : "Reading..."
    : "Ready";
}

function setEngine(name) {
  if (name && name !== "browser") {
    engineBadge.textContent = name;
    engineBadge.className = "engine-badge qwen";
    serverHint.style.display = "none";
    speakerSetting.style.display = "block";
  } else {
    engineBadge.textContent = "Browser";
    engineBadge.className = "engine-badge browser";
    serverHint.style.display = "block";
    speakerSetting.style.display = "none";
  }
}

function populateVoices(voices) {
  speakerSelect.innerHTML = "";
  for (const v of voices) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    speakerSelect.appendChild(opt);
  }
}

// ── Download overlay ────────────────────────────────────────────────
function showDownload(modelName, sizeHint) {
  dlTitle.textContent = `Downloading ${modelName}...`;
  dlSubtitle.textContent = sizeHint
    ? `~${sizeHint} GB. This may take a few minutes on first load.`
    : "This may take a few minutes for first download.";
  dlPercent.textContent = "0%";
  dlProgressFill.style.width = "0%";
  downloadOverlay.style.display = "flex";
}

function hideDownload() {
  downloadOverlay.style.display = "none";
  stopProgressPoll();
}

function startProgressPoll(onReady) {
  stopProgressPoll();
  progressInterval = setInterval(async () => {
    const data = await serverFetch("/download-progress");
    if (!data) return;

    const pct = data.progress || 0;
    dlPercent.textContent = pct + "%";
    dlProgressFill.style.width = pct + "%";

    if (data.status === "downloading") {
      dlTitle.textContent = `Downloading... ${pct}%`;
    }

    if (data.status === "loading") {
      dlTitle.textContent = "Loading into memory...";
      dlSubtitle.textContent = "Download complete. Initializing model...";
      dlPercent.textContent = "100%";
      dlProgressFill.style.width = "100%";
    }

    if (data.status === "ready") {
      stopProgressPoll();
      hideDownload();
      if (onReady) onReady(data);
    }

    if (data.status === "error") {
      stopProgressPoll();
      hideDownload();
      modelError.textContent = data.error || "Download failed.";
      modelError.style.display = "block";
      document.querySelectorAll(".loading-model").forEach((c) => c.classList.remove("loading-model"));
    }
  }, 800);
}

function stopProgressPoll() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

dlCancel.addEventListener("click", () => {
  hideDownload();
  document.querySelectorAll(".loading-model").forEach((c) => c.classList.remove("loading-model"));
});

// ── Model cards ─────────────────────────────────────────────────────
function renderModels(data) {
  const ram = data.system_ram_gb;
  ramAmount.textContent = ram;
  ramFill.style.width = "100%";

  modelList.innerHTML = "";

  for (const eng of data.engines) {
    const card = document.createElement("div");
    card.className = "model-card" + (eng.id === currentEngineId ? " active" : "");
    card.dataset.engineId = eng.id;

    const ramPct = eng.ram_gb > 0 ? Math.round((eng.ram_gb / ram) * 100) : 0;
    const fits = eng.recommended;

    card.innerHTML = `
      <div class="model-top">
        <span class="model-name">${eng.name}</span>
        <div class="model-badges">
          ${eng.type === "cloud" ? '<span class="badge cloud">CLOUD</span>' : '<span class="badge local">LOCAL</span>'}
          ${fits ? '<span class="badge rec">FITS</span>' : ''}
          ${!fits && eng.ram_gb > 0 ? '<span class="badge warn">HEAVY</span>' : ''}
          ${eng.id === currentEngineId ? '<span class="badge rec">ACTIVE</span>' : ''}
        </div>
      </div>
      <div class="model-meta">
        <span>RAM: ${eng.ram_gb > 0 ? eng.ram_gb + " GB (" + ramPct + "%)" : "None (cloud)"}</span>
        <span>Quality: ${eng.quality}</span>
        <span>Speed: ${eng.speed}</span>
      </div>
      <div class="model-note">${eng.note}</div>
    `;

    card.addEventListener("click", () => switchEngine(eng.id, card));
    modelList.appendChild(card);
  }
}

async function switchEngine(engineId, card) {
  if (engineId === currentEngineId) return;

  modelError.style.display = "none";

  // Find engine name for overlay
  const eng = engines.find((e) => e.id === engineId);
  const engineName = eng ? eng.name : engineId;
  showDownload(engineName);

  // Mark loading
  document.querySelectorAll(".model-card").forEach((c) => c.classList.remove("active"));
  card.classList.add("active", "loading-model");

  const resp = await serverFetch("/engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: engineId }),
  });

  card.classList.remove("loading-model");
  hideDownload();

  if (!resp) {
    modelError.textContent = "Could not connect to TTS server.";
    modelError.style.display = "block";
    card.classList.remove("active");
    return;
  }

  if (resp.error) {
    modelError.textContent = resp.error;
    if (resp.install_cmd) {
      modelError.textContent += ` Run: ${resp.install_cmd}`;
    }
    modelError.style.display = "block";
    card.classList.remove("active");
    return;
  }

  currentEngineId = engineId;
  setEngine(resp.engine_name);
  populateVoices(resp.speakers);
  if (resp.speakers.length > 0) {
    sendMsg({ action: "setSpeaker", speaker: resp.speakers[0] });
  }

  // Refresh cards to update ACTIVE badge
  loadEngines();
}

async function loadEngines() {
  const data = await serverFetch("/engines");
  if (data) {
    engines = data.engines;
    renderModels(data);
  } else {
    modelList.innerHTML = '<div class="hint" style="text-align:center;padding:20px 0;">Server not running. Start the TTS server first.</div>';
  }
  loadTrending();
  loadCachedModels();
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

async function loadTrending() {
  trendingList.innerHTML = '<div class="hint" style="text-align:center;padding:12px 0;">Loading trending...</div>';

  const data = await serverFetch("/trending");
  if (!data || !data.models || data.models.length === 0) {
    trendingList.innerHTML = '<div class="hint" style="text-align:center;padding:12px 0;">Could not load trending models.</div>';
    return;
  }

  trendingList.innerHTML = "";

  for (const m of data.models) {
    const card = document.createElement("div");
    card.className = "trending-card supported";

    const shortName = m.model_id.split("/").pop();
    const isActive = (m.supported && m.engine_id === currentEngineId) ||
      (!m.supported && currentEngineId === "_hf_pipeline" && m.model_id === activeHfModelId);

    card.innerHTML = `
      <div class="trending-top">
        <span class="trending-name" title="${m.model_id}">${shortName}</span>
        <div class="trending-stats">
          <span>${formatNum(m.likes)} likes</span>
          <span>${formatNum(m.downloads)} dl</span>
        </div>
      </div>
      <div class="trending-bottom">
        ${m.supported ? '<span class="badge rec">BUILT-IN</span>' : m.compatible === false ? '<span class="badge warn">INCOMPATIBLE</span>' : '<span class="badge cloud">AUTO</span>'}
        ${m.fits_ram ? '<span class="badge rec">FITS</span>' : '<span class="badge warn">HEAVY</span>'}
        <span class="badge local">~${m.ram_estimate_gb} GB</span>
        ${isActive ? '<span class="badge rec">ACTIVE</span>' : ''}
        <a class="hf-link" href="https://huggingface.co/${m.model_id}" target="_blank">View on HF</a>
      </div>
    `;

    card.addEventListener("click", async (e) => {
      if (e.target.classList.contains("hf-link")) return;

      if (m.compatible === false && !m.supported) {
        modelError.textContent = "This model uses a custom architecture. Check its HuggingFace page for install instructions.";
        modelError.style.display = "block";
        return;
      }

      modelError.style.display = "none";

      if (m.supported) {
        // Use built-in engine
        card.classList.add("loading-model");
        const builtIn = document.querySelector(`.model-card[data-engine-id="${m.engine_id}"]`);
        if (builtIn) await switchEngine(m.engine_id, builtIn);
        card.classList.remove("loading-model");
        return;
      }

      // Load via HF pipeline — show overlay with progress
      const shortName = m.model_id.split("/").pop();
      showDownload(shortName, m.ram_estimate_gb);
      card.classList.add("loading-model");

      const resp = await serverFetch("/load-hf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: m.model_id }),
      });

      if (!resp) {
        card.classList.remove("loading-model");
        hideDownload();
        modelError.textContent = "Could not connect to TTS server.";
        modelError.style.display = "block";
        return;
      }

      if (resp.error) {
        card.classList.remove("loading-model");
        hideDownload();
        modelError.textContent = resp.error;
        modelError.style.display = "block";
        return;
      }

      if (resp.status === "downloading") {
        // Poll for progress until ready
        startProgressPoll(() => {
          card.classList.remove("loading-model");
          currentEngineId = "_hf_pipeline";
          activeHfModelId = m.model_id;
          setEngine(shortName);
          populateVoices([]);
          loadTrending();
        });
        return;
      }

      // Direct response (built-in engine switch)
      card.classList.remove("loading-model");
      hideDownload();
      currentEngineId = resp.engine;
      activeHfModelId = m.model_id;
      setEngine(resp.engine_name);
      populateVoices(resp.speakers || []);
      loadTrending();
    });

    trendingList.appendChild(card);
  }
}

// ── Cached models ───────────────────────────────────────────────────
async function loadCachedModels() {
  const data = await serverFetch("/cached-models");
  if (!data || !data.models || data.models.length === 0) {
    cacheList.innerHTML = '<div class="hint" style="text-align:center;padding:12px 0;">No downloaded models.</div>';
    cacheTotalSize.textContent = "";
    return;
  }

  cacheTotalSize.textContent = `Total: ${data.total_size_display}`;
  cacheList.innerHTML = "";

  for (const m of data.models) {
    const card = document.createElement("div");
    card.className = "cache-card";

    const shortName = m.model_id.split("/").pop();

    card.innerHTML = `
      <div class="cache-info">
        <div class="cache-name" title="${m.model_id}">${shortName}</div>
        <div class="cache-size">${m.size_display}${m.is_active ? ' &middot; In use' : ''}</div>
      </div>
    `;

    const btn = document.createElement("button");
    btn.className = "cache-delete";
    btn.textContent = "Delete";
    if (m.is_active) btn.disabled = true;

    btn.addEventListener("click", async () => {
      btn.textContent = "Deleting...";
      btn.disabled = true;
      const resp = await serverFetch(`/cached-models/${encodeURIComponent(m.model_id)}`, {
        method: "DELETE",
      });
      if (resp && resp.status === "ok") {
        card.remove();
        loadCachedModels(); // refresh totals
      } else {
        btn.textContent = "Error";
        setTimeout(() => { btn.textContent = "Delete"; btn.disabled = false; }, 2000);
      }
    });

    card.appendChild(btn);
    cacheList.appendChild(card);
  }
}

// ── Server control ──────────────────────────────────────────────────
function setServerUI(online) {
  serverOnline = online;
  if (online) {
    serverDot.className = "server-dot online";
    serverLabel.textContent = "Server running";
    serverBtn.textContent = "Stop";
    serverBtn.className = "server-btn stop";
    serverBtn.disabled = false;
    serverHint.style.display = "none";
  } else {
    serverDot.className = "server-dot offline";
    serverLabel.textContent = "Server offline";
    serverBtn.textContent = "Start";
    serverBtn.className = "server-btn start";
    serverBtn.disabled = false;
  }
}

async function checkServerStatus() {
  const h = await serverFetch("/health");
  if (h && h.status === "ready") {
    if (!serverOnline) {
      setServerUI(true);
      currentEngineId = h.engine || "edge-tts";
      setEngine(h.engine_name || "Edge TTS");
      populateVoices(h.speakers || []);
    }
  } else {
    if (serverOnline) {
      setServerUI(false);
      setEngine("browser");
    }
  }
}

function startServerPoll() {
  if (serverPollInterval) return;
  serverPollInterval = setInterval(checkServerStatus, 5000);
}

function stopServerPoll() {
  if (serverPollInterval) {
    clearInterval(serverPollInterval);
    serverPollInterval = null;
  }
}

async function startServer() {
  serverBtn.disabled = true;
  serverBtn.textContent = "Starting...";
  serverLabel.textContent = "Starting server...";
  serverDot.className = "server-dot";

  // Try native messaging first
  let nativeOk = false;
  try {
    await new Promise((resolve) => {
      chrome.runtime.sendNativeMessage("com.xreader.tts", { action: "start" }, (resp) => {
        nativeOk = !chrome.runtime.lastError;
        resolve();
      });
    });
  } catch {}

  if (!nativeOk) {
    // Native host not installed — show one-time setup hint
    serverHint.innerHTML = `<strong>One-time setup:</strong> Run this in Terminal to enable the Start button:<br><code style="user-select:all;cursor:pointer;display:block;background:#1e2e3d;padding:6px 8px;border-radius:4px;margin:6px 0;font-size:11px;">./server/setup_native_host.sh</code>Or start the server manually:<br><code style="user-select:all;cursor:pointer;display:block;background:#1e2e3d;padding:6px 8px;border-radius:4px;margin:6px 0;font-size:11px;">./server/start_server.sh</code>`;
    serverHint.style.display = "block";
    setServerUI(false);
    return;
  }

  // Poll until server is up (max ~8s)
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await serverFetch("/health");
    if (h && h.status === "ready") {
      setServerUI(true);
      currentEngineId = h.engine || "edge-tts";
      setEngine(h.engine_name || "Edge TTS");
      populateVoices(h.speakers || []);
      return;
    }
  }

  // Timed out
  serverHint.innerHTML = `Server didn't respond. Try manually:<br><code style="user-select:all;cursor:pointer;background:#1e2e3d;padding:2px 6px;border-radius:4px;">./server/start_server.sh</code>`;
  serverHint.style.display = "block";
  setServerUI(false);
}

async function stopServer() {
  serverBtn.disabled = true;
  serverBtn.textContent = "Stopping...";
  await serverFetch("/shutdown", { method: "POST" });
  // Give it a moment to die
  await new Promise((r) => setTimeout(r, 1000));
  setServerUI(false);
  setEngine("browser");
}

serverBtn.addEventListener("click", () => {
  if (serverOnline) {
    stopServer();
  } else {
    startServer();
  }
});

// ── Init ────────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || (!tab.url.includes("x.com") && !tab.url.includes("twitter.com"))) {
    document.getElementById("main").style.display = "none";
    document.getElementById("notOnX").style.display = "block";
    return;
  }

  tabId = tab.id;
  document.getElementById("main").style.display = "block";
  document.getElementById("notOnX").style.display = "none";

  // Check server & get current engine info
  const health = await serverFetch("/health");
  if (health && health.status === "ready") {
    setServerUI(true);
    currentEngineId = health.engine || "edge-tts";
    activeHfModelId = health.model_id || null;
    setEngine(health.engine_name || "Edge TTS");
    populateVoices(health.speakers || []);
  } else {
    setServerUI(false);
    setEngine("browser");
  }
  startServerPoll();

  // Restore content script state
  const stateResp = await sendMsg({ action: "getState" });
  if (stateResp) {
    updateUI(stateResp.playing, stateResp.paused);
    rateSlider.value = stateResp.rate;
    rateDisplay.textContent = stateResp.rate.toFixed(1) + "x";
    filterInput.value = stateResp.filter || "";
    if (stateResp.speaker) speakerSelect.value = stateResp.speaker;
    if (stateResp.readQuotes !== undefined) toggleQuotes.checked = stateResp.readQuotes;
    if (stateResp.readLongTweets !== undefined) toggleLong.checked = stateResp.readLongTweets;
    if (stateResp.playing) {
      statusEl.textContent = stateResp.paused ? "Paused" : "Reading...";
    }
  }
}

// ── Event listeners ─────────────────────────────────────────────────
btnPlay.addEventListener("click", async () => {
  await sendMsg({ action: "setFilter", filter: filterInput.value.trim() });
  await sendMsg({ action: "setSpeaker", speaker: speakerSelect.value });
  await sendMsg({ action: "start" });
  updateUI(true, false);
});

btnPause.addEventListener("click", async () => {
  await sendMsg({ action: "pause" });
  updateUI(true, true);
});

btnSkip.addEventListener("click", () => sendMsg({ action: "skip" }));

btnStop.addEventListener("click", async () => {
  await sendMsg({ action: "stop" });
  updateUI(false, false);
  nrAuthor.textContent = "--";
  nrText.textContent = "Press Play to start listening";
});

rateSlider.addEventListener("input", () => {
  const rate = parseFloat(rateSlider.value);
  rateDisplay.textContent = rate.toFixed(1) + "x";
  sendMsg({ action: "setRate", rate });
});

speakerSelect.addEventListener("change", () => {
  sendMsg({ action: "setSpeaker", speaker: speakerSelect.value });
});

toggleQuotes.addEventListener("change", () => {
  sendMsg({ action: "setOptions", readQuotes: toggleQuotes.checked });
});

toggleLong.addEventListener("change", () => {
  sendMsg({ action: "setOptions", readLongTweets: toggleLong.checked });
});

filterInput.addEventListener("input", () => {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    sendMsg({ action: "setFilter", filter: filterInput.value.trim() });
  }, 500);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "now-reading") {
    nrAuthor.textContent = msg.author || "--";
    nrText.textContent = msg.text || "...";
  }
  if (msg.type === "state") {
    updateUI(msg.playing, msg.paused);
  }
});

init();
