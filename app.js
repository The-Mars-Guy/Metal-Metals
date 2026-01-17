const SERIES = [
  { symbol: "XAU", name: "Gold (XAU)" },
  { symbol: "XAG", name: "Silver (XAG)" },
  { symbol: "XPD", name: "Palladium (XPD)" },
  { symbol: "XPT", name: "Platinum (XPT)" },
  { symbol: "XCU", name: "Copper (XCU)" },
  { symbol: "ALU", name: "Aluminum (ALU)" },
];

const state = {
  selected: new Set(SERIES.map(s => s.symbol)),
  range: "5y",
  logScale: false,
  normalize: true,
  data: new Map(),
};

function rangeStart(range) {
  const now = new Date();
  const d = new Date(now);
  const msDay = 24 * 60 * 60 * 1000;

  if (range === "1d") return new Date(now.getTime() - 1 * msDay);
  if (range === "3d") return new Date(now.getTime() - 3 * msDay);
  if (range === "1w") return new Date(now.getTime() - 7 * msDay);
  if (range === "1m") { d.setMonth(d.getMonth() - 1); return d; }
  if (range === "3m") { d.setMonth(d.getMonth() - 3); return d; }
  if (range === "6m") { d.setMonth(d.getMonth() - 6); return d; }
  if (range === "1y") { d.setFullYear(d.getFullYear() - 1); return d; }
  if (range === "5y") { d.setFullYear(d.getFullYear() - 5); return d; }
  if (range === "ytd") return new Date(now.getFullYear(), 0, 1);

  return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
}

function normalizeSeries(points) {
  if (!points.length) return points;
  const base = points[0].value;
  if (!base || base <= 0) return points;
  return points.map(p => ({ ...p, value: (p.value / base) * 100 }));
}

function filterByRange(points, range) {
  const start = rangeStart(range);
  return points.filter(p => new Date(p.date + "T00:00:00Z") >= start);
}

function buildTraces() {
  const traces = [];
  for (const sym of state.selected) {
    const raw = state.data.get(sym) || [];
    let pts = filterByRange(raw, state.range);
    if (state.normalize) pts = normalizeSeries(pts);

    traces.push({
      type: "scatter",
      mode: "lines",
      name: SERIES.find(s => s.symbol === sym)?.name || sym,
      x: pts.map(p => p.date),
      y: pts.map(p => p.value),
      hovertemplate: "%{x}<br>%{y:.6f}<extra></extra>",
    });
  }
  return traces;
}

function render() {
  const traces = buildTraces();
  const layout = {
    paper_bgcolor: "#0b0c10",
    plot_bgcolor: "#0b0c10",
    font: { color: "#e7e7e7" },
    margin: { l: 70, r: 20, t: 20, b: 50 },
    legend: { orientation: "h" },
    xaxis: { title: "Date", gridcolor: "#222" },
    yaxis: {
      title: state.normalize ? "Indexed (start=100)" : "Price (API units)",
      type: state.logScale ? "log" : "linear",
      gridcolor: "#222",
    },
  };
  Plotly.react("chart", traces, layout, { responsive: true });
}

function mountChips() {
  const chips = document.getElementById("chips");
  chips.innerHTML = "";
  for (const s of SERIES) {
    const btn = document.createElement("button");
    btn.className = "chip" + (state.selected.has(s.symbol) ? " active" : "");
    btn.textContent = s.name;
    btn.onclick = () => {
      if (state.selected.has(s.symbol)) state.selected.delete(s.symbol);
      else state.selected.add(s.symbol);
      btn.classList.toggle("active");
      render();
    };
    chips.appendChild(btn);
  }
}

async function loadAllData() {
  const meta = await fetch("data/meta.json", { cache: "no-store" }).then(r => r.json());
  document.getElementById("last-updated").textContent =
    `Last updated: ${meta.last_updated_utc} (UTC) | Base: ${meta.base || "USD"}`;

  await Promise.all(SERIES.map(async (s) => {
    const rows = await fetch(`data/${s.symbol}.json`, { cache: "no-store" }).then(r => r.json());
    state.data.set(s.symbol, rows);
  }));
}

function wireControls() {
  document.getElementById("range").value = state.range;
  document.getElementById("range").addEventListener("change", (e) => {
    state.range = e.target.value;
    render();
  });

  document.getElementById("logScale").addEventListener("change", (e) => {
    state.logScale = e.target.checked;
    render();
  });

  document.getElementById("normalize").checked = state.normalize;
  document.getElementById("normalize").addEventListener("change", (e) => {
    state.normalize = e.target.checked;
    render();
  });
}

(async function init() {
  mountChips();
  wireControls();
  await loadAllData();
  render();
})();
