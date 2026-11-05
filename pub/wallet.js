const DATA_API = "https://data-api.polymarket.com/v2";
const GAMMA = "https://gamma-api.polymarket.com";
const PROXY = "/api/proxy?url=";
const CATS = ["mentions","finance","politics","tech","weather","economics","culture","crypto","sports"];
const SERIES = [
  ["economic_pnl","Total","#4ade80"],
  ["trade_pnl","Trade","#60a5fa"],
  ["realized_lp_pnl","LP","#a78bfa"],
  ["yield_income","Yield","#fbbf24"],
  ["maker_rebate","Maker","#34d399"],
  ["fees","Fees","#f87171"],
  ["taker_rebate","Taker","#fb923c"],
  ["realized_combo_pnl","Combos","#e879f9"],
];

const S = {
  addr: null, profile: null, points: [], value: 0,
  open: [], closedWins: [], closedLoss: [], trades: [],
  lb: {}, vol: 0, lbPeriod: "ALL",
  chartMetric: "economic_pnl", chartRange: "ALL",
  seriesOn: Object.fromEntries(SERIES.map(([k]) => [k, k === "economic_pnl"])),
  calMonth: null, tab: "overview",
};

const fm = (x) => {
  if (x == null || Number.isNaN(+x)) return "—";
  const n = +x, a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a/1e6).toFixed(2) + "M";
  if (a >= 1e4) return s + "$" + (a/1e3).toFixed(1) + "K";
  if (a >= 1e3) return s + "$" + (a/1e3).toFixed(2) + "K";
  return s + "$" + a.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
};
const fmDelta = (x) => {
  const n = +x || 0;
  const core = fm(Math.abs(n)).replace(/^\$/, "");
  return (n >= 0 ? "+$" : "-$") + core;
};
const pct = (n) => {
  if (n == null || !isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + Math.abs(n).toFixed(2) + "%";
};
const cl = (v) => (+v || 0) >= 0 ? "pos" : "neg";
const shortAddr = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const ago = (ts) => {
  const s = Math.max(0, Date.now()/1000 - ts);
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s/60) + "m";
  if (s < 86400) return Math.floor(s/3600) + "h";
  return Math.floor(s/86400) + "d";
};
const rankFmt = (r) => {
  if (r == null) return "—";
  if (r >= 10000) return "#" + (r/1000).toFixed(0) + "K";
  if (r >= 1000) return "#" + (r/1000).toFixed(1) + "K";
  return "#" + r;
};

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status + " " + url);
    return await r.json();
  } catch (e) {
    const r = await fetch(PROXY + encodeURIComponent(url));
    if (!r.ok) throw new Error("proxy " + r.status + " for " + url);
    return await r.json();
  }
}

