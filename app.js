// app.js (stable)
// - Upload tab: Leaflet map + markers from cities.json
// - Upload modal: always works (even if Leaflet fails)
// - Preview tab: time series chart; if "Risk scores" selected => heatmap

let mapUpload = null;
let uploadCitiesLayer = null;
let selectedIndicatorId = null;

let mapPreview = null;
let floodLayer = null;
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

      if (targetId === "tab-ch") {
        // if flood map is currently selected, re-render after tab becomes visible
        setTimeout(() => {
          if (selectedIndicatorId === "flood_depth") {
            showFloodDepthPreview();
          }
        }, 140);
      }

      if (targetId === "tab-3") {
        setTimeout(renderGantt, 50);
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
  if (mapUpload) return;

  if (typeof window.L === "undefined") {
    console.warn("Leaflet not available - map disabled.");
    return;
  }
  const el = document.getElementById("map-upload");
  if (!el) return;

  // Base layers
  const lightGray = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20 }
  );

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri", maxZoom: 19 }
  );

  // Create map
  mapUpload = L.map(el, {
    center: [20, 0],
    zoom: 2,
    layers: [lightGray]
  });

  // Optional: labels overlay (safe here because mapUpload exists now)
  const labels = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 20
  });
  labels.addTo(mapUpload); // keep labels always visible


  // Layer switcher
  const baseLayers = { "Light": lightGray, "Satellite": satellite };
  const overlays = { "Labels": labels };
  L.control.layers(baseLayers, overlays, { position: "topright" }).addTo(mapUpload);

  // Markers layer
  uploadCitiesLayer = L.layerGroup().addTo(mapUpload);
}
// Load cities.json (or embedded cities) and render markers on the Upload map
async function loadAndRenderUploadCities() {
  // Ensure map exists
  initUploadMapIfLeafletAvailable();
  if (!mapUpload || !uploadCitiesLayer) return;

  // Clear previous markers
  try { uploadCitiesLayer.clearLayers(); } catch (_) {}

  let cities = [];

  try {
    // ✅ 1) Offline single-file mode: use embedded cities if available
    const embedded = window.__EMBEDDED_CITIES__;
    if (Array.isArray(embedded) && embedded.length) {
      cities = embedded;
    } else {
      // ✅ 2) Normal multi-file mode: fetch cities.json
      const resp = await fetch("assets/cities.json", { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      cities = Array.isArray(json) ? json : (json?.cities || []);
    }
  } catch (e) {
    console.warn("Could not load cities (embedded or cities.json).", e);
    // Minimal fallback so you still see something
    cities = [
      { name: "London", lat: 51.5074, lon: -0.1278 },
      { name: "Paris", lat: 48.8566, lon: 2.3522 },
    ];
  }

  // expose last loaded cities for other widgets (e.g., flood preview)
  try { window.__LAST_CITIES__ = cities; } catch(_) {}

  const bounds = [];
  cities.forEach((c) => {
    const lat = Number(c.lat ?? c.latitude);
    const lon = Number(c.lon ?? c.lng ?? c.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const title = c.name || c.id || "Location";
    const m = L.circleMarker([lat, lon], {
      radius: 6,
      weight: 2,
      color: "#0a66c2",
      fillColor: "#0a66c2",
      fillOpacity: 0.6,
    }).bindPopup(title);

    uploadCitiesLayer.addLayer(m);
    bounds.push([lat, lon]);
  });

  if (bounds.length) {
    mapUpload.fitBounds(bounds, { padding: [24, 24], maxZoom: 10 });
  }
}



// -----------------------
// Preview: time series + heatmap toggle
// -----------------------
/* -----------------------
   Preview: Flood depth map (mock)
   - 300m around selected location
   - 100m grid, random depths 0–2m
----------------------- */
function getSelectedLocationLatLng() {
  // Try to read from a location dropdown if available (expects JSON in value)
  const sel = document.getElementById("locationSelect");
  if (sel && sel.value) {
    try {
      const obj = JSON.parse(sel.value);
      const lat = Number(obj.lat ?? obj.latitude);
      const lon = Number(obj.lon ?? obj.lng ?? obj.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    } catch (_) {}
  }

  // Fallback: first embedded city
  const embedded = window.__EMBEDDED_CITIES__;
  if (Array.isArray(embedded) && embedded.length) {
    const c = embedded[0];
    const lat = Number(c.lat ?? c.latitude);
    const lon = Number(c.lon ?? c.lng ?? c.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  }

  // Fallback: last loaded cities from upload map (multi-file mode)
  const last = window.__LAST_CITIES__;
  if (Array.isArray(last) && last.length) {
    const c = last[0];
    const lat = Number(c.lat ?? c.latitude);
    const lon = Number(c.lon ?? c.lng ?? c.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  }

  // Final fallback
  return [48.8566, 2.3522];
}

function ensurePreviewFloodMap() {
  if (typeof window.L === "undefined") {
    console.warn("Leaflet not available - flood preview map disabled.");
    return;
  }
  const el = document.getElementById("previewFloodMap");
  if (!el) return;

  if (!mapPreview) {
    const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 20
    });
    mapPreview = L.map(el, { center: [48.8566, 2.3522], zoom: 14, layers: [light] });
    floodLayer = L.layerGroup().addTo(mapPreview);
  }

  // If the map container was hidden, Leaflet needs a resize
  setTimeout(() => safeInvalidate(mapPreview), 60);
}

function floodColorFromMeters(m) {
  const t = Math.max(0, Math.min(1, m / 2));
  const a = 0.10 + 0.55 * t;
  return `rgba(10, 102, 194, ${a})`;
}

function renderRandomFloodDepthGrid(centerLatLng) {
  if (!mapPreview || !floodLayer) return;

  floodLayer.clearLayers();

  const [lat, lon] = centerLatLng;

  // 300 m circle
  const circle = L.circle([lat, lon], { radius: 300, weight: 1, opacity: 0.4, fillOpacity: 0.05 });
  floodLayer.addLayer(circle);

  // 100m cells across 600m x 600m -> 7x7
  const cellSizeM = 100;
  const halfSpanM = 800;
  const n = Math.floor((halfSpanM * 2) / cellSizeM) + 1;
  const startXM = -halfSpanM;
  const startYM = -halfSpanM;

  const metersToLat = (m) => m / 111320;
  const metersToLon = (m, atLat) => m / (111320 * Math.cos((atLat * Math.PI) / 180));

  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const x0 = startXM + ix * cellSizeM;
      const y0 = startYM + iy * cellSizeM;
      const x1 = x0 + cellSizeM;
      const y1 = y0 + cellSizeM;

      const lat0 = lat + metersToLat(y0);
      const lon0 = lon + metersToLon(x0, lat);
      const lat1 = lat + metersToLat(y1);
      const lon1 = lon + metersToLon(x1, lat);

      const depthM = Math.random() * 2;
      const depthCm = Math.round(depthM * 100);

      const rect = L.rectangle([[lat0, lon0], [lat1, lon1]], {
        weight: 1,
        opacity: 0.15,
        fillOpacity: 1,
        fillColor: floodColorFromMeters(depthM),
      });

      rect.bindTooltip(`${depthCm} cm`, { sticky: true, direction: "center", opacity: 0.95 });
      floodLayer.addLayer(rect);
    }
  }

  mapPreview.fitBounds(circle.getBounds(), { padding: [12, 12], maxZoom: 17 });
}

function showFloodDepthPreview() {
  const canvas = document.getElementById("previewChart");
  const heatmap = document.getElementById("heatmap");
  const floodMapEl = document.getElementById("previewFloodMap");

  if (canvas) canvas.style.display = "none";
  if (heatmap) heatmap.style.display = "none";
  if (floodMapEl) floodMapEl.style.display = "block";

  ensurePreviewFloodMap();
  renderRandomFloodDepthGrid(getSelectedLocationLatLng());
}

function setupPreviewIndicatorButtons() {
  const buttons = Array.from(
    document.querySelectorAll('#tab-ch .municipality-button[data-country="ch"]')
  ).filter(btn => !["126","245","585","all"].includes(btn.getAttribute("data-id"))); // exclude scenarios + ALL

  if (!buttons.length) return;

  const canvas = document.getElementById("previewChart");
  const heatmap = document.getElementById("heatmap");
  const floodMapEl = document.getElementById("previewFloodMap");
  if (!canvas || !heatmap) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      selectedIndicatorId = btn.getAttribute("data-id") || "indicator";
      const label = btn.textContent.trim() || selectedIndicatorId;

      // Always hide all visualizations first
      heatmap.style.display = "none";
      canvas.style.display = "none";
      if (floodMapEl) floodMapEl.style.display = "none";

      if (selectedIndicatorId === "risk_scores") {
        heatmap.style.display = "grid";
        renderHeatmap();
      } else if (selectedIndicatorId === "flood_depth") {
        showFloodDepthPreview();
      } else {
        canvas.style.display = "block";
        renderPreviewChart(label);
      }
    });
  });
}

