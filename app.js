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

  // Fit to container
  const parent = canvas.parentElement;
  const w = Math.max(640, parent?.clientWidth || 900);
  const h = Math.max(360, parent?.clientHeight || 520);
  canvas.width = w;
  canvas.height = h;

  // ---- CONFIG ----
  const HIST_START = 1991, HIST_END = 2025;
  const FUT_START = 2026, FUT_END = 2050;

  const COLORS = {
    historical: "#000000",
    "126": "#1f77b4", // ssp1
    "245": "#ff7f0e", // ssp2
    "585": "#d62728", // ssp5
  };

  const scenarioName = {
    "126": "rcp2.6",
    "245": "rcp4.5",
    "585": "rcp8.5",
  };

  // selectedScenarioIds should already exist in your app
  const selected = (Array.isArray(selectedScenarioIds) && selectedScenarioIds.length)
    ? selectedScenarioIds
    : ["126", "245", "585"];

  // ---- Generate demo data (replace with real data when ready) ----
  function seriesYears(a, b) {
    const out = [];
    for (let y = a; y <= b; y++) out.push(y);
    return out;
  }

  // base signal (just a smooth-ish curve)
  function baseValue(year) {
    const t = (year - HIST_START) / (FUT_END - HIST_START);
    return 0.4 + 0.15 * Math.sin(t * Math.PI * 2) + 0.08 * Math.cos(t * Math.PI * 4);
  }

  function noise(seed) {
    // deterministic-ish noise per year/seed
    const x = Math.sin(seed * 999 + 0.17) * 10000;
    return x - Math.floor(x);
  }

  const histYears = seriesYears(HIST_START, HIST_END);
  const hist = histYears.map((y, i) => ({ x: y, y: baseValue(y) + (noise(y) - 0.5) * 0.04 }));

  const futYears = seriesYears(FUT_START, FUT_END);
  const scen = {};
  ["126", "245", "585"].forEach((id) => {
    // scenario offsets / trends
    const drift = (id === "126") ? 0.05 : (id === "245") ? 0.10 : 0.18;
    scen[id] = futYears.map((y) => {
      const dt = (y - FUT_START) / (FUT_END - FUT_START);
      return { x: y, y: baseValue(y) + drift * dt + (noise(y + Number(id)) - 0.5) * 0.04 };
    });
  });

  // ---- Determine y-range from visible data ----
  const allPoints = [
    ...hist,
    ...selected.flatMap(id => scen[id] || [])
  ];
  let ymin = Math.min(...allPoints.map(p => p.y));
  let ymax = Math.max(...allPoints.map(p => p.y));
  const pad = (ymax - ymin) * 0.15 || 0.1;
  ymin -= pad; ymax += pad;

  // ---- Layout ----
  const margin = { l: 60, r: 20, t: 40, b: 45 };
  const plotW = w - margin.l - margin.r;
  const plotH = h - margin.t - margin.b;

  const xMin = HIST_START, xMax = FUT_END;

  const X = (year) => margin.l + ((year - xMin) / (xMax - xMin)) * plotW;
  const Y = (val) => margin.t + (1 - (val - ymin) / (ymax - ymin)) * plotH;

  // ---- Clear ----
  ctx.clearRect(0, 0, w, h);

  // Title
  ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillStyle = "#111";
  ctx.fillText(label, margin.l, 24);

  // Axes
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, margin.t + plotH);
  ctx.lineTo(margin.l + plotW, margin.t + plotH);
  ctx.stroke();

  // X ticks (years)
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const xticks = [1991, 2000, 2010, 2020, 2025, 2030, 2040, 2050];
  xticks.forEach((yr) => {
    const x = X(yr);
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, margin.t);
    ctx.lineTo(x, margin.t + plotH);
    ctx.stroke();

    ctx.fillText(String(yr), x - 12, margin.t + plotH + 28);
  });

  // separator at 2025/2026
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(X(2025.5), margin.t);
  ctx.lineTo(X(2025.5), margin.t + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- Draw line helper ----
  function drawLine(points, color, width) {
    if (!points || points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(X(points[0].x), Y(points[0].y));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(X(points[i].x), Y(points[i].y));
    }
    ctx.stroke();
  }

  // Historical (1991–2025) in black
  drawLine(hist, COLORS.historical, 2.5);

  // Future (2026–2050) scenarios
  selected.forEach((id) => {
    drawLine(scen[id], COLORS[id] || "#666", 2.2);
  });

  // ---- Inline labels near last point ----
  function labelAtEnd(points, text, color) {
    if (!points || !points.length) return;
    const p = points[points.length - 1];
    const x = X(p.x) + 8;
    const y = Y(p.y) + 4;
    ctx.fillStyle = color;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(text, Math.min(x, w - 140), Math.max(y, margin.t + 12));
  }

  labelAtEnd(hist, "Historical", COLORS.historical);
  selected.forEach((id) => labelAtEnd(scen[id], scenarioName[id] || id, COLORS[id] || "#666"));
}


// -----------------------
// Heatmap code (provided)
// -----------------------
const riskLabels = ['river flood', 'coastal flood', 'wildfire', 'drought','heat wave','severe storm', 'extreme rainfall','landslide','cold stress','change in precip','change in temp'];
const siteLabels = Array.from({length: 12}, (_, i) => `site ${i+1}`);
function riskColor(v) { switch (v) { case 1:return '#01455c'; case 2:return '#025773'; case 3:return '#2f7dbd'; case 4:return '#35c7d6'; case 5:return '#40E0D0'; default:return '#808080'; } }
function seededRand(seed){let x=seed%2147483647;if(x<=0)x+=2147483646;return()=> (x= x*16807%2147483647)/2147483647;}
function renderHeatmap(){
  const container=document.getElementById('heatmap'); if(!container) return; container.innerHTML='';
  const corner=document.createElement('div'); corner.className='header'; corner.style.textAlign='right'; corner.textContent=''; corner.style.fontWeight='600'; container.appendChild(corner);
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
