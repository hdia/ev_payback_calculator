from pyscript import document
from pyodide.http import pyfetch
from pyodide.ffi import create_proxy
import js, urllib.parse

DEFAULTS = {
    "pair_id": "atto3_vs_corolla_cross_hybrid",
    "annual_km": 15000,
    "home_share": 80,
    "home_price": 30,   # c/kWh
    "public_price": 55, # c/kWh
    "petrol": 1.85,     # $/L
    "losses": 10,       # %
    "maint": 150,
    "rw": False,
}

MAX_PAYBACK_DISPLAY = 15

def money(x):
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.0f}"

def money2(x):
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):,.2f}"

def fmt_years(y):
    if y is None:
        return "N/A"
    if y > MAX_PAYBACK_DISPLAY:
        return f">{MAX_PAYBACK_DISPLAY}"
    if y < 10:
        s = f"{y:.1f}".rstrip("0").rstrip(".")
        return s
    return f"{round(y):.0f}"

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

async def load_pairs():
    resp = await pyfetch("pairs.json")
    data = await resp.json()
    pairs = data.to_py()
    by_id = {p["id"]: p for p in pairs}
    return pairs, by_id

def parse_query():
    q = js.URLSearchParams.new(js.window.location.search)
    def get(name):
        v = q.get(name)
        return None if v is None else str(v)

    st = dict(DEFAULTS)
    if get("pair"): st["pair_id"] = get("pair")
    if get("km"):
        try: st["annual_km"] = int(float(get("km")))
        except: pass
    if get("home"):
        try: st["home_share"] = int(float(get("home")))
        except: pass
    if get("eh"):
        try: st["home_price"] = float(get("eh"))
        except: pass
    if get("ep"):
        try: st["public_price"] = float(get("ep"))
        except: pass
    if get("petrol"):
        try: st["petrol"] = float(get("petrol"))
        except: pass
    if get("loss"):
        try: st["losses"] = float(get("loss"))
        except: pass
    if get("maint"):
        try: st["maint"] = float(get("maint"))
        except: pass
    if get("rw"):
        st["rw"] = get("rw") in ("1","true","True","yes","on")
    return st

def make_share_url(state):
    params = {
        "pair": state["pair_id"],
        "km": int(state["annual_km"]),
        "home": int(state["home_share"]),
        "eh": float(state["home_price"]),
        "ep": float(state["public_price"]),
        "petrol": float(state["petrol"]),
        "loss": float(state["losses"]),
        "maint": float(state["maint"]),
        "rw": "1" if state["rw"] else "0"
    }
    qs = urllib.parse.urlencode(params)
    return f"{js.window.location.origin}{js.window.location.pathname}?{qs}"

def compute(pair, state):
    ev_kwh = float(pair["ev_kwh_per_100km"])
    ice_l = float(pair["ice_l_per_100km"])
    if state["rw"]:
        ev_kwh *= 1.10
        ice_l *= 1.15

    losses = float(state["losses"]) / 100.0
    grid_kwh = ev_kwh * (1.0 + losses)

    home_share = clamp(float(state["home_share"]), 0, 100) / 100.0
    public_share = 1.0 - home_share

    home_price = float(state["home_price"]) / 100.0
    public_price = float(state["public_price"]) / 100.0

    weighted_elec = home_share * home_price + public_share * public_price

    ev_cost_100 = grid_kwh * weighted_elec
    ice_cost_100 = ice_l * float(state["petrol"])
    savings_100 = ice_cost_100 - ev_cost_100

    annual_km = float(state["annual_km"])
    maint = float(state["maint"])
    annual_savings = savings_100 * (annual_km / 100.0) + maint

    upfront = float(pair["upfront_premium_aud"])
    payback = None
    if annual_savings > 0:
        payback = upfront / annual_savings

    return {
        "ev_cost_100": ev_cost_100,
        "ice_cost_100": ice_cost_100,
        "savings_100": savings_100,
        "annual_savings": annual_savings,
        "upfront": upfront,
        "payback": payback,
        "grid_kwh_100": grid_kwh,
        "weighted_elec": weighted_elec
    }