function setupPreviewScenarioButtons() {
  const allBtn = document.querySelector('#tab-ch .municipality-button[data-country="ch"][data-id="all"]');
  const scenarioButtons = Array.from(
    document.querySelectorAll('#tab-ch .municipality-button[data-country="ch"]')
  ).filter(btn => ["126","245","585"].includes(btn.getAttribute("data-id")));

  if (!scenarioButtons.length) return;

  // default = ALL scenarios selected
  selectedScenarioIds = ["126","245","585"];
  scenarioButtons.forEach(btn => btn.classList.add("selected"));
  if (allBtn) allBtn.classList.add("selected");

  // ALL button logic
  if (allBtn) {
    allBtn.addEventListener("click", () => {
      selectedScenarioIds = ["126","245","585"];
      scenarioButtons.forEach(b => b.classList.add("selected"));
      allBtn.classList.add("selected");
      if (selectedIndicatorId === "risk_scores") renderHeatmap();
    });
  }

  // individual scenario toggle
  scenarioButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      btn.classList.toggle("selected");

      selectedScenarioIds = scenarioButtons
        .filter(b => b.classList.contains("selected"))
        .map(b => b.getAttribute("data-id"));

      // keep at least one
      if (selectedScenarioIds.length === 0) {
        btn.classList.add("selected");
        selectedScenarioIds = [id];
      }

      // ALL highlighted only if all 3 selected
      if (allBtn) {
        const allSelected = ["126","245","585"].every(x => selectedScenarioIds.includes(x));
        allBtn.classList.toggle("selected", allSelected);
      }

      if (selectedIndicatorId === "risk_scores") renderHeatmap();
    });
  });
}


