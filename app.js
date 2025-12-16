// app.js (stable)
// - Upload tab: Leaflet map + markers from cities.json
// - Upload modal: always works (even if Leaflet fails)
// - Preview tab: time series chart; if "Risk scores" selected => heatmap

let mapUpload = null;
let uploadCitiesLayer = null;
let selectedIndicatorId = null;

function safeInvalidate(map) {
  try { if (map && typeof map.invalidateSize === "function") map.invalidateSize(); } catch(_) {}
}

// -----------------------
// Tabs
// -----------------------
function setupTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-target");
      const target = document.getElementById(targetId);
      if (target) target.classList.add("active");

      setTimeout(() => safeInvalidate(mapUpload), 80);

      if (targetId === "tab-upload") {
        setTimeout(loadAndRenderUploadCities, 120);
      }
    });
  });
}

// -----------------------
// Modal (Upload locations)
// -----------------------
function setupUploadModal() {
  const btnOpen = document.getElementById("btnUploadLocations");
  const modal = document.getElementById("uploadModal");
  const btnClose = document.getElementById("btnCloseUploadModal");
  const btnCancel = document.getElementById("btnCancelUploadModal");
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const btnPickFile = document.getElementById("btnPickFile");
  const fileName = document.getElementById("fileName");

  if (!btnOpen || !modal || !btnClose || !btnCancel || !dropZone || !fileInput || !btnPickFile || !fileName) {
    console.warn("Upload modal markup not found (check IDs in index.html).");
    return;
  }

  function openModal() {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    fileInput.value = "";
    fileName.textContent = "";
    dropZone.classList.remove("is-dragover");
    dropZone.focus();
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    dropZone.classList.remove("is-dragover");
  }

  btnOpen.addEventListener("click", openModal);
  btnClose.addEventListener("click", closeModal);
  btnCancel.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });

  btnPickFile.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", () => fileInput.click());

  ["dragover", "drop"].forEach((evt) => document.addEventListener(evt, (e) => e.preventDefault()));

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) fileName.textContent = `Selected: ${file.name}`;
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("is-dragover");
    })
  );

  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("is-dragover");
    })
  );

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) fileName.textContent = `Selected: ${file.name}`;
  });
}

// -----------------------
// Leaflet map + cities
// -----------------------
function initUploadMapIfLeafletAvailable() {
  if (typeof window.L === "undefined") {
    console.warn("Leaflet not available - map disabled.");
    return;
  }
  const el = document.getElementById("map-upload");
  if (!el) return;

  const lightGray = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  });

  mapUpload = L.map(el, { center: [20, 0], zoom: 2, layers: [lightGray] });
  uploadCitiesLayer = L.layerGroup().addTo(mapUpload);
}

async function loadAndRenderUploadCities() {
  if (!mapUpload || !uploadCitiesLayer) return;

  uploadCitiesLayer.clearLayers();

  try {
    const resp = await fetch("cities.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const cities = await resp.json();

    const bounds = [];
    (cities || []).forEach((c) => {
      const lat = Number(c.lat ?? c.latitude);
      const lon = Number(c.lon ?? c.lng ?? c.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const m = L.marker([lat, lon]).addTo(uploadCitiesLayer);
      if (c.name) m.bindPopup(c.name);
      bounds.push([lat, lon]);
    });

    if (bounds.length) mapUpload.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 });
  } catch (err) {
    console.warn("Could not load cities.json. Use a local server (not file://).", err);
  }
}

// -----------------------
// Preview: time series + heatmap toggle
// -----------------------
function setupPreviewIndicatorButtons() {
  const buttons = document.querySelectorAll('#tab-ch .municipality-button[data-country="ch"]');
  if (!buttons.length) return;

  const canvas = document.getElementById("previewChart");
  const heatmap = document.getElementById("heatmap");

  // 🔒 SAFETY GUARD — prevents app from crashing
  if (!canvas || !heatmap) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      selectedIndicatorId = btn.getAttribute("data-id") || "indicator";
      const label = btn.textContent.trim() || selectedIndicatorId;

      const isRisk = (selectedIndicatorId === "risk_scores");

      if (isRisk) {
        if (canvas) canvas.style.display = "none";
        if (heatmap) {
          heatmap.style.display = "grid";
          renderHeatmap();
        }
      } else {
        if (heatmap) heatmap.style.display = "none";
        if (canvas) canvas.style.display = "block";
        renderPreviewChart(label);
      }
    });
  });
}