function parseTarget() {
  const u = new URL(location.href);
  let t = u.searchParams.get("w") || u.searchParams.get("address") || "";
  const m = location.pathname.match(/\/w\/([^\/?#]+)/);
  if (m) t = decodeURIComponent(m[1]);
  if (!t && location.hash) t = location.hash.replace(/^#/, "");
  return (t || "").trim();
}

function isAddress(s) {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

async function resolveWallet(input) {
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?polymarket\.com\/(profile|@)\//i, "");
  s = s.replace(/^@/, "").split(/[?#]/)[0].trim();
  if (isAddress(s)) return s.toLowerCase();
  // username lookup
  const j = await fetchJSON(GAMMA + "/public-search?q=" + encodeURIComponent(s) + "&search_profiles=true");
  const profiles = j.profiles || [];
  const exact = profiles.find(p => (p.name || "").toLowerCase() === s.toLowerCase());
  const hit = exact || profiles[0];
  if (hit && hit.proxyWallet) return hit.proxyWallet.toLowerCase();
  // try public-profile by address fail; also try as if it's a partial address
  throw new Error("Could not find wallet for “" + s + "”");
}

async function fetchPositions(user, status, sort, dir, maxPages = 5) {
  let out = [], cursor = null, truncated = false;
  for (let i = 0; i < maxPages; i++) {
    let url = DATA_API + "/positions?user=" + user + "&limit=100&status=" + status + "&sort_by=" + sort;
    if (dir) url += "&sort_direction=" + dir;
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
    const j = await fetchJSON(url);
    out = out.concat(j.data || []);
    cursor = (j.pagination || {}).next_cursor;
    if (!cursor || !(j.pagination || {}).has_more) { truncated = false; break; }
    if (i === maxPages - 1) truncated = true;
  }
  out._truncated = truncated;
  return out;
}

async function fetchLeaderboard(user, period, category) {
  let url = DATA_API + "/leaderboard?timePeriod=" + period + "&orderBy=PNL&limit=1&user=" + user;
  if (category) url += "&category=" + category;
  const j = await fetchJSON(url);
  return j.data || null;
}

function atPnl(points, ts) {
  if (!points.length) return 0;
  let v = points[0].economic_pnl || 0;
  for (const p of points) {
    if (p.timestamp <= ts) v = p.economic_pnl || 0;
    else break;
  }
  return v;
}

function periodPnls(points) {
  if (!points.length) return { p: 0, d1: 0, d7: 0, d30: 0, d90: 0 };
  const last = points[points.length - 1];
  const P = last.economic_pnl || 0;
  const now = last.timestamp;
  // prefer previous daily point for 1D when fidelity is 1d
  let d1 = points.length > 1 ? P - (points[points.length - 2].economic_pnl || 0) : 0;
  const d7 = P - atPnl(points, now - 7 * 86400);
  const d30 = P - atPnl(points, now - 30 * 86400);
  const d90 = P - atPnl(points, now - 90 * 86400);
  return { p: P, d1, d7, d30, d90 };
}

function periodPct(delta, current) {
  const base = current - delta;
  if (!base) return null;
  return (delta / Math.abs(base)) * 100;
}

function dailyMap(points) {
  const map = {};
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].economic_pnl || 0;
    const cur = points[i].economic_pnl || 0;
    const d = new Date(points[i].timestamp * 1000);
    const key = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
    map[key] = (map[key] || 0) + (cur - prev);
  }
  return map;
}

async function loadAll(addr) {
  S.addr = addr;
  const status = document.getElementById("status");
  if (status) status.textContent = "Fetching Polymarket data…";

  const [profile, pnl, value, open, wins, losses, trades, lbAll] = await Promise.all([
    fetchJSON(GAMMA + "/public-profile?address=" + addr).catch(() => ({})),
    fetchJSON(DATA_API + "/user-pnl?user=" + addr + "&interval=all&fidelity=1d"),
    fetchJSON(DATA_API + "/value?user=" + addr),
    fetchPositions(addr, "OPEN", "CURRENT_VALUE", "DESC", 12),
    fetchPositions(addr, "CLOSED", "TOTAL_PNL", "DESC", 1),
    fetchPositions(addr, "CLOSED", "TOTAL_PNL", "ASC", 1),
    fetchJSON(DATA_API + "/trades?user=" + addr + "&limit=40").catch(() => ({ data: [] })),
    fetchLeaderboard(addr, "ALL", null),
  ]);

  S.profile = profile || {};
  S.points = ((pnl || {}).data || {}).points || [];
  S.value = ((value || {}).data || {}).value || 0;
  S.open = open || []; S.openTrunc = !!(open && open._truncated);
  S.closedWins = (wins || []).slice(0, 15);
  S.closedLoss = (losses || []).slice(0, 15);
  S.trades = (trades.data || []).slice(0, 40);
  S.vol = lbAll ? (lbAll.volume || 0) : ((S.points.at(-1) || {}).volume_usdc || 0);
  S.lb = { overall: lbAll };
  if (S.points.length) {
    const last = S.points[S.points.length - 1];
    const d = new Date(last.timestamp * 1000);
    S.calMonth = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  } else {
    const n = new Date();
    S.calMonth = { y: n.getUTCFullYear(), m: n.getUTCMonth() };
  }

  // category ranks in background-ish (await for first paint completeness)
  const cats = await Promise.all(CATS.map(c => fetchLeaderboard(addr, S.lbPeriod, c).then(d => [c, d])));
  for (const [c, d] of cats) S.lb[c] = d;
}

async function reloadRanks() {
  const addr = S.addr;
  S.lb.overall = await fetchLeaderboard(addr, S.lbPeriod, null);
  const cats = await Promise.all(CATS.map(c => fetchLeaderboard(addr, S.lbPeriod, c).then(d => [c, d])));
  for (const [c, d] of cats) S.lb[c] = d;
  if (S.lb.overall && S.lb.overall.volume != null) S.vol = S.lb.overall.volume;
  renderRanksOnly();
}

function filterPoints() {
  const pts = S.points;
  if (!pts.length) return [];
  const last = pts[pts.length - 1].timestamp;
  let cut = 0;
  if (S.chartRange === "1D") cut = last - 1.5 * 86400;
  else if (S.chartRange === "1W") cut = last - 7 * 86400;
  else if (S.chartRange === "1M") cut = last - 30 * 86400;
  return cut ? pts.filter(p => p.timestamp >= cut) : pts.slice();
}

function drawChart() {
  const canvas = document.getElementById("pnlChart");
  if (!canvas) return;
  const tip = document.getElementById("chartTip");
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pts = filterPoints();
  const active = SERIES.filter(([k]) => S.seriesOn[k]);
  if (pts.length < 2 || !active.length) {
    ctx.fillStyle = "#666"; ctx.font = "13px Inter,sans-serif";
    ctx.fillText("No chart data", 16, 24);
    return;
  }

  let ymin = Infinity, ymax = -Infinity;
  for (const [k] of active) for (const p of pts) {
    const v = p[k] || 0; ymin = Math.min(ymin, v); ymax = Math.max(ymax, v);
  }
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  // include zero for coloring reference
  const pad = (ymax - ymin) * 0.08;
  ymin -= pad; ymax += pad;
  const L = 44, R = 12, T = 12, B = 28;
  const xAt = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const yAt = (v) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);

  // grid
  ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = T + (i / 4) * (H - T - B);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    const val = ymax - (i / 4) * (ymax - ymin);
    ctx.fillStyle = "#555"; ctx.font = "10px ui-monospace,monospace";
    ctx.fillText(fm(val), 4, y + 3);
  }
  // zero line
  if (ymin < 0 && ymax > 0) {
    const y0 = yAt(0);
    ctx.strokeStyle = "#333"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(L, y0); ctx.lineTo(W - R, y0); ctx.stroke();
    ctx.setLineDash([]);
  }

  function strokeSeries(key, color, width) {
    ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round";
    // color by sign for Total primary
    if (key === "economic_pnl" && active.length === 1) {
      // split green/red at zero crossings
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1][key] || 0, b = pts[i][key] || 0;
        ctx.strokeStyle = b >= 0 ? "#4ade80" : "#f87171";
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), yAt(a));
        ctx.lineTo(xAt(i), yAt(b));
        ctx.stroke();
      }
      return;
    }
    ctx.strokeStyle = color;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xAt(i), y = yAt(p[key] || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  for (const [k, , color] of active) {
    strokeSeries(k, color, k === "economic_pnl" ? 2 : 1.4);
  }

  // x labels
  ctx.fillStyle = "#555"; ctx.font = "10px ui-monospace,monospace";
  const labelAt = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  for (const i of labelAt) {
    const d = new Date(pts[i].timestamp * 1000);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: S.chartRange === "ALL" ? "2-digit" : undefined, timeZone: "UTC" });
    ctx.fillText(label, xAt(i) - 18, H - 8);
  }

  canvas.onmousemove = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const i = Math.round(((x - L) / (W - L - R)) * (pts.length - 1));
    if (i < 0 || i >= pts.length) { tip.style.display = "none"; return; }
    const p = pts[i];
    const d = new Date(p.timestamp * 1000);
    const lines = active.map(([k, name]) => name + ": " + fmDelta(p[k] || 0));
    tip.style.display = "block";
    tip.innerHTML = "<b>" + d.toISOString().slice(0, 10) + "</b><br>" + lines.join("<br>");
    tip.style.left = Math.min(rect.width - 140, Math.max(0, x + 10)) + "px";
    tip.style.top = "10px";
  };
  canvas.onmouseleave = () => { tip.style.display = "none"; };
}

