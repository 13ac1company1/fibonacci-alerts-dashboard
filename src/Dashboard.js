import React, { useEffect, useMemo, useRef, useState } from "react";
import AssetChart from "./AssetChart";

// ---------- Config & helpers ----------
const DEFAULT_RATIOS = [-1.0, -0.618, -0.272, 0.236, 0.382, 0.5, 0.618, 0.786, 1.272, 1.618, 2.0];
const DEFAULT_COLOR = "#ffffff"; // default fib color = white

const LS_KEYS = {
  symbols: "fibdash.symbols",
  perSymFib: "fibdash.perSymFib",
  perSymMeta: "fibdash.perSymMeta", // per-symbol overlays (VWAP/EMAs)
  useHA: "fibdash.useHA",
  useHaRsi: "fibdash.useHaRsi",
  timeframe: "fibdash.timeframe",
  tts: "fibdash.ttsEnabled",
};

function makeId(symbol, ratio) {
  const enc = String(ratio).replace("-", "m").replace(".", "_");
  return `${symbol}-fib-${enc}`;
}

function initFibLines(symbol) {
  return DEFAULT_RATIOS.map((r) => ({
    id: makeId(symbol, r),
    symbol,
    ratio: r,
    price: null,            // hydrated by AssetChart or user control
    enabled: true,
    alertEnabled: false,
    rsiThreshold: 50,
    rsiOp: ">=",
    color: DEFAULT_COLOR,
  }));
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function ensureHasXRPUSD(list) {
  if (!Array.isArray(list) || list.length === 0) return ["XRPUSD"];
  const upper = list.map((s) => String(s).toUpperCase());
  if (!upper.includes("XRPUSD")) upper.unshift("XRPUSD");
  // Deduplicate while keeping order
  const seen = new Set();
  const out = [];
  for (const s of upper) {
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

function defaultMeta() {
  // Per-symbol overlay default settings
  return {
    vwap: { show: true,  color: "#ffffff", opacity: 0.5, smooth: 1 },
    ema9: { show: false, color: "#a78bfa", opacity: 0.75, smooth: 1 },   // violet-400
    ema20:{ show: false, color: "#60a5fa", opacity: 0.75, smooth: 1 },   // blue-400
    ema200:{show: false, color: "#f87171", opacity: 0.9,  smooth: 1 },   // red-400
  };
}

// ---------- Dashboard ----------
export default function Dashboard({ defaultSymbols }) {
  // Persisted symbols (fallback to XRPUSD only)
  const [symbols, setSymbols] = useState(() => {
    const saved = loadLS(LS_KEYS.symbols, null);
    if (saved && Array.isArray(saved) && saved.length) {
      return ensureHasXRPUSD(saved);
    }
    const base = Array.isArray(defaultSymbols) && defaultSymbols.length ? defaultSymbols : ["XRPUSD"];
    return ensureHasXRPUSD(base);
  });

  // Per-symbol fib configs (persisted)
  const [perSymFib, setPerSymFib] = useState(() => {
    const saved = loadLS(LS_KEYS.perSymFib, {});
    const out = { ...(saved || {}) };
    for (const s of symbols) {
      if (!out[s]) out[s] = initFibLines(s);
    }
    // Backfill fields for older data
    Object.keys(out).forEach((sym) => {
      out[sym] = out[sym].map((ln) => ({
        color: DEFAULT_COLOR,
        ...ln,
      }));
    });
    return out;
  });

  // Per-symbol overlays (persisted)
  const [perSymMeta, setPerSymMeta] = useState(() => {
    const saved = loadLS(LS_KEYS.perSymMeta, {});
    const out = { ...(saved || {}) };
    for (const s of symbols) {
      if (!out[s]) out[s] = defaultMeta();
      const m = out[s];
      // Backfill any missing keys
      out[s] = {
        vwap: { show: true, color: "#ffffff", opacity: 0.5, smooth: 1, ...(m.vwap || {}) },
        ema9: { show: false, color: "#a78bfa", opacity: 0.75, smooth: 1, ...(m.ema9 || {}) },
        ema20:{ show: false, color: "#60a5fa", opacity: 0.75, smooth: 1, ...(m.ema20 || {}) },
        ema200:{show: false, color: "#f87171", opacity: 0.9, smooth: 1, ...(m.ema200 || {}) },
      };
    }
    return out;
  });

  // Per-symbol controls visibility (not persisted)
  const [showControls, setShowControls] = useState(() => {
    const obj = {};
    for (const s of symbols) obj[s] = false;
    return obj;
  });

  // Global timeframe + toggles (persisted)
  const [timeframe, setTimeframe] = useState(() => loadLS(LS_KEYS.timeframe, "1d"));
  const [useHeikinAshi, setUseHeikinAshi] = useState(() => !!loadLS(LS_KEYS.useHA, false));
  const [useHaRsi, setUseHaRsi] = useState(() => !!loadLS(LS_KEYS.useHaRsi, false));

  // Global TTS toggle
  const [ttsEnabled, setTtsEnabled] = useState(() => !!loadLS(LS_KEYS.tts, false));

  // Alerts feed
  const [alerts, setAlerts] = useState([]);

  // Refs to chart wrappers for smooth scroll
  const chartRefs = useRef({}); // symbol -> div

  // Temp state for "Apply Color to Non-Alert Lines"
  const [bulkColor, setBulkColor] = useState({}); // symbol -> hex string

  // ---------- Persistence ----------
  useEffect(() => {
    saveLS(LS_KEYS.symbols, symbols);
    // ensure perSymFib/perSymMeta entries and prune removed symbols
    setPerSymFib((prev) => {
      const nx = { ...prev };
      for (const s of symbols) {
        if (!nx[s]) nx[s] = initFibLines(s);
      }
      Object.keys(nx).forEach((k) => {
        if (!symbols.includes(k)) delete nx[k];
      });
      return nx;
    });
    setPerSymMeta((prev) => {
      const nx = { ...prev };
      for (const s of symbols) {
        if (!nx[s]) nx[s] = defaultMeta();
        else {
          nx[s] = {
            vwap: { show: true, color: "#ffffff", opacity: 0.5, smooth: 1, ...(nx[s].vwap || {}) },
            ema9: { show: false, color: "#a78bfa", opacity: 0.75, smooth: 1, ...(nx[s].ema9 || {}) },
            ema20:{ show: false, color: "#60a5fa", opacity: 0.75, smooth: 1, ...(nx[s].ema20 || {}) },
            ema200:{show: false, color: "#f87171", opacity: 0.9, smooth: 1, ...(nx[s].ema200 || {}) },
          };
        }
      }
      Object.keys(nx).forEach((k) => {
        if (!symbols.includes(k)) delete nx[k];
      });
      return nx;
    });
  }, [symbols]);

  useEffect(() => {
    saveLS(LS_KEYS.perSymFib, perSymFib);
  }, [perSymFib]);

  useEffect(() => {
    saveLS(LS_KEYS.perSymMeta, perSymMeta);
  }, [perSymMeta]);

  useEffect(() => {
    saveLS(LS_KEYS.useHA, !!useHeikinAshi);
  }, [useHeikinAshi]);

  useEffect(() => {
    saveLS(LS_KEYS.useHaRsi, !!useHaRsi);
  }, [useHaRsi]);

  useEffect(() => {
    saveLS(LS_KEYS.timeframe, timeframe);
  }, [timeframe]);

  useEffect(() => {
    saveLS(LS_KEYS.tts, !!ttsEnabled);
  }, [ttsEnabled]);

  // ---------- Event handlers ----------
  function updateFibLines(symbol, nextLines) {
    // Ensure color field is never lost
    const normalized = nextLines.map((ln) => ({ color: DEFAULT_COLOR, ...ln }));
    setPerSymFib((prev) => ({ ...prev, [symbol]: normalized }));
  }

  function speak(text) {
    try {
      if (!ttsEnabled) return;
      const msg = new SpeechSynthesisUtterance(text);
      msg.rate = 1.0;
      msg.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(msg);
    } catch {}
  }

  function pushAlert(a) {
    setAlerts((prev) => [{ ...a }, ...prev].slice(0, 200));
    if (a?.message) speak(a.message);
  }

  function onFieldChange(symbol, id, patch) {
    setPerSymFib((prev) => {
      const next = (prev[symbol] || []).map((ln) => (ln.id === id ? { ...ln, ...patch } : ln));
      return { ...prev, [symbol]: next };
    });
  }

  // Snap only non-alert lines; also set their color back to default white
  function snapNonAlertToRange(symbol) {
    setPerSymFib((prev) => {
      const next = (prev[symbol] || []).map((ln) =>
        ln.alertEnabled ? ln : { ...ln, price: null, color: DEFAULT_COLOR }
      );
      return { ...prev, [symbol]: next };
    });
  }

  function resetToDefaultRatios(symbol) {
    setPerSymFib((prev) => {
      const defaults = initFibLines(symbol);
      const colorMap = Object.fromEntries((prev[symbol] || []).map((ln) => [ln.id, ln.color || DEFAULT_COLOR]));
      const merged = defaults.map((ln) => ({ ...ln, color: colorMap[ln.id] ?? DEFAULT_COLOR }));
      return { ...prev, [symbol]: merged };
    });
  }

  // Apply a chosen color to all non-alert lines
  function applyBulkColor(symbol) {
    const chosen = bulkColor[symbol] || DEFAULT_COLOR;
    setPerSymFib((prev) => {
      const next = (prev[symbol] || []).map((ln) =>
        ln.alertEnabled ? ln : { ...ln, color: chosen }
      );
      return { ...prev, [symbol]: next };
    });
  }

  const addInputRef = useRef(null);
  function addSymbol() {
    const raw = addInputRef.current?.value || "";
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setSymbols((prev) => {
      const next = prev.includes(sym) ? prev : [...prev, sym];
      return ensureHasXRPUSD(next);
    });
    addInputRef.current.value = "";
  }

  function scrollToSymbol(sym) {
    const node = chartRefs.current[sym];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const tfOptions = useMemo(() => ["1m", "5m", "1h", "1d"], []);

  // Auto-snap non-alert lines whenever timeframe changes
  useEffect(() => {
    setPerSymFib((prev) => {
      const out = { ...prev };
      for (const sym of symbols) {
        out[sym] = (out[sym] || []).map((ln) =>
          ln.alertEnabled ? ln : { ...ln, price: null }
        );
      }
      return out;
    });
  }, [timeframe, symbols]);

  // ---------- Render ----------
  return (
    <>
      {/* Top controls (NOT sticky). Fully responsive with wrap. */}
      <div className="border-b border-slate-800 bg-slate-900/70">
        <div className="max-w-screen-2xl mx-auto px-3 py-2 flex flex-wrap items-center gap-2">
          {/* Symbol buttons */}
          <div className="flex flex-wrap gap-2 py-1">
            {symbols.map((s) => (
              <button
                key={`nav-${s}`}
                onClick={() => scrollToSymbol(s)}
                className="px-3 py-1 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
                title={`Scroll to ${s}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Add symbol */}
          <div className="flex items-center gap-2 ml-auto">
            <input
              ref={addInputRef}
              type="text"
              placeholder="Add symbol (e.g. BTCUSD)"
              className="w-44 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") addSymbol();
              }}
            />
            <button
              onClick={addSymbol}
              className="px-3 py-1 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
            >
              Add
            </button>
          </div>

          {/* Global timeframe + toggles */}
          <div className="w-full h-px bg-slate-800 my-2" />
          <div className="flex flex-wrap items-center gap-3 pb-1 w-full">
            <div className="text-slate-200 font-semibold">Fib Alerts Dashboard</div>
            {/* <div className="text-slate-400 text-sm">US endpoints • Responsive • Persistent settings</div> */}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {tfOptions.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1 rounded-md border text-sm ${
                    timeframe === tf
                      ? "bg-sky-600 text-white border-sky-500"
                      : "bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
                  }`}
                  title={`Timeframe ${tf}`}
                >
                  {tf}
                </button>
              ))}

              <label className="ml-1 text-sm text-slate-300">HA</label>
              <input
                type="checkbox"
                className="ml-1 accent-sky-500"
                checked={useHeikinAshi}
                onChange={(e) => setUseHeikinAshi(e.target.checked)}
                title="Heikin Ashi candles"
              />

              <label className="ml-3 text-sm text-slate-300">HA for RSI</label>
              <input
                type="checkbox"
                className="ml-1 accent-sky-500"
                checked={useHaRsi}
                onChange={(e) => setUseHaRsi(e.target.checked)}
                title="Use Heikin Ashi closes for RSI"
              />

              <label className="ml-3 text-sm text-slate-300">TTS Alerts</label>
              <input
                type="checkbox"
                className="ml-1 accent-emerald-500"
                checked={ttsEnabled}
                onChange={(e) => setTtsEnabled(e.target.checked)}
                title="Speak alerts aloud"
              />
            </div>
          </div>
        </div>
      </div>

      <main className="px-4 pb-28 max-w-screen-2xl mx-auto space-y-6">
        {symbols.map((sym) => {
          const lines = perSymFib[sym] || initFibLines(sym);
          const meta  = perSymMeta[sym] || defaultMeta();
          const controlsOpen = showControls[sym] || false;

          const setMeta = (patch) =>
            setPerSymMeta((prev) => ({ ...prev, [sym]: { ...(prev[sym] || defaultMeta()), ...patch } }));

          return (
            <div
              key={sym}
              ref={(el) => (chartRefs.current[sym] = el)}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
                <div className="text-slate-200 font-medium">{sym}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setSymbols((prev) => {
                        if (sym === "XRPUSD" && prev.length === 1) return prev; // keep at least XRPUSD
                        return prev.filter((s) => s !== sym);
                      })
                    }
                    className="px-3 py-1 text-sm rounded-md border border-red-700 bg-red-900/30 hover:bg-red-900/40 text-red-200"
                    title="Remove this symbol"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setShowControls((p) => ({ ...p, [sym]: !p[sym] }))}
                    className="px-3 py-1 text-sm rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    {controlsOpen ? "Hide Controls" : "Show Controls"}
                  </button>
                </div>
              </div>

              {/* Chart */}
              <AssetChart
                symbol={sym}
                timeframe={timeframe}
                fibLines={lines}
                onFibLinesUpdate={updateFibLines}
                onAlert={(a) => pushAlert(a)}
                useHeikinAshi={useHeikinAshi}
                useHaRsi={useHaRsi}
                // VWAP
                vwapShow={meta.vwap?.show ?? true}
                vwapColor={meta.vwap?.color || "#ffffff"}
                vwapOpacity={meta.vwap?.opacity ?? 0.5}
                vwapSmooth={meta.vwap?.smooth ?? 1}
                // EMAs
                ema9Show={meta.ema9?.show ?? false}
                ema9Color={meta.ema9?.color || "#a78bfa"}
                ema9Opacity={meta.ema9?.opacity ?? 0.75}
                ema9Smooth={meta.ema9?.smooth ?? 1}
                ema20Show={meta.ema20?.show ?? false}
                ema20Color={meta.ema20?.color || "#60a5fa"}
                ema20Opacity={meta.ema20?.opacity ?? 0.75}
                ema20Smooth={meta.ema20?.smooth ?? 1}
                ema200Show={meta.ema200?.show ?? false}
                ema200Color={meta.ema200?.color || "#f87171"}
                ema200Opacity={meta.ema200?.opacity ?? 0.9}
                ema200Smooth={meta.ema200?.smooth ?? 1}
                autoCenter={true}
              />

              {/* Collapsible per-symbol controls */}
              {controlsOpen && (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-4">
                  {/* Snap/Reset + bulk color */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => snapNonAlertToRange(sym)}
                      className="px-3 py-1 text-sm rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
                      title="Snap only lines WITHOUT alerts enabled, and recolor them to white"
                    >
                      Snap non-alert lines to Hi/Lo (→ white)
                    </button>

                    <button
                      onClick={() => resetToDefaultRatios(sym)}
                      className="px-3 py-1 text-sm rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
                    >
                      Reset to Default Ratios
                    </button>

                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-slate-300 text-sm">Set color for non-alert lines:</span>
                      <input
                        type="color"
                        value={bulkColor[sym] || DEFAULT_COLOR}
                        onChange={(e) => setBulkColor((p) => ({ ...p, [sym]: e.target.value }))}
                        className="h-7 w-7 rounded border border-slate-700 bg-slate-800 p-0"
                        title="Pick a color"
                      />
                      <button
                        onClick={() => applyBulkColor(sym)}
                        className="px-3 py-1 text-sm rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
                        title="Apply this color to all non-alert lines"
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  {/* Overlays controls */}
                  <OverlayControls
                    label="VWAP"
                    cfg={meta.vwap || {}}
                    onChange={(cfg) => setMeta({ vwap: { ...(meta.vwap || {}), ...cfg } })}
                  />
                  <OverlayControls
                    label="EMA 9"
                    cfg={meta.ema9 || {}}
                    onChange={(cfg) => setMeta({ ema9: { ...(meta.ema9 || {}), ...cfg } })}
                  />
                  <OverlayControls
                    label="EMA 20"
                    cfg={meta.ema20 || {}}
                    onChange={(cfg) => setMeta({ ema20: { ...(meta.ema20 || {}), ...cfg } })}
                  />
                  <OverlayControls
                    label="EMA 200"
                    cfg={meta.ema200 || {}}
                    onChange={(cfg) => setMeta({ ema200: { ...(meta.ema200 || {}), ...cfg } })}
                  />

                  {/* Lines grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {lines.map((ln) => (
                      <div
                        key={ln.id}
                        className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2 py-2"
                      >
                        <input
                          type="checkbox"
                          className="accent-sky-500"
                          checked={!!ln.enabled}
                          onChange={(e) => onFieldChange(sym, ln.id, { enabled: e.target.checked })}
                          title="Enable/disable line"
                        />
                        <div className="w-14 text-right text-slate-300 text-sm">{ln.ratio}</div>

                        {/* Per-line color picker */}
                        <input
                          type="color"
                          value={ln.color || DEFAULT_COLOR}
                          onChange={(e) => onFieldChange(sym, ln.id, { color: e.target.value })}
                          className="h-7 w-7 rounded border border-slate-700 bg-slate-800 p-0"
                          title="Line color"
                        />

                        {/* Price input */}
                        <input
                          type="number"
                          step="0.000001"
                          value={
                            ln.price !== null && ln.price !== undefined ? ln.price : ""
                          }
                          onChange={(e) =>
                            onFieldChange(sym, ln.id, {
                              price: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm"
                          placeholder={ln.price === null ? "loading..." : ""}
                          title="Set exact price (overrides ratio)"
                        />

                        {/* Alert controls */}
                        <label className="ml-1 text-xs text-slate-400">Alert</label>
                        <input
                          type="checkbox"
                          className="accent-emerald-500"
                          checked={!!ln.alertEnabled}
                          onChange={(e) => onFieldChange(sym, ln.id, { alertEnabled: e.target.checked })}
                          title="Enable alert for this line"
                        />
                        <select
                          value={ln.rsiOp || ">="}
                          onChange={(e) => onFieldChange(sym, ln.id, { rsiOp: e.target.value })}
                          className="bg-slate-800 border border-slate-700 rounded text-slate-200 text-xs px-1 py-1"
                          title="RSI operator"
                        >
                          <option>{">="}</option>
                          <option>{"<="}</option>
                        </select>
                        <input
                          type="number"
                          step="0.1"
                          value={ln.rsiThreshold}
                          onChange={(e) => onFieldChange(sym, ln.id, { rsiThreshold: Number(e.target.value) })}
                          className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm"
                          title="RSI threshold"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Alerts feed with delivery status */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-slate-200 font-medium mb-2">Triggered Alerts</div>
          <div className="space-y-1 max-h-64 overflow-auto">
            {alerts.length === 0 && <div className="text-slate-500 text-sm">No alerts yet.</div>}
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-slate-300 text-sm">
                <span className="text-slate-400">{new Date(a.ts).toLocaleString()}</span>
                {a.delivered === true && (
                  <span className="px-2 py-[1px] rounded bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 text-xs">
                    Sent
                  </span>
                )}
                {a.delivered === false && (
                  <span className="px-2 py-[1px] rounded bg-rose-600/20 border border-rose-600/40 text-rose-300 text-xs">
                    Failed
                  </span>
                )}
                <span className="truncate">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Sticky "Top ↑" button */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed rounded-full border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
        style={{
          right: "0.25rem",
          bottom: "0.25rem",
          padding: "6px 9px",
          opacity: 0.639,
          zIndex: 9,
        }}
        title="Back to top"
      >
        Top ↑
      </button>
    </>
  );
}

// Small reusable control block for overlays (VWAP & EMAs)
function OverlayControls({ label, cfg, onChange }) {
  const { show = false, color = "#ffffff", opacity = 0.5, smooth = 1 } = cfg || {};
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/80 p-3 flex flex-wrap items-center gap-3">
      <div className="min-w-[5rem] text-slate-200 font-medium">{label}</div>
      <label className="text-sm text-slate-300">Show</label>
      <input
        type="checkbox"
        className="accent-sky-500"
        checked={!!show}
        onChange={(e) => onChange({ show: e.target.checked })}
        title={`Show ${label}`}
      />
      <div className="text-slate-300 text-sm">Color</div>
      <input
        type="color"
        value={color}
        onChange={(e) => onChange({ color: e.target.value })}
        className="h-7 w-7 rounded border border-slate-700 bg-slate-800 p-0"
        title={`${label} color`}
      />
      <div className="text-slate-300 text-sm">Opacity</div>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={opacity ?? 0.5}
        onChange={(e) => onChange({ opacity: Number(e.target.value) })}
        className="w-40"
        title={`${label} opacity`}
      />
      <div className="text-slate-300 text-sm">Smooth</div>
      <select
        value={smooth ?? 1}
        onChange={(e) => onChange({ smooth: Number(e.target.value) })}
        className="bg-slate-800 border border-slate-700 rounded text-slate-200 text-sm px-2 py-1"
        title={`${label} smoothing window (SMA)`}
      >
        <option value={1}>Off</option>
        <option value={3}>3</option>
        <option value={5}>5</option>
        <option value={9}>9</option>
      </select>
    </div>
  );
}