function renderPreviewChart(label) {
  const canvas = document.getElementById("previewChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // crisp on HiDPI
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(600, rect.width || 900);
  const H = Math.max(420, rect.height || 500);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // fake data
  const start = 2000, end = 2050;
  const n = end - start + 1;
  const values = [];
  let base = 50 + Math.random() * 20;
  let trend = (Math.random() - 0.3) * 0.25;
  for (let i = 0; i < n; i++) {
    base += trend;
    const seasonal = 4 * Math.sin(i / 3.5);
    const noise = (Math.random() - 0.5) * 3.0;
    values.push(base + seasonal + noise);
  }

  // layout
  const padL = 52, padR = 16, padT = 44, padB = 38;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#222";
  ctx.font = "600 16px Comfortaa, system-ui, sans-serif";
  ctx.fillText(label, padL, 26);

  const x0 = padL, y0 = H - padB, x1 = W - padR, y1 = padT;
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const vPad = (vMax - vMin) * 0.08 || 1;
  const minV = vMin - vPad, maxV = vMax + vPad;

  const x = (i) => x0 + (i / (n - 1)) * (x1 - x0);
  const y = (v) => y0 - ((v - minV) / (maxV - minV)) * (y0 - y1);

  // grid + y ticks
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = 1;
  ctx.font = "12px Comfortaa, system-ui, sans-serif";
  ctx.fillStyle = "#666";

  const yTicks = 5;
  for (let t = 0; t <= yTicks; t++) {
    const vv = minV + (t / yTicks) * (maxV - minV);
    const yy = y(vv);
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    ctx.stroke();
    ctx.fillText(vv.toFixed(1), 8, yy + 4);
  }

  // x ticks every 10y
  ctx.strokeStyle = "#e9e9e9";
  for (let yr = start; yr <= end; yr += 10) {
    const i = yr - start;
    const xx = x(i);
    ctx.beginPath();
    ctx.moveTo(xx, y0);
    ctx.lineTo(xx, y1);
    ctx.stroke();
    ctx.fillText(String(yr), xx - 14, H - 14);
  }

  // axes
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y1);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.stroke();

  // line
  ctx.strokeStyle = "#0a66c2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const xx = x(i);
    const yy = y(values[i]);
    if (i === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
}

function setupDownloadGraphButton() {
  const btn = document.getElementById("btnDownloadGraph");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const heatmap = document.getElementById("heatmap");
    const canvas = document.getElementById("previewChart");

    if (heatmap && heatmap.style.display !== "none") {
      alert("Download is available for the time series chart. Select a non-risk indicator to download the graph.");
      return;
    }
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = (selectedIndicatorId || "preview") + "_timeseries.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}

// -----------------------
// Heatmap code (provided)
// -----------------------
const riskLabels = ['river flood', 'coastal flood', 'wildfire', 'drought','heat wave','severe storm', 'extreme rainfall','landslide','cold stress','change in precip','change in temp'];
const siteLabels = Array.from({length: 12}, (_, i) => `site ${i+1}`);
function riskColor(v) { switch (v) { case 1:return '#709386'; case 2:return '#C9C17B'; case 3:return '#CE9D61'; case 4:return '#E2432D'; case 5:return '#B50F0B'; default:return '#808080'; } }
function seededRand(seed){let x=seed%2147483647;if(x<=0)x+=2147483646;return()=> (x= x*16807%2147483647)/2147483647;}
function renderHeatmap(){
  const container=document.getElementById('heatmap'); if(!container) return; container.innerHTML='';
  const corner=document.createElement('div'); corner.className='header'; corner.style.textAlign='right'; corner.textContent='12 power facilities'; corner.style.fontWeight='600'; container.appendChild(corner);
  siteLabels.forEach(lbl=>{const h=document.createElement('div'); h.className='header'; h.textContent=lbl; container.appendChild(h);});
  const rand=seededRand(987654);
  riskLabels.forEach(risk=>{
    const rl=document.createElement('div'); rl.className='row-label'; rl.textContent=risk; container.appendChild(rl);
    for(let c=0;c<siteLabels.length;c++){
      let v=Math.floor(rand()*5)+1;
      if(risk.includes('flood')||risk.includes('storm')){ if(rand()>0.6) v=Math.min(5,v+1);}
      const cell=document.createElement('div'); cell.className='heat-cell'; cell.style.background=riskColor(v); container.appendChild(cell);
    }
  });
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupUploadModal();
  initUploadMapIfLeafletAvailable();
  loadAndRenderUploadCities();
  setupPreviewIndicatorButtons();
  setupDownloadGraphButton();
  renderPreviewChart("Select an indicator on the right");
});