function renderCalendar() {
  const el = document.getElementById("calBody");
  if (!el || !S.calMonth) return;
  const { y, m } = S.calMonth;
  const map = dailyMap(S.points);
  const monthKeys = Object.keys(map).filter(k => k.startsWith(y + "-" + String(m + 1).padStart(2, "0")));
  const monthTotal = monthKeys.reduce((s, k) => s + map[k], 0);
  const title = document.getElementById("calTitle");
  if (title) title.innerHTML = new Date(Date.UTC(y, m, 1)).toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) +
    ' <span class="' + cl(monthTotal) + '">' + fmDelta(monthTotal) + "</span>";

  const first = new Date(Date.UTC(y, m, 1));
  const startDow = first.getUTCDay(); // 0 Sun
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let html = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => '<div class="dow">' + d + "</div>").join("");
  for (let i = 0; i < startDow; i++) html += '<div class="day empty"></div>';
  const vals = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const key = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    const v = map[key];
    let bg = "#111", fg = "#666";
    if (v != null) {
      vals.push(v);
      const a = Math.min(1, Math.abs(v) / Math.max(20, ...monthKeys.map(k => Math.abs(map[k] || 0)) || [20]));
      if (v >= 0) { bg = "rgba(74,222,128," + (0.15 + a * 0.55) + ")"; fg = "#4ade80"; }
      else { bg = "rgba(248,113,113," + (0.15 + a * 0.55) + ")"; fg = "#f87171"; }
    }
    html += '<div class="day" style="background:' + bg + '"><span class="d">' + day + '</span>' +
      (v != null ? '<span class="v" style="color:' + fg + '">' + fmDelta(v) + "</span>" : "") + "</div>";
  }
  el.innerHTML = html;

  const wins = vals.filter(v => v > 0).length;
  const losses = vals.filter(v => v < 0).length;
  const best = vals.length ? Math.max(...vals) : 0;
  const worst = vals.length ? Math.min(...vals) : 0;
  // streak of wins ending at last traded day
  let streak = 0;
  const sortedKeys = monthKeys.sort();
  for (let i = sortedKeys.length - 1; i >= 0; i--) {
    if (map[sortedKeys[i]] > 0) streak++;
    else break;
  }
  const meta = document.getElementById("calMeta");
  if (meta) {
    const wr = (wins + losses) ? Math.round(wins / (wins + losses) * 100) : 0;
    meta.innerHTML = "<span><b class='pos'>" + wr + "%</b> win days (" + wins + "W " + losses + "L)</span>" +
      "<span>Best <b class='pos'>" + fmDelta(best) + "</b></span>" +
      "<span>Worst <b class='neg'>" + fmDelta(worst) + "</b></span>" +
      "<span>Streak <b>" + streak + "D</b></span>";
  }
}