function initPreviewDefaults() {
  const riskBtn = document.querySelector('#tab-ch .municipality-button[data-country="ch"][data-id="risk_scores"]');
  if (riskBtn) riskBtn.click(); // uses your existing click logic to show heatmap + select button
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
  const corner=document.createElement('div'); corner.className='header'; corner.style.textAlign='right'; corner.textContent='your facilities'; corner.style.fontWeight='600'; container.appendChild(corner);
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
  setupPreviewScenarioButtons();   // ✅ add this
  initPreviewDefaults();           // ✅ add this

  setupDownloadGraphButton();
  renderPreviewChart("Select an indicator on the right");
  renderGantt();
  setupLocationDropdown();
  setupDownloadPlotButton();
});


// =======================
// Gantt definition
// =======================

const ganttTasks = [
  {
    name: "Project technical specifications",
    start: "2026-01-15",
    end: "2026-01-30",
  },
  {
    name: "Invoice settlement phase 1",
    start: "2026-02-01",
    end: "2026-02-09",
  },
    {
    name: "Delivery settlement phase 1",
    start: "2026-02-10",
    end: "2026-03-01",
  },
  {
    name: "Adding feature 1: address (instead of lat/lon)",
    start: "2026-03-01",
    end: "2026-03-15",
  },
  {
    name: "Adding feature 2: summary tables with user-defined thresholds",
    start: "2026-03-16",
    end: "2026-04-01",
  },
  {
    name: "Adding feature 3: probability calculations",
    start: "2026-04-01",
    end: "2026-05-01",
  },
  {
    name: "Adding feature 4: historical data update",
    start: "2026-05-01",
    end: "2026-05-15",
  },
  {
    name: "Adding feature 5: Backup server setup or cloud hosting",
    start: "2026-05-15",
    end: "2026-06-01",
  },
  {
    name: "Adding feature 6: Adding flood return periods",
    start: "2026-06-01",
    end: "2026-07-01",
  },
];