def set_text(el_id, txt):
    document.getElementById(el_id).innerText = txt

def set_html(el_id, html):
    document.getElementById(el_id).innerHTML = html

def plot_payback_curve(pair, state):
    xs = list(range(0, 101, 5))
    ys = []
    for h in xs:
        st2 = dict(state)
        st2["home_share"] = h
        res = compute(pair, st2)
        if res["annual_savings"] <= 0:
            ys.append(None)
        else:
            ys.append(min(res["payback"], 40))

    trace = js.Object.fromEntries([
        ("x", xs),
        ("y", ys),
        ("mode", "lines+markers"),
        ("name", "Payback"),
        ("hovertemplate", "Home charging: %{x}%<br>Payback: %{y:.1f} yrs<extra></extra>")
    ])
    layout = js.Object.fromEntries([
        ("margin", js.Object.fromEntries([("l", 50), ("r", 20), ("t", 10), ("b", 40)])),
        ("xaxis", js.Object.fromEntries([("title", "Home charging share (%)"), ("range", [0, 100])])),
        ("yaxis", js.Object.fromEntries([("title", "Payback (years)"), ("range", [0, 40])])),
        ("paper_bgcolor", "rgba(0,0,0,0)"),
        ("plot_bgcolor", "rgba(0,0,0,0)"),
        ("font", js.Object.fromEntries([("color", "#9ca3af")]))
    ])
    config = js.Object.fromEntries([("displayModeBar", False), ("responsive", True)])
    js.Plotly.react("chart-payback", [trace], layout, config)

def plot_cumulative(pair, state):
    years = list(range(0, 16))
    res = compute(pair, state)
    upfront = res["upfront"]
    annual = res["annual_savings"]

    ys = [-upfront + annual * y for y in years]

    trace = js.Object.fromEntries([
        ("x", years),
        ("y", ys),
        ("mode", "lines"),
        ("name", "Cumulative net savings"),
        ("hovertemplate", "Year %{x}: %{y:$,.0f}<extra></extra>")
    ])
    layout = js.Object.fromEntries([
        ("margin", js.Object.fromEntries([("l", 50), ("r", 20), ("t", 10), ("b", 40)])),
        ("xaxis", js.Object.fromEntries([("title", "Years"), ("dtick", 1)])),
        ("yaxis", js.Object.fromEntries([("title", "Net savings (AUD)")])),
        ("shapes", [js.Object.fromEntries([
            ("type", "line"),
            ("x0", 0), ("x1", 15),
            ("y0", 0), ("y1", 0),
            ("line", js.Object.fromEntries([("color", "rgba(156,163,175,.5)"), ("width", 1)]))
        ])]),
        ("paper_bgcolor", "rgba(0,0,0,0)"),
        ("plot_bgcolor", "rgba(0,0,0,0)"),
        ("font", js.Object.fromEntries([("color", "#9ca3af")]))
    ])
    config = js.Object.fromEntries([("displayModeBar", False), ("responsive", True)])
    js.Plotly.react("chart-cumulative", [trace], layout, config)

def build_summary(pair, state, res):
    km = int(state["annual_km"])
    home = int(state["home_share"])
    annual = res["annual_savings"]
    pay = res["payback"]
    if annual <= 0:
        line = f"With {km:,} km/year and {home}% home charging, this EV is estimated to cost more to run than the comparator under these assumptions (no payback)."
    else:
        line = f"With {km:,} km/year and {home}% home charging, this EV is estimated to save about {money(annual)} per year and pay back the upfront premium in {fmt_years(pay)} years."
    set_text("summary", line)
    return line