function posItem(p) {
  const side = (p.outcome || "").toLowerCase() === "yes" ? "yes" : ((p.outcome || "").toLowerCase() === "no" ? "no" : "");
  const sideHtml = side ? '<span class="side ' + side + '">' + (p.outcome || "") + "</span>" : '<span class="side">' + (p.outcome || "") + "</span>";
  const href = p.event_slug ? "https://polymarket.com/event/" + p.event_slug : (p.slug ? "https://polymarket.com/event/" + p.slug : "#");
  return '<a class="item" href="' + href + '" target="_blank" rel="noopener">' +
    (p.icon ? '<img src="' + p.icon + '" alt="" loading="lazy">' : '<div class="av" style="width:32px;height:32px;border-radius:6px"></div>') +
    '<div class="t">' + sideHtml + escapeHtml(p.title || "") +
    '<div class="m">' + (p.current_size != null ? Number(p.current_size).toFixed(1) + " shares · " : "") +
    "val " + fm(p.current_value) + "</div></div>" +
    '<div class="r"><div class="' + cl(p.total_pnl) + '">' + fmDelta(p.total_pnl) + "</div>" +
    '<div class="m muted">' + (p.percent_pnl != null ? pct(p.percent_pnl) : "") + "</div></div></a>";
}

function tradeItem(t) {
  const side = (t.side || "").toUpperCase();
  const href = t.event_slug ? "https://polymarket.com/event/" + t.event_slug : "#";
  return '<a class="item" href="' + href + '" target="_blank" rel="noopener">' +
    (t.icon ? '<img src="' + t.icon + '" alt="" loading="lazy">' : '<div class="av" style="width:32px;height:32px;border-radius:6px"></div>') +
    '<div class="t"><span class="tag ' + (side === "BUY" ? "buy" : "sell") + '">' + side + "</span>" +
    escapeHtml(t.outcome || "") + " · " + escapeHtml((t.title || "").slice(0, 60)) +
    '<div class="m">' + Number(t.size || 0).toFixed(1) + " @ " + ((t.price || 0) * 100).toFixed(1) + "¢ · " + fm(t.size * t.price) + "</div></div>" +
    '<div class="r muted">' + ago(t.timestamp) + "</div></a>";
}

