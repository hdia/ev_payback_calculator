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
const MAX_PAYBACK_HEATMAP = 40; // cap for heatmap scale
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
  // heatmap over annual_km (x) and home_share (y)
  const x = [];
  for (let km = 10000; km <= 20000; km += 1000) x.push(km);

  const y = [];
  for (let h = 0; h <= 100; h += HEATMAP_GRID_STEP) y.push(h);

  const z = y.map(home => {
    return x.map(km => {
      const st2 = { ...st, home_share: home, annual_km: km };
      const res = compute(pair, st2);
      if (res.annual_savings <= 0) return null; // show gaps
      return Math.min(res.payback, MAX_PAYBACK_HEATMAP);
    });
  });

  const trace = {
    type: "heatmap",
    x, y, z,
    hovertemplate: "Home charging: %{y}%<br>Annual km: %{x:,}<br>Payback: %{z:.1f} yrs<extra></extra>",
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
    yaxis: { title: "Payback (years)", range: [0, MAX_PAYBACK_HEATMA]()