def update_kpis(res):
    pay = res["payback"]
    annual = res["annual_savings"]
    s100 = res["savings_100"]

    set_text("kpi-payback", fmt_years(pay))
    if annual <= 0:
        set_text("kpi-payback-sub", "No running-cost payback under these assumptions.")
    else:
        set_text("kpi-payback-sub", f"Upfront premium repaid through running-cost savings (capped at >{MAX_PAYBACK_DISPLAY} for display).")

    set_text("kpi-annual", money(annual))
    set_text("kpi-annual-sub", "Includes energy + servicing assumptions.")

    set_text("kpi-per100", money2(s100))
    set_text("kpi-per100-sub", "Difference in running cost per 100 km.")

def get_state():
    return {
        "pair_id": document.getElementById("pair").value,
        "annual_km": int(float(document.getElementById("km").value)),
        "home_share": int(float(document.getElementById("home-share").value)),
        "home_price": float(document.getElementById("home-price").value),
        "public_price": float(document.getElementById("public-price").value),
        "petrol": float(document.getElementById("petrol").value),
        "losses": float(document.getElementById("losses").value),
        "maint": float(document.getElementById("maint").value),
        "rw": bool(document.getElementById("rw-toggle").checked),
    }

async def refresh(pairs_by_id):
    st = get_state()
    pair = pairs_by_id[st["pair_id"]]
    res = compute(pair, st)
    update_kpis(res)
    build_summary(pair, st, res)
    plot_payback_curve(pair, st)
    plot_cumulative(pair, st)

async def main():
    pairs, pairs_by_id = await load_pairs()
    st = parse_query()
    if st["pair_id"] not in pairs_by_id:
        st["pair_id"] = DEFAULTS["pair_id"]

    # populate pair dropdown
    sel = document.getElementById("pair")
    sel.innerHTML = ""
    for p in pairs:
        opt = js.document.createElement("option")
        opt.value = p["id"]
        opt.text = p["label"]
        sel.appendChild(opt)
    sel.value = st["pair_id"]

    # set base inputs
    document.getElementById("km").value = str(st["annual_km"])
    document.getElementById("km-slider").value = str(st["annual_km"])
    document.getElementById("home-share").value = str(st["home_share"])
    document.getElementById("home-share-slider").value = str(st["home_share"])
    document.getElementById("home-price").value = str(st["home_price"])
    document.getElementById("public-price").value = str(st["public_price"])
    document.getElementById("petrol").value = str(st["petrol"])
    document.getElementById("losses").value = str(st["losses"])
    document.getElementById("maint").value = str(st["maint"])
    document.getElementById("rw-toggle").checked = bool(st["rw"])

    # wire slider sync
    def sync_km(evt):
        document.getElementById("km").value = document.getElementById("km-slider").value
    document.getElementById("km-slider").addEventListener("input", create_proxy(sync_km))

    def sync_home(evt):
        document.getElementById("home-share").value = document.getElementById("home-share-slider").value
    document.getElementById("home-share-slider").addEventListener("input", create_proxy(sync_home))

    # inputs trigger
    async def trigger(evt=None):
        await refresh(pairs_by_id)
    trig = create_proxy(lambda e: js.Promise.resolve(trigger(e)))

    for _id in ["pair","km","km-slider","home-share","home-share-slider","home-price","public-price","petrol","losses","maint","rw-toggle"]:
        el = document.getElementById(_id)
        el.addEventListener("input", trig)
        el.addEventListener("change", trig)

    # reset
    async def do_reset(evt=None):
        js.window.location.search = ""
    document.getElementById("btn-reset").addEventListener("click", create_proxy(lambda e: js.Promise.resolve(do_reset(e))))

    # copy summary
    def copy_summary(evt=None):
        js.navigator.clipboard.writeText(document.getElementById("summary").innerText)
    document.getElementById("btn-copy").addEventListener("click", create_proxy(copy_summary))

    # share link
    def share_link(evt=None):
        url = make_share_url(get_state())
        js.navigator.clipboard.writeText(url)
        js.window.alert("Share link copied to clipboard.")
    document.getElementById("btn-share").addEventListener("click", create_proxy(share_link))

    await refresh(pairs_by_id)

await main()