function perfItem(p) {
  const href = p.event_slug ? "https://polymarket.com/event/" + p.event_slug : "#";
  return '<a class="item" href="' + href + '" target="_blank" rel="noopener">' +
    (p.icon ? '<img src="' + p.icon + '" alt="" loading="lazy">' : "") +
    '<div class="t">' + escapeHtml((p.title || "").slice(0, 50)) +
    '<div class="m">' + escapeHtml(p.outcome || "") + "</div></div>" +
    '<div class="r ' + cl(p.total_pnl) + '">' + fmDelta(p.total_pnl) + "</div></a>";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

function renderRanksOnly() {
  const host = document.getElementById("ranksCard");
  if (!host) return;
  host.innerHTML = ranksHTML();
  bindRankControls();
}

function ranksHTML() {
  const overall = S.lb.overall || {};
  const vals = CATS.map(c => (S.lb[c] && S.lb[c].pnl) || 0);
  const maxAbs = Math.max(1, ...vals.map(Math.abs));
  const bars = CATS.map((c, i) => {
    const d = S.lb[c];
    const pnl = d ? d.pnl : 0;
    const h = Math.max(4, Math.round(Math.abs(pnl) / maxAbs * 110));
    const color = pnl >= 0 ? "#4ade80" : "#f87171";
    return '<div class="rbar" title="' + c + '">' +
      '<div class="pnl ' + cl(pnl) + '">' + fmDelta(pnl) + "</div>" +
      '<div class="bar" style="height:' + h + "px;background:" + color + '"></div>' +
      '<div class="cat">' + c + "<br><span class='muted'>" + rankFmt(d && d.rank_pnl) + "</span></div></div>";
  }).join("");
  return '<div class="row"><h3 style="margin:0">LEADERBOARD RANKINGS</h3>' +
    '<div class="seg" id="lbPeriod">' +
    [["DAY","1D"],["WEEK","1W"],["MONTH","1M"],["ALL","All"]].map(([v,l]) =>
      '<button data-v="' + v + '" class="' + (S.lbPeriod === v ? "on" : "") + '">' + l + "</button>").join("") +
    "</div></div>" +
    '<div class="ranks"><div class="rank-overall"><div class="muted" style="font-size:10px;letter-spacing:1px">OVERALL</div>' +
    '<div class="rk">' + rankFmt(overall.rank_pnl) + "</div>" +
    '<div class="' + cl(overall.pnl) + '" style="font-weight:600;margin-top:4px">' + fmDelta(overall.pnl || 0) + "</div></div>" +
    '<div class="rank-bars">' + bars + "</div></div>";
}

function bindRankControls() {
  const el = document.getElementById("lbPeriod");
  if (!el) return;
  el.onclick = async (e) => {
    const v = e.target.dataset.v; if (!v) return;
    S.lbPeriod = v;
    el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
    el.insertAdjacentHTML("afterend", "");
    await reloadRanks();
  };
}

function render() {
  const app = document.getElementById("app");
  const name = S.profile.name || S.profile.pseudonym || shortAddr(S.addr);
  const img = S.profile.profileImage || "";
  const pp = periodPnls(S.points);
  const last = S.points[S.points.length - 1] || {};
  const tradePnl = last.trade_pnl || 0;
  const lp = last.realized_lp_pnl || 0;
  const yieldInc = last.yield_income || 0;
  const rebates = (last.maker_rebate || 0) + (last.taker_rebate || 0);
  const referral = last.referral_income || 0;
  const fees = last.fees != null ? last.fees : (last.fees_paid || 0);
  const unreal = last.unrealized_pnl || 0;
  const assets = S.value; // USDC cash not publicly available; show positions value as portfolio/assets

  document.title = name + " — pmscan";

  const periods = [
    ["1D", pp.d1, periodPct(pp.d1, pp.p)],
    ["7D", pp.d7, periodPct(pp.d7, pp.p)],
    ["30D", pp.d30, periodPct(pp.d30, pp.p)],
    ["90D", pp.d90, periodPct(pp.d90, pp.p)],
  ];

  app.innerHTML = `
  <div class="hd">
    <div class="who">
      ${img ? '<img class="av" src="' + img + '" alt="">' : '<div class="av"></div>'}
      <div>
        <div class="nm">${escapeHtml(name)}
          <a class="ic" href="https://polymarket.com/profile/${S.addr}" target="_blank" rel="noopener" title="Polymarket">↗</a>
          <a class="ic" href="https://polygonscan.com/address/${S.addr}" target="_blank" rel="noopener" title="Polygonscan">◫</a>
        </div>
        <div class="addr mono">${S.addr}
          <button class="btn" style="margin-left:6px;padding:2px 8px;font-size:10px" onclick="navigator.clipboard.writeText('${S.addr}');this.textContent='copied'">copy</button>
        </div>
      </div>
    </div>
    <div class="topstats">
      <div><span class="k">PROFIT</span><span class="v ${cl(pp.p)}">${fmDelta(pp.p)}</span>
        <div class="sub">
          <span>1D <b class="${cl(pp.d1)}">${fmDelta(pp.d1)}</b></span>
          <span>7D <b class="${cl(pp.d7)}">${fmDelta(pp.d7)}</b></span>
          <span>30D <b class="${cl(pp.d30)}">${fmDelta(pp.d30)}</b></span>
          <span>90D <b class="${cl(pp.d90)}">${fmDelta(pp.d90)}</b></span>
        </div>
      </div>
      <div><span class="k">PORTFOLIO</span><span class="v">${fm(S.value)}</span></div>
      <div><span class="k">POSITIONS</span><span class="v">${S.open.length}${S.openTrunc?"+":""}</span></div>
      <div><span class="k">VOLUME</span><span class="v">${fm(S.vol)}</span></div>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <div class="seg" id="chartMetric">
        <button data-v="economic_pnl" class="${S.chartMetric==="economic_pnl"?"on":""}">PnL</button>
        <button data-v="trade_pnl" class="${S.chartMetric==="trade_pnl"?"on":""}">Trade</button>
      </div>
      <div class="seg" id="chartRange">
        ${[["1D","1D"],["1W","1W"],["1M","1M"],["ALL","All"]].map(([v,l])=>'<button data-v="'+v+'" class="'+(S.chartRange===v?"on":"")+'">'+l+"</button>").join("")}
      </div>
      <button class="btn" id="resetView">Reset view</button>
    </div>
    <div class="chart-wrap"><canvas id="pnlChart"></canvas><div class="tip" id="chartTip"></div></div>
    <div class="legend" id="legend">
      ${SERIES.map(([k,n,c])=>'<label><input type="checkbox" data-k="'+k+'" '+(S.seriesOn[k]?"checked":"")+'><span style="color:'+c+'">●</span> '+n+"</label>").join("")}
    </div>
  </div>

  <div class="pboxes">
    ${periods.map(([l,v,p])=>'<div class="pbox"><div class="l">'+l+'</div><div class="a '+cl(v)+'">'+fmDelta(v)+'</div><div class="p '+cl(p)+'">'+pct(p)+"</div></div>").join("")}
  </div>

  <div class="card">
    <div class="cal-hd">
      <div class="cal-nav">
        <button id="calPrev">‹</button>
        <div class="title" id="calTitle"></div>
        <button id="calNext">›</button>
      </div>
      <div class="muted" style="font-size:11px">Daily PnL heatmap (UTC)</div>
    </div>
    <div class="cal-grid" id="calBody"></div>
    <div class="cal-meta" id="calMeta"></div>
  </div>

  <div class="card overall">
    <div class="muted" style="font-size:11px;letter-spacing:1px;margin-bottom:6px">OVERALL PNL</div>
    <div class="big ${cl(pp.p)}">${fmDelta(pp.p)}</div>
    <div class="breakdown">
      <span>Trading <b class="${cl(tradePnl)}">${fmDelta(tradePnl)}</b></span>
      <span>Unrealized <b class="${cl(unreal)}">${fmDelta(unreal)}</b></span>
      <span>LP <b class="${cl(lp)}">${fmDelta(lp)}</b></span>
      <span>Yield <b class="${cl(yieldInc)}">${fmDelta(yieldInc)}</b></span>
      <span>Rebates <b class="${cl(rebates)}">${fmDelta(rebates)}</b></span>
      <span>Referral <b>${fmDelta(referral)}</b></span>
      <span>Fees <b class="${cl(fees)}">${fmDelta(fees)}</b></span>
    </div>
    <div class="ov-bottom">
      <div><span class="k">PORTFOLIO VALUE</span><div class="v">${fm(S.value)}</div></div>
      <div><span class="k">TOTAL VOLUME</span><div class="v">${fm(S.vol)}</div></div>
      <div><span class="k">TRADES</span><div class="v">${(last.trade_count||0).toLocaleString()}</div></div>
      <div><span class="k">OPEN POSITIONS</span><div class="v">${S.open.length}${S.openTrunc?"+":""}</div></div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:10px">USDC cash balance is not available from public Polymarket APIs, so it is omitted rather than estimated.</div>
  </div>

  <div class="tabs" id="tabs">
    <button data-t="overview" class="${S.tab==="overview"?"on":""}">Overview</button>
    <button data-t="positions" class="${S.tab==="positions"?"on":""}">Positions (${S.open.length}${S.openTrunc?"+":""})</button>
    <button data-t="activity" class="${S.tab==="activity"?"on":""}">Activity</button>
  </div>
  <div id="tabBody"></div>

  <div class="card" id="ranksCard">${ranksHTML()}</div>
  `;

  renderTab();
  renderCalendar();
  bindRankControls();
  drawChart();

  document.getElementById("chartMetric").onclick = (e) => {
    const v = e.target.dataset.v; if (!v) return;
    S.chartMetric = v;
    // focus that series
    Object.keys(S.seriesOn).forEach(k => S.seriesOn[k] = false);
    S.seriesOn[v] = true;
    render();
  };
  document.getElementById("chartRange").onclick = (e) => {
    const v = e.target.dataset.v; if (!v) return;
    S.chartRange = v; drawChart();
    e.currentTarget.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  };
  document.getElementById("resetView").onclick = () => {
    S.chartRange = "ALL";
    Object.keys(S.seriesOn).forEach(k => S.seriesOn[k] = k === "economic_pnl");
    S.chartMetric = "economic_pnl";
    render();
  };
  document.getElementById("legend").onchange = (e) => {
    const k = e.target.dataset.k; if (!k) return;
    S.seriesOn[k] = e.target.checked;
    drawChart();
  };
  document.getElementById("calPrev").onclick = () => {
    let { y, m } = S.calMonth; m--; if (m < 0) { m = 11; y--; }
    S.calMonth = { y, m }; renderCalendar();
  };
  document.getElementById("calNext").onclick = () => {
    let { y, m } = S.calMonth; m++; if (m > 11) { m = 0; y++; }
    S.calMonth = { y, m }; renderCalendar();
  };
  document.getElementById("tabs").onclick = (e) => {
    const t = e.target.dataset.t; if (!t) return;
    S.tab = t;
    e.currentTarget.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
    renderTab();
  };
  window.addEventListener("resize", drawChart);
}

function renderTab() {
  const el = document.getElementById("tabBody");
  if (!el) return;
  if (S.tab === "positions") {
    el.innerHTML = "<div class=\"card\"><h3>CURRENT POSITIONS (" + S.open.length + ")</h3><div class=\"list\">" +
      (S.open.map(posItem).join("") || "<div class=\"muted\">No open positions.</div>") + "</div></div>";
    return;
  }
  if (S.tab === "activity") {
    el.innerHTML = "<div class=\"card\"><h3>RECENT TRADES</h3><div class=\"list\">" +
      (S.trades.map(tradeItem).join("") || "<div class=\"muted\">No recent trades.</div>") + "</div></div>";
    return;
  }
  const wins = S.closedWins.filter(p => p.total_pnl > 0).slice(0, 8);
  const losses = S.closedLoss.filter(p => p.total_pnl < 0).slice(0, 8);
  el.innerHTML = "<div class=\"cols\">" +
    "<div class=\"card\" style=\"margin:0\"><h3>CURRENT POSITIONS</h3><div class=\"list\">" +
      (S.open.slice(0, 25).map(posItem).join("") || "<div class=\"muted\">No open positions.</div>") + "</div></div>" +
    "<div class=\"card\" style=\"margin:0\"><h3>RECENT TRADES</h3><div class=\"list\">" +
      (S.trades.slice(0, 25).map(tradeItem).join("") || "<div class=\"muted\">No recent trades.</div>") + "</div></div>" +
    "<div class=\"card\" style=\"margin:0\"><h3>MARKET PERFORMANCE</h3>" +
      "<div class=\"muted\" style=\"font-size:11px;margin-bottom:6px\">Biggest wins</div><div class=\"list\" style=\"max-height:180px\">" +
      (wins.map(perfItem).join("") || "<div class=\"muted\">No market history.</div>") + "</div>" +
      "<div class=\"muted\" style=\"font-size:11px;margin:10px 0 6px\">Biggest losses</div><div class=\"list\" style=\"max-height:180px\">" +
      (losses.map(perfItem).join("") || "<div class=\"muted\">No market history.</div>") + "</div></div></div>";
}

async function main() {
  const app = document.getElementById("app");
  try {
    const raw = parseTarget();
    if (!raw) {
      app.innerHTML = '<div class="err">No wallet specified. Go back to the <a href="/">scanner</a> and search for a username or address.</div>';
      return;
    }
    app.innerHTML = '<div class="loading">Resolving ' + escapeHtml(raw) + "&hellip;</div>";
    const addr = await resolveWallet(raw);
    // normalize URL to /w/<address> without reload if needed
    if (!location.pathname.includes(addr) && history.replaceState) {
      history.replaceState(null, "", "/wallet?w=" + addr);
    }
    await loadAll(addr);
    if (!S.points.length) {
      app.innerHTML = '<div class="err">No PnL history found for <span class="mono">' + addr + "</span>.</div>";
      return;
    }
    render();
  } catch (e) {
    console.error(e);
    app.innerHTML = '<div class="err">' + escapeHtml(e.message || String(e)) + '<br><br><a href="/">Back to scanner</a></div>';
  }
}

main();
