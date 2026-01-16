/*
  Static frontend for GitHub Pages.
  It reads ./data/series.json (written daily by GitHub Actions) and renders a compare chart.
*/

const METALS = [
  { code: "XCU", name: "Copper (XCU)" },
  { code: "XAU", name: "Gold (XAU)" },
  { code: "XAG", name: "Silver (XAG)" },
  { code: "ALU", name: "Aluminum (ALU)" },
  { code: "XPD", name: "Palladium (XPD)" },
  { code: "XPT", name: "Platinum (XPT)" },
];

const state = {
  selected: new Set(METALS.map(m => m.code)),
  range: "5y",
  logScale: false,
  normalize: true,
  filter: "",
  series: [], // [{date:'YYYY-MM-DD', rates:{XAU:..., ...}}]
};

function parseISODate(s) {
  // 'YYYY-MM-DD' -> Date in UTC
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDateUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeStart(range) {
  const now = new Date();
  const utcNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const d = new Date(utcNow);
  const msDay = 24 * 60 * 60 * 1000;

  if (range === "1d") return new Date(utcNow.getTime() - 1 * msDay);
  if (range === "3d") return new Date(utcNow.getTime() - 3 * msDay);
  if (range === "1w") return new Date(utcNow.getTime() - 7 * msDay);
  if (range === "1m") { d.setUTCMonth(d.getUTCMonth() - 1); return d; }
  if (range === "3m") { d.setUTCMonth(d.getUTCMonth() - 3); return d; }
  if (range === "6m") { d.setUTCMonth(d.getUTCMonth() - 6); return d; }
  if (range === "1y") { d.setUTCFullYear(d.getUTCFullYear() - 1); return d; }
  if (range === "5y") { d.setUTCFullYear(d.getUTCFullYear() - 5); return d; }
  if (range === "ytd") return new Date(Date.UTC(utcNow.getUTCFullYear(), 0, 1));

  return new Date(Date.UTC(utcNow.getUTCFullYear() - 5, utcNow.getUTCMonth(), utcNow.getUTCDate()));
}

function filterSeriesByRange(series, range) {
  const start = rangeStart(range);
  return series.filter(row => parseISODate(row.date) >= start);
}

function normalize(values) {
  if (values.length === 0) return values;
  const base = values[0];
  // Avoid divide by 0
  if (!isFinite(base) || base === 0) return values;
  return values.map(v => (v / base) * 100);
}

function buildTraces() {
  const selected = Array.from(state.selected);
  const filtered = filterSeriesByRange(state.series, state.range);

  const traces = [];

  for (const code of selected) {
    const x = [];
    const y = [];

    for (const row of filtered) {
      const v = row.rates?.[code];
      if (v == null) continue;
      x.push(row.date);
      y.push(Number(v));
    }

    const yFinal = state.normalize ? normalize(y) : y;

    traces.push({
      type: "scatter",
      mode: "lines",
      name: METALS.find(m => m.code === code)?.name || code,
      x,
      y: yFinal,
      hovertemplate: "%{x}<br>%{y:.4g}<extra></extra>",
    });
  }

  return traces;
}

function render() {
  const traces = buildTraces();

  const layout = {
    paper_bgcolor: "#0b0c10",
    plot_bgcolor: "#0b0c10",
    font: { color: "#e9e9e9" },
    margin: { l: 60, r: 20, t: 20, b: 50 },
    legend: { orientation: "h" },
    xaxis: { title: "Date", gridcolor: "#232633" },
    yaxis: {
      title: state.normalize ? "Indexed (start=100)" : "Price",
      type: state.logScale ? "log" : "linear",
      gridcolor: "#232633",
      rangemode: "tozero",
    },
  };

  const config = { responsive: true, displaylogo: false };

  Plotly.react("chart", traces, layout, config);
}

function mountChips() {
  const chips = document.getElementById("chips");
  chips.innerHTML = "";

  const filtered = METALS.filter(m => {
    if (!state.filter) return true;
    const t = state.filter.toLowerCase();
    return m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t);
  });

  for (const m of filtered) {
    const btn = document.createElement("button");
    btn.className = "chip" + (state.selected.has(m.code) ? " active" : "");
    btn.textContent = m.name;
    btn.onclick = () => {
      if (state.selected.has(m.code)) state.selected.delete(m.code);
      else state.selected.add(m.code);
      btn.classList.toggle("active");
      render();
    };
    chips.appendChild(btn);
  }
}

function wireControls() {
  const rangeEl = document.getElementById("range");
  rangeEl.value = state.range;
  rangeEl.addEventListener("change", (e) => {
    state.range = e.target.value;
    render();
  });

  document.getElementById("logScale").addEventListener("change", (e) => {
    state.logScale = e.target.checked;
    render();
  });

  const normEl = document.getElementById("normalize");
  normEl.checked = state.normalize;
  normEl.addEventListener("change", (e) => {
    state.normalize = e.target.checked;
    render();
  });

  const filterEl = document.getElementById("filter");
  filterEl.addEventListener("input", (e) => {
    state.filter = e.target.value;
    mountChips();
  });
}

async function loadData() {
  const meta = await fetch("data/meta.json", { cache: "no-store" }).then(r => r.json());
  const seriesObj = await fetch("data/series.json", { cache: "no-store" }).then(r => r.json());

  const rows = Array.isArray(seriesObj?.rows) ? seriesObj.rows : [];
  state.series = rows;

  const last = meta?.last_updated_utc ?? "(not yet updated)";
  const base = meta?.base ?? seriesObj?.base ?? "USD";
  document.getElementById("last-updated").textContent =
    `Last updated: ${last} (UTC) • Base: ${base} • Rows: ${rows.length}`;
}

(async function init() {
  wireControls();
  await loadData();
  mountChips();
  render();
})();