function renderGantt() {
  const axis = document.getElementById("gantt-axis");
  const container = document.getElementById("gantt-container");
  if (!axis || !container) return;

  // Clear previous render
  axis.innerHTML = "";
  container.innerHTML = "";

  // Parse dates
  const parse = (s) => new Date(s + "T00:00:00");
  const tasks = ganttTasks.map(t => ({
    ...t,
    startDate: parse(t.start),
    endDate: parse(t.end),
  }));

  const minDate = new Date(Math.min(...tasks.map(t => t.startDate.getTime())));
  const maxDate = new Date(Math.max(...tasks.map(t => t.endDate.getTime())));
  const total = maxDate.getTime() - minDate.getTime() || 1;

  // Rows
  tasks.forEach((t) => {
    const row = document.createElement("div");
    row.className = "gantt-row";

    const label = document.createElement("div");
    label.className = "gantt-label";
    label.textContent = t.name;

    const track = document.createElement("div");
    track.className = "gantt-track";

    const bar = document.createElement("div");
    bar.className = "gantt-bar";

    const leftPct = ((t.startDate.getTime() - minDate.getTime()) / total) * 100;
    const widthPct = ((t.endDate.getTime() - t.startDate.getTime()) / total) * 100;

    const left = Math.max(0, leftPct);
    const width = Math.max(0.5, widthPct);

    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;

    const date = document.createElement("div");
    date.className = "gantt-date";
    date.textContent = `${t.start} → ${t.end}`;

    // center the date above the bar
    const centerPct = leftPct + widthPct / 2;
    date.style.left = `${Math.max(0, Math.min(100, centerPct))}%`;

    // label that sticks near the bar
    const name = document.createElement("div");
    name.className = "gantt-bar-label";
    name.textContent = t.name;
    name.style.left = `${left}%`;
    track.appendChild(date);
    track.appendChild(bar);
    track.appendChild(name);

    row.appendChild(track);
    container.appendChild(row);
  });
}

// (Bootstrapping is handled by the first DOMContentLoaded listener above.)

let selectedLocationName = "All locations";
let selectedScenarioIds = ["126", "245", "585"]; // default = ALL selected

async function setupLocationDropdown() {
  const select = document.getElementById("locationSelect");
  if (!select) return;

  let cities = null;

  try {
    const resp = await fetch("assets/cities.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    cities = await resp.json();
  } catch (e) {
    // fallback (so it also works on file://)
    cities = [
      { name: "London", lat: 51.5074, lon: -0.1278 },
      { name: "Paris", lat: 48.8566, lon: 2.3522 }
    ];
  }

  select.innerHTML = "";
  cities.forEach((c, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = c.name || `Location ${i + 1}`;
    select.appendChild(opt);
  });

  // default selection
  selectedLocationName = (cities[0]?.name || "Location 1");

  select.addEventListener("change", () => {
    const idx = Number(select.value);
    const city = cities[idx];
    selectedLocationName = city?.name || "Location";

    // re-render the current view with location in title
    if (selectedIndicatorId === "risk_scores") {
      renderHeatmap();
    } else {
      renderPreviewChart(getCurrentChartLabel());
    }
  });
}

function getCurrentChartLabel() {
  // use the selected indicator label if possible; otherwise generic
  const activeBtn = document.querySelector('#tab-ch .municipality-button.selected');
  const indicatorLabel = activeBtn ? activeBtn.textContent.trim() : "Indicator";
  return `${indicatorLabel} — ${selectedLocationName}`;
}

function setupDownloadPlotButton() {
  const btn = document.getElementById("btnDownloadPlot");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const heatmap = document.getElementById("heatmap");
    const canvas = document.getElementById("previewChart");

    // export effect
    btn.classList.add("is-exporting");
    const originalText = btn.textContent;
    btn.textContent = "Exporting…";

    setTimeout(() => {
      try {
        // If heatmap is visible, we keep behavior simple: require chart selection
        if (heatmap && heatmap.style.display !== "none") {
          alert("Download is available for the time series chart. Select a non-risk indicator to download the plot.");
          return;
        }

        if (!canvas) return;

        const safeLoc = (selectedLocationName || "location").replace(/[^\w\-]+/g, "_");
        const safeInd = (selectedIndicatorId || "indicator").replace(/[^\w\-]+/g, "_");
        const filename = `${safeInd}__${safeLoc}.png`;

        const link = document.createElement("a");
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } finally {
        btn.classList.remove("is-exporting");
        btn.textContent = originalText;
      }
    }, 150); // small delay so the “Exporting…” state is visible
  });
}

// NOTE: do not set selectedIndicatorId here. It's set when a user clicks an indicator button.
