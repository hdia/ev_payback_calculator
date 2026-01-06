/* EV Payback Calculator – v2 (chart-first)
   Front-end only (no PyScript). Uses pairs.json.
   Built to reproduce article defaults and remain stable on GitHub Pages.
*/

const DEFAULTS = {
  pair_id: "atto3_vs_corolla_cross_hybrid",
  annual_km: 15000,
  home_share: 80,      // %
  home_price: 30,      // c/kWh
  public_price: 55,    // c/kWh
  petrol: 1.85,        // $/L
  losses: 10,          // %
  maint: 150,          // $/year
  rw: false            // real-world adjustment toggle
};

const MAX_PAYBACK_DISPLAY = 15; // for display in KPIs
const MAX_PAYBACK_HEATMAP = 15; // cap for heatmap scale
const HEATMAP_GRID_STEP = 5;    // % increments for heatmap

function $(id) { return document.getElementById(id); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function money(x) {
  const sign = x < 0 ? "-" : "";
  return `${sign}$${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function money2(x) {
  const sign = x < 0 ? "-" : "";
  return `${sign}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtYears(y) {
  if (y === null || y === undefined || !isFinite(y)) return "N/A";
  if (y > MAX_PAYBACK_DISPLAY) return `>${MAX_PAYBACK_DISPLAY}`;
  if (y < 10) return `${Math.round(y * 10) / 10}`; // 1 decimal
  return `${Math.round(y)}`;
}

function parseQuery() {
  const q = new URLSearchParams(window.location.search);
  const st = { ...DEFAULTS };

  const get = (k) => q.get(k);

  if (get("pair")) st.pair_id = get("pair");
  if (get("km")) st.annual_km = parseInt(get("km"), 10) || st.annual_km;
  if (get("home")) st.home_share = parseInt(get("home"), 10) || st.home_share;
  if (get("eh")) st.home_price = parseFloat(get("eh")) || st.home_price;
  if (get("ep")) st.public_price = parseFloat(get("ep")) || st.public_price;
  if (get("petrol")) st.petrol = parseFloat(get("petrol")) || st.petrol;
  if (get("loss")) st.losses = parseFloat(get("loss")) || st.losses;
  if (get("maint")) st.maint = parseFloat(get("maint")) || st.maint;
  if (get("rw")) st.rw = ["1", "true", "yes", "on"].includes(String(get("rw")).toLowerCase());

  // clamp
  st.annual_km = clamp(st.annual_km, 5000, 50000);
  st.home_share = clamp(st.home_share, 0, 100);
  st.home_price = clamp(st.home_price, 0, 200);
  st.public_price = clamp(st.public_price, 0, 300);
  st.petrol = clamp(st.petrol, 0.5, 4.0);
  st.losses = clamp(st.losses, 0, 30);
  st.maint = clamp(st.maint, 0, 1000);

  return st;
}

function makeShareURL(st) {
  const params = new URLSearchParams({
    pair: st.pair_id,
    km: Math.round(st.annual_km),
    home: Math.round(st.home_share),
    eh: Number(st.home_price).toFixed(1),
    ep: Number(st.public_price).toFixed(1),
    petrol: Number(st.petrol).toFixed(2),
    loss: Number(st.losses).toFixed(1),
    maint: Number(st.maint).toFixed(0),
    rw: st.rw ? "1" : "0"
  });
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function compute(pair, st) {
  let ev_kwh = Number(pair.ev_kwh_per_100km);
  let ice_l = Number(pair.ice_l_per_100km);

  if (st.rw) {
    ev_kwh *= 1.10;
    ice_l *= 1.15;
  }

  const losses = Number(st.losses) / 100;
  const grid_kwh = ev_kwh * (1 + losses);

  const home_share = clamp(Number(st.home_share), 0, 100) / 100;
  const public_share = 1 - home_share;

  const home_price = Number(st.home_price) / 100;
  const public_price = Number(st.public_price) / 100;

  const weighted_elec = home_share * home_price + public_share * public_price;

  const ev_cost_100 = grid_kwh * weighted_elec;
  const ice_cost_100 = ice_l * Number(st.petrol);
  const savings_100 = ice_cost_100 - ev_cost_100;

  const annual_km = Number(st.annual_km);
  const annual_energy_savings = savings_100 * (annual_km / 100);
  const annual_savings = annual_energy_savings + Number(st.maint);

  const upfront = Number(pair.upfront_premium_aud);
  const payback = annual_savings > 0 ? (upfront / annual_savings) : null;

  return {
    ev_cost_100, ice_cost_100, savings_100,
    annual_energy_savings, annual_savings,
    upfront, payback,
    grid_kwh_100: grid_kwh,
    weighted_elec
  };
}

function renderKPIs(res) {
  $("kpi-payback").innerText = fmtYears(res.payback);
  $("kpi-annual").innerText = money(res.annual_savings);
  $("kpi-per100").innerText = money2(res.savings_100);

  if (res.annual_savings <= 0) {
    $("kpi-payback-sub").innerText = "No running-cost payback under these assumptions.";
  } else {
    $("kpi-payback-sub").innerText = "Upfront premium repaid through energy + servicing savings.";
  }
  $("kpi-annual-sub").innerText = "Annual running-cost difference (energy + servicing).";
  $("kpi-per100-sub").innerText = "Difference in running cost per 100 km.";
}

function renderSummary(pair, st, res) {
  const km = Math.round(st.annual_km);
  const home = Math.round(st.home_share);

  let txt;
  if (res.annual_savings <= 0) {
    txt = `With ${km.toLocaleString()} km/year and ${home}% home charging, the EV is estimated to cost more to run than the comparator under these assumptions (no payback).`;
  } else {
    txt = `With ${km.toLocaleString()} km/year and ${home}% home charging, the EV is estimated to save about ${money(res.annual_savings)} per year and pay back the upfront premium in ${fmtYears(res.payback)} years.`;
  }
  $("summary").innerText = txt;
  return txt;
}

/* ------------------- Charts ------------------- */

function plotHeatmap(pair, st) {
  // Heatmap over annual_km (x) and home_share (y)

  const x = [];
  for (let km = 10000; km <= 20000; km += 1000) x.push(km);

  const y = [];
  for (let h = 0; h <= 100; h += HEATMAP_GRID_STEP) y.push(h);

  // z contains payback years, with:
  // - null for N/A (no running-cost advantage)
  // - capped at MAX_PAYBACK_HEATMAP for colour scaling consistency
  const z = y.map(home => {
    return x.map(km => {
      const st2 = { ...st, home_share: home, annual_km: km };
      const res = compute(pair, st2);

      if (!res || res.annual_savings <= 0 || res.payback === null || res.payback === undefined) {
        return null; // show as gaps (N/A)
      }

      return Math.min(res.payback, MAX_PAYBACK_HEATMAP);
    });
  });

  const trace = {
    type: "heatmap",
    x,
    y,
    z,
    hoverongaps: false,
    hovertemplate:
      "Home charging: %{y}%<br>" +
      "Annual km: %{x:,}<br>" +
      "Payback: %{z:.1f} yrs<extra></extra>",
    colorbar: { title: "Payback (yrs)" },
    zmin: 0,
    zmax: MAX_PAYBACK_HEATMAP,
    showscale: true
  };

  const layout = {
    margin: { l: 50, r: 10, t: 20, b: 45 },
    xaxis: { title: "Annual kilometres", tickformat: "," },
    yaxis: { title: "Home charging share (%)" },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#9ca3af" }
  };

  const config = { displayModeBar: false, responsive: true };

  Plotly.react("chart-heatmap", [trace], layout, config);
}


function plotPaybackCurve(pair, st) {
  const xs = [];
  for (let h = 0; h <= 100; h += 5) xs.push(h);

  const ys = xs.map(h => {
    const st2 = { ...st, home_share: h };
    const res = compute(pair, st2);
    if (res.annual_savings <= 0) return null;
    return Math.min(res.payback, MAX_PAYBACK_HEATMAP);
  });

  const trace = {
    x: xs,
    y: ys,
    mode: "lines+markers",
    name: "Payback",
    hovertemplate: "Home charging: %{x}%<br>Payback: %{y:.1f} yrs<extra></extra>"
  };

  const layout = {
    margin: { l: 50, r: 15, t: 10, b: 40 },
    xaxis: { title: "Home charging share (%)", range: [0, 100] },
    yaxis: { title: "Payback (years)", range: [0, MAX_PAYBACK_HEATMAP] },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#9ca3af" }
  };
  const config = { displayModeBar: false, responsive: true };

  Plotly.react("chart-payback", [trace], layout, config);
}

function plotCumulative(pair, st) {
  const res = compute(pair, st);
  const years = [];
  for (let i = 0; i <= 15; i++) years.push(i);

  const ys = years.map(y => -res.upfront + res.annual_savings * y);

  const trace = {
    x: years,
    y: ys,
    mode: "lines",
    name: "Cumulative net savings",
    hovertemplate: "Year %{x}: %{y:$,.0f}<extra></extra>"
  };

  const layout = {
    margin: { l: 55, r: 15, t: 10, b: 40 },
    xaxis: { title: "Years", dtick: 1 },
    yaxis: { title: "Net savings (AUD)" },
    shapes: [{
      type: "line",
      x0: 0, x1: 15,
      y0: 0, y1: 0,
      line: { color: "rgba(156,163,175,.5)", width: 1 }
    }],
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#9ca3af" }
  };

  const config = { displayModeBar: false, responsive: true };

  Plotly.react("chart-cumulative", [trace], layout, config);
}

/* ------------------- UI ------------------- */

function buildUI(pairs, state) {
  const root = document.querySelector(".container");
  root.innerHTML = `
    <div class="grid">
      <div>
        <div class="card">
          <div class="kpis">
            <div class="kpi">
              <div class="label">Payback time</div>
              <div class="value" id="kpi-payback">–</div>
              <div class="sub" id="kpi-payback-sub">–</div>
            </div>
            <div class="kpi">
              <div class="label">Annual savings</div>
              <div class="value" id="kpi-annual">–</div>
              <div class="sub" id="kpi-annual-sub">–</div>
            </div>
            <div class="kpi">
              <div class="label">Savings per 100 km</div>
              <div class="value" id="kpi-per100">–</div>
              <div class="sub" id="kpi-per100-sub">–</div>
            </div>
          </div>

          <div class="summary" id="summary">–</div>

          <hr class="sep" />

          <h2>How payback changes with home charging</h2>
          <div class="note">This is the same vehicle pair and prices, varying only the home charging share.</div>
          <div id="chart-payback" class="chart small"></div>

          <hr class="sep" />

          <h2>Cumulative net savings over time</h2>
          <div class="note">Net savings relative to paying the upfront premium today (running costs only).</div>
          <div id="chart-cumulative" class="chart small"></div>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>Inputs</h2>

          <div class="field">
            <label>Vehicle pair</label>
            <select id="pair"></select>
            <div class="note">These are the five EV vs petrol/hybrid pairs used in the article.</div>
          </div>

          <div class="field">
            <label>Annual kilometres</label>
            <input type="range" id="km-slider" min="5000" max="50000" step="500" />
            <input type="number" id="km" min="5000" max="50000" step="500" />
          </div>

          <div class="field">
            <label>Home charging share (%)</label>
            <input type="range" id="home-slider" min="0" max="100" step="1" />
            <input type="number" id="home" min="0" max="100" step="1" />
            <div class="note">The rest is assumed to be public fast charging.</div>
          </div>

          <div class="split">
            <div class="field">
              <label>Home electricity price (c/kWh)</label>
              <input type="number" id="eh" min="0" max="200" step="1" />
            </div>
            <div class="field">
              <label>Public fast charging (c/kWh)</label>
              <input type="number" id="ep" min="0" max="300" step="1" />
            </div>
          </div>

          <div class="split">
            <div class="field">
              <label>Petrol price ($/L)</label>
              <input type="number" id="petrol" min="0.5" max="4.0" step="0.01" />
            </div>
            <div class="field">
              <label>Charging losses (%)</label>
              <input type="number" id="loss" min="0" max="30" step="1" />
              <div class="note">Baseline includes 10% losses (as per article).</div>
            </div>
          </div>

          <div class="field">
            <label>EV servicing saving ($/year)</label>
            <input type="number" id="maint" min="0" max="1000" step="10" />
            <div class="note">Conservative default: EV costs $150/year less to service.</div>
          </div>

          <div class="field">
            <label><input type="checkbox" id="rw" /> Apply real-world adjustment (EV +10%, ICE +15%)</label>
            <div class="note">Optional, defaults use official label figures.</div>
          </div>

          <div class="pills">
            <button class="btn primary" id="btn-share">Copy share link</button>
            <button class="btn" id="btn-copy">Copy summary</button>
            <button class="btn" id="btn-reset">Reset</button>
          </div>

          <hr class="sep" />

          <h2>Payback map (home charging vs annual km)</h2>
          <div class="note">This visualises how payback depends on charging access and usage intensity.</div>
          <div id="chart-heatmap" class="chart"></div>

          <div class="note" style="margin-top:12px">
            Includes: energy costs (electricity vs petrol) and a conservative servicing difference. <br>
            Excludes: resale value, depreciation, insurance, finance costs, registration discounts, and rebates. <br>
            Figures are indicative and depend heavily on charging access and energy prices.
          </div>
        </div>
      </div>
    </div>

    <div class="footer">
      Built by Swinburne University of Technology. Data inputs based on Australian label figures (ADR 81/02) and transparent baseline energy prices.
    </div>
  `;

  // Populate dropdown
  const sel = $("pair");
  sel.innerHTML = "";
  for (const p of pairs) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
}

function getStateFromUI() {
  return {
    pair_id: $("pair").value,
    annual_km: Number($("km").value),
    home_share: Number($("home").value),
    home_price: Number($("eh").value),
    public_price: Number($("ep").value),
    petrol: Number($("petrol").value),
    losses: Number($("loss").value),
    maint: Number($("maint").value),
    rw: $("rw").checked
  };
}

function setUIFromState(st) {
  $("pair").value = st.pair_id;
  $("km").value = st.annual_km;
  $("km-slider").value = st.annual_km;
  $("home").value = st.home_share;
  $("home-slider").value = st.home_share;
  $("eh").value = st.home_price;
  $("ep").value = st.public_price;
  $("petrol").value = st.petrol;
  $("loss").value = st.losses;
  $("maint").value = st.maint;
  $("rw").checked = st.rw;
}

function wireUI(pairsById) {
  const syncKm = () => { $("km").value = $("km-slider").value; refresh(pairsById); };
  $("km-slider").addEventListener("input", syncKm);

  const syncHome = () => { $("home").value = $("home-slider").value; refresh(pairsById); };
  $("home-slider").addEventListener("input", syncHome);

  const inputs = ["pair", "km", "home", "eh", "ep", "petrol", "loss", "maint", "rw"];
  for (const id of inputs) {
    $(id).addEventListener("input", () => refresh(pairsById));
    $(id).addEventListener("change", () => refresh(pairsById));
  }

  $("btn-reset").addEventListener("click", () => {
    window.location.search = "";
  });

  $("btn-copy").addEventListener("click", () => {
    navigator.clipboard.writeText($("summary").innerText);
    alert("Summary copied to clipboard.");
  });

  $("btn-share").addEventListener("click", () => {
    const st = getStateFromUI();
    const url = makeShareURL(st);
    navigator.clipboard.writeText(url);
    alert("Share link copied to clipboard.");
  });
}

function refresh(pairsById) {
  const st = getStateFromUI();
  const pair = pairsById[st.pair_id];
  if (!pair) return;

  const res = compute(pair, st);

  renderKPIs(res);
  renderSummary(pair, st, res);

  plotHeatmap(pair, st);
  plotPaybackCurve(pair, st);
  plotCumulative(pair, st);
}

/* ------------------- Boot ------------------- */

async function loadPairs() {
  const res = await fetch("pairs.json");
  if (!res.ok) throw new Error("Failed to load pairs.json");
  return await res.json();
}

(async function main() {
  const pairs = await loadPairs();
  const pairsById = Object.fromEntries(pairs.map(p => [p.id, p]));

  // Build UI skeleton inside container
  buildUI(pairs, DEFAULTS);

  // Parse query params and set UI
  const st = parseQuery();
  if (!pairsById[st.pair_id]) st.pair_id = DEFAULTS.pair_id;
  setUIFromState(st);

  // Wire and render
  wireUI(pairsById);
  refresh(pairsById);

  console.log("EV Payback Calculator loaded.");
})();
