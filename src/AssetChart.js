import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { RSI as rsiCalc } from "technicalindicators";

const BINANCE_REST = "https://api.binance.us/api";
const BINANCE_WS   = "wss://stream.binance.us:9443/ws/";
const BINANCE_INTERVAL = { "1m": "1m", "5m": "5m", "1h": "1h", "1d": "1d" };

// Convert a CSS color to rgba with desired alpha (handles hex and rgb)
function withAlpha(color, alpha = 0.75) {
  if (!color) return `rgba(255,255,255,${alpha})`;
  const a = Math.max(0, Math.min(1, alpha));
  const c = color.trim().toLowerCase();
  if (c.startsWith("rgba(")) return c;
  if (c.startsWith("rgb(")) {
    const body = c.slice(4, -1);
    return `rgba(${body}, ${a})`;
  }
  if (c[0] === "#") {
    const hex = c.replace("#", "");
    const parse = (h) => parseInt(h, 16);
    if (hex.length === 3) {
      const r = parse(hex[0] + hex[0]);
      const g = parse(hex[1] + hex[1]);
      const b = parse(hex[2] + hex[2]);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    if (hex.length === 6) {
      const r = parse(hex.slice(0, 2));
      const g = parse(hex.slice(2, 4));
      const b = parse(hex.slice(4, 6));
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  return color;
}

function toHeikinAshi(bars) {
  if (!bars || !bars.length) return [];
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const c = (b.open + b.high + b.low + b.close) / 4;
    if (i === 0) {
      const o = (b.open + b.close) / 2;
      out.push({ time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c, volume: b.volume });
    } else {
      const prev = out[i - 1];
      const o = (prev.open + prev.close) / 2;
      out.push({ time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c, volume: b.volume });
    }
  }
  return out;
}

function getLinePrice(ln, range, lo, last) {
  if (ln && ln.price != null) return ln.price;
  if (range != null && lo != null && ln && ln.ratio != null) {
    return lo + Number(ln.ratio) * range;
  }
  return last != null ? last.close : null;
}

// Simple moving average for smoothing any line array of {time, value}
function sma(arr, window) {
  const w = Math.max(1, Math.floor(window));
  if (w <= 1) return arr.slice();
  const out = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i].value;
    if (i >= w) sum -= arr[i - w].value;
    if (i >= w - 1) out.push({ time: arr[i].time, value: sum / w });
    else out.push({ time: arr[i].time, value: arr[i].value });
  }
  return out;
}

// VWAP compute
function computeVWAP(bars) {
  if (!bars || !bars.length) return [];
  let cumPV = 0;
  let cumVol = 0;
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.high + b.low + b.close) / 3;
    const vol = b.volume || 0;
    cumPV += typical * vol;
    cumVol += vol;
    const vwap = cumVol > 0 ? cumPV / cumVol : typical;
    out.push({ time: b.time, value: vwap });
  }
  return out;
}

// EMA compute (returns array<{time,value}>) on bars[].close
function computeEMA(bars, period) {
  if (!bars || bars.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaPrev = bars[0].close;
  out.push({ time: bars[0].time, value: emaPrev });
  for (let i = 1; i < bars.length; i++) {
    const close = bars[i].close;
    const ema = close * k + emaPrev * (1 - k);
    out.push({ time: bars[i].time, value: ema });
    emaPrev = ema;
  }
  return out;
}

export default function AssetChart({
  symbol,
  timeframe,
  fibLines,
  onFibLinesUpdate,
  onAlert,
  useHeikinAshi = false,
  useHaRsi = false,
  // VWAP
  vwapShow = true,
  vwapColor = "#ffffff",
  vwapOpacity = 0.5,
  vwapSmooth = 1,
  // EMAs
  ema9Show = false,
  ema9Color = "#a78bfa",
  ema9Opacity = 0.75,
  ema9Smooth = 1,
  ema20Show = false,
  ema20Color = "#60a5fa",
  ema20Opacity = 0.75,
  ema20Smooth = 1,
  ema200Show = false,
  ema200Color = "#f87171",
  ema200Opacity = 0.9,
  ema200Smooth = 1,
  autoCenter = true,
}) {
  const containerRef = useRef(null);
  const chartHostRef = useRef(null);
  const dragShieldRef = useRef(null);

  const chartRef  = useRef(null);
  const seriesRef = useRef(null);
  const wsRef     = useRef(null);
  const priceLinesRef = useRef({});

  // Overlay series refs
  const vwapRef   = useRef(null);
  const ema9Ref   = useRef(null);
  const ema20Ref  = useRef(null);
  const ema200Ref = useRef(null);

  // Keep overlay data for hover tooltips
  const vwapDataRef   = useRef([]);
  const ema9DataRef   = useRef([]);
  const ema20DataRef  = useRef([]);
  const ema200DataRef = useRef([]);

  // UI overlays
  const tipRef      = useRef(null);
  const snapLineRef = useRef(null);
  const rsiBadgeRef = useRef(null);

  // Drag via right price labels
  const draggingRef  = useRef({ active: false, id: null });

  // Data state
  const [bars, setBars] = useState([]);
  const [lastPrice, setLastPrice] = useState(null);
  const [rsi, setRsi] = useState(null);
  const [haRsi, setHaRsi] = useState(null);

  // Auto-center governance
  const manualZoomRef = useRef(0);
  const markManualZoom = () => (manualZoomRef.current = Date.now());
  const allowAutoCenter = () => autoCenter && (Date.now() - manualZoomRef.current) > 1200;

  // Mount chart
  useEffect(() => {
    if (!chartHostRef.current) return;

    const chart = createChart(chartHostRef.current, {
      layout: { background: { color: "#0f172a" }, textColor: "#e2e8f0" },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.25)" },
      timeScale:       { borderColor: "rgba(148,163,184,0.25)" },
      grid: { horzLines: { color: "rgba(30,41,59,0.6)" }, vertLines: { color: "rgba(30,41,59,0.6)" } },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    // Responsive
    const syncSize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = Math.max(280, containerRef.current.clientHeight);
      chart.applyOptions({ width: w, height: h });
    };
    const ro = new ResizeObserver(syncSize);
    ro.observe(containerRef.current);
    syncSize();

    // Tooltip
    const tip = document.createElement("div");
    Object.assign(tip.style, {
      position: "absolute", pointerEvents: "none", padding: "6px 8px",
      background: "rgba(15,23,42,.95)", color: "#e2e8f0",
      border: "1px solid rgba(148,163,184,.25)", borderRadius: ".5rem",
      fontSize: "12px", transform: "translate(-8px,-50%)", whiteSpace: "nowrap",
      zIndex: "120", display: "none", right: "6px",
    });
    containerRef.current.appendChild(tip);
    tipRef.current = tip;

    // Snap marker
    const snap = document.createElement("div");
    Object.assign(snap.style, {
      position: "absolute", left: "0", right: "0",
      borderTop: "1px dashed rgba(148,163,184,0.35)", pointerEvents: "none",
      zIndex: "110", display: "none",
    });
    containerRef.current.appendChild(snap);
    snapLineRef.current = snap;

    // RSI badge
    const badge = document.createElement("div");
    Object.assign(badge.style, {
      position: "absolute", top: "8px", left: "8px", padding: "4px 8px",
      borderRadius: "8px", background: "rgba(2,6,23,.6)",
      border: "1px solid rgba(148,163,184,.25)", fontSize: "12px",
      color: "#cbd5e1", zIndex: "130", pointerEvents: "none", userSelect: "none",
    });
    badge.textContent = "RSI: --  |  HA-RSI: --";
    containerRef.current.appendChild(badge);
    rsiBadgeRef.current = badge;

    const onWheel = () => markManualZoom();
    containerRef.current.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      containerRef.current && containerRef.current.removeEventListener("wheel", onWheel);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      vwapRef.current = null;
      ema9Ref.current = null;
      ema20Ref.current = null;
      ema200Ref.current = null;
      tipRef.current = null;
      snapLineRef.current = null;
      rsiBadgeRef.current = null;
      priceLinesRef.current = {};
    };
  }, [autoCenter, symbol]);

  // Helper: ensure line series exists/removed based on "show"
  function ensureLineSeries(ref, show, color, opacity) {
    if (!chartRef.current) return;
    if (show) {
      if (!ref.current) {
        ref.current = chartRef.current.addLineSeries({
          lineWidth: 2,
          color: withAlpha(color || "#ffffff", opacity ?? 0.5),
          priceLineVisible: false,
          lastValueVisible: false,
        });
      } else {
        ref.current.applyOptions({ color: withAlpha(color || "#ffffff", opacity ?? 0.5) });
      }
    } else {
      if (ref.current) {
        try { chartRef.current.removeSeries(ref.current); } catch {}
        ref.current = null;
      }
    }
  }

  // Load historical
  useEffect(() => {
    async function load() {
      try {
        const url = `${BINANCE_REST}/v3/klines?symbol=${symbol}&interval=${BINANCE_INTERVAL[timeframe]}&limit=500`;
        const res = await fetch(url);
        const arr = await res.json();
        const b = arr.map((k) => ({
          time: Math.floor(k[0] / 1000),
          open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
        }));
        setBars(b);

        const useBars = useHeikinAshi ? toHeikinAshi(b) : b;
        seriesRef.current && seriesRef.current.setData(useBars);
        if (seriesRef.current && allowAutoCenter()) chartRef.current.timeScale().fitContent();
        if (b.length) setLastPrice(b[b.length - 1].close);

        // RSI
        const closesStd = b.map((x) => x.close);
        const r = rsiCalc.calculate({ period: 14, values: closesStd });
        setRsi(r && r.length ? r[r.length - 1] : null);
        const closesHa = toHeikinAshi(b).map((x) => x.close);
        const rha = rsiCalc.calculate({ period: 14, values: closesHa });
        setHaRsi(rha && rha.length ? rha[rha.length - 1] : null);

        // Overlays
        // VWAP
        ensureLineSeries(vwapRef, vwapShow, vwapColor, vwapOpacity);
        if (vwapShow && vwapRef.current) {
          let vwapData = computeVWAP(useBars);
          if (vwapSmooth && vwapSmooth > 1) vwapData = sma(vwapData, vwapSmooth);
          vwapDataRef.current = vwapData;
          vwapRef.current.setData(vwapData);
        } else {
          vwapDataRef.current = [];
        }
        // EMA 9
        ensureLineSeries(ema9Ref, ema9Show, ema9Color, ema9Opacity);
        if (ema9Show && ema9Ref.current) {
          let e = computeEMA(useBars, 9);
          if (ema9Smooth && ema9Smooth > 1) e = sma(e, ema9Smooth);
          ema9DataRef.current = e;
          ema9Ref.current.setData(e);
        } else {
          ema9DataRef.current = [];
        }
        // EMA 20
        ensureLineSeries(ema20Ref, ema20Show, ema20Color, ema20Opacity);
        if (ema20Show && ema20Ref.current) {
          let e = computeEMA(useBars, 20);
          if (ema20Smooth && ema20Smooth > 1) e = sma(e, ema20Smooth);
          ema20DataRef.current = e;
          ema20Ref.current.setData(e);
        } else {
          ema20DataRef.current = [];
        }
        // EMA 200
        ensureLineSeries(ema200Ref, ema200Show, ema200Color, ema200Opacity);
        if (ema200Show && ema200Ref.current) {
          let e = computeEMA(useBars, 200);
          if (ema200Smooth && ema200Smooth > 1) e = sma(e, ema200Smooth);
          ema200DataRef.current = e;
          ema200Ref.current.setData(e);
        } else {
          ema200DataRef.current = [];
        }
      } catch (e) {
        console.error(e);
      }
    }
    load();
  }, [
    symbol, timeframe, useHeikinAshi, useHaRsi,
    vwapShow, vwapColor, vwapOpacity, vwapSmooth,
    ema9Show, ema9Color, ema9Opacity, ema9Smooth,
    ema20Show, ema20Color, ema20Opacity, ema20Smooth,
    ema200Show, ema200Color, ema200Opacity, ema200Smooth
  ]);

  // Live updates
  useEffect(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    const stream = `${symbol.toLowerCase()}@kline_${BINANCE_INTERVAL[timeframe]}`;
    const ws = new WebSocket(`${BINANCE_WS}${stream}`);
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (!d.k) return;
        const k = d.k;
        const bar = { time: Math.floor(k.t/1000), open:+k.o, high:+k.h, low:+k.l, close:+k.c, volume:+k.v };
        setBars(prev => {
          const p = prev.slice();
          if (p.length && p[p.length-1].time === bar.time) p[p.length-1] = bar; else p.push(bar);
          const useBars = useHeikinAshi ? toHeikinAshi(p) : p;
          seriesRef.current && seriesRef.current.setData(useBars);
          setLastPrice(bar.close);

          // RSI updates
          try {
            const closesStd = p.map(x => x.close);
            const r = rsiCalc.calculate({ period: 14, values: closesStd });
            setRsi(r && r.length ? r[r.length-1] : null);
            const closesHa = toHeikinAshi(p).map(x => x.close);
            const rha = rsiCalc.calculate({ period: 14, values: closesHa });
            setHaRsi(rha && rha.length ? rha[rha.length-1] : null);
          } catch {}

          // Overlays recompute
          try {
            // VWAP
            if (vwapShow && vwapRef.current) {
              let vwapData = computeVWAP(useBars);
              if (vwapSmooth && vwapSmooth > 1) vwapData = sma(vwapData, vwapSmooth);
              vwapDataRef.current = vwapData;
              vwapRef.current.setData(vwapData);
            } else vwapDataRef.current = [];
            // EMA 9
            if (ema9Show && ema9Ref.current) {
              let e = computeEMA(useBars, 9);
              if (ema9Smooth && ema9Smooth > 1) e = sma(e, ema9Smooth);
              ema9DataRef.current = e;
              ema9Ref.current.setData(e);
            } else ema9DataRef.current = [];
            // EMA 20
            if (ema20Show && ema20Ref.current) {
              let e = computeEMA(useBars, 20);
              if (ema20Smooth && ema20Smooth > 1) e = sma(e, ema20Smooth);
              ema20DataRef.current = e;
              ema20Ref.current.setData(e);
            } else ema20DataRef.current = [];
            // EMA 200
            if (ema200Show && ema200Ref.current) {
              let e = computeEMA(useBars, 200);
              if (ema200Smooth && ema200Smooth > 1) e = sma(e, ema200Smooth);
              ema200DataRef.current = e;
              ema200Ref.current.setData(e);
            } else ema200DataRef.current = [];
          } catch {}

          return p;
        });
      } catch {}
    };
    wsRef.current = ws;
    return () => { try { ws.close(); } catch {} };
  }, [
    symbol, timeframe, useHeikinAshi,
    vwapShow, vwapSmooth,
    ema9Show, ema9Smooth,
    ema20Show, ema20Smooth,
    ema200Show, ema200Smooth
  ]);

  // Apply color/opacity changes to overlays without re-creating data
  useEffect(() => {
    if (vwapRef.current && vwapShow) vwapRef.current.applyOptions({ color: withAlpha(vwapColor, vwapOpacity) });
    if (ema9Ref.current && ema9Show) ema9Ref.current.applyOptions({ color: withAlpha(ema9Color, ema9Opacity) });
    if (ema20Ref.current && ema20Show) ema20Ref.current.applyOptions({ color: withAlpha(ema20Color, ema20Opacity) });
    if (ema200Ref.current && ema200Show) ema200Ref.current.applyOptions({ color: withAlpha(ema200Color, ema200Opacity) });
  }, [
    vwapShow, vwapColor, vwapOpacity,
    ema9Show, ema9Color, ema9Opacity,
    ema20Show, ema20Color, ema20Opacity,
    ema200Show, ema200Color, ema200Opacity
  ]);

  // RSI badge text
  useEffect(() => {
    if (!rsiBadgeRef.current) return;
    const rTxt  = (rsi != null && Number.isFinite(rsi))   ? rsi.toFixed(1)   : "--";
    const hrTxt = (haRsi != null && Number.isFinite(haRsi)) ? haRsi.toFixed(1) : "--";
    rsiBadgeRef.current.textContent = `RSI: ${rTxt}  |  HA-RSI: ${hrTxt}`;
  }, [rsi, haRsi]);

  // Lines + DRAG VIA RIGHT PRICE LABELS + HYDRATE PRICES UPSTREAM
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || !containerRef.current) return;

    const chart  = chartRef.current;
    const series = seriesRef.current;
    const plMap  = priceLinesRef.current;

    // Window / range
    const last = bars.length ? bars[bars.length - 1] : null;
    const look = bars.slice(-120);
    const hi = look.length ? Math.max(...look.map((b) => b.high)) : null;
    const lo = look.length ? Math.min(...look.map((b) => b.low)) : null;
    const range = hi != null && lo != null ? hi - lo : null;

    // Snapping candidates
    const ratios = [-1.0, -0.618, -0.272, 0.236, 0.382, 0.5, 0.618, 0.786, 1.272, 1.618, 2.0];
    const snaps = [];
    if (range != null) for (const r of ratios) snaps.push({ type: "ratio", r, price: lo + r * range });
    for (const b of look) { snaps.push({ type: "high", price: b.high }); snaps.push({ type: "low", price: b.low }); }
    const nearestSnap = (price) => {
      let best = null, dmin = Infinity;
      for (const s of snaps) {
        const d = Math.abs(s.price - price);
        if (d < dmin) { dmin = d; best = s; }
      }
      return best ?? { price, type: null };
    };

    const scaleApi = series.priceScale();
    const yToPrice = (y) => { try { return scaleApi.coordinateToPrice(y); } catch { return null; } };
    const priceToY = (p) => { try { return scaleApi.priceToCoordinate(p); } catch { return null; } };

    // 0) HYDRATE MISSING PRICES BACK TO DASHBOARD
    if (fibLines && fibLines.length && (range != null || last != null)) {
      const filled = fibLines.map((ln) => {
        if (ln.price == null) {
          const p = getLinePrice(ln, range, lo, last);
          return (p != null && Number.isFinite(p)) ? { ...ln, price: p } : ln;
        }
        return ln;
      });
      const changed = filled.some((ln, i) => ln.price !== fibLines[i].price);
      if (changed && typeof onFibLinesUpdate === "function") {
        onFibLinesUpdate(symbol, filled);
      }
    }

    // 1) Draw/update price lines with per-line color,
    //    alert-enabled lines thicker (lineWidth 2)
    fibLines.forEach((ln) => {
      if (!ln.enabled) {
        if (plMap[ln.id]) { try { series.removePriceLine(plMap[ln.id]); } catch {}; delete plMap[ln.id]; }
        return;
      }
      const price = getLinePrice(ln, range, lo, last) ?? (last?.close ?? 0);
      const width = ln.alertEnabled ? 2 : 1;
      const opts = {
        price,
        color: withAlpha(ln.color || "#ffffff", 0.75),
        lineWidth: width,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "",
      };
      if (!plMap[ln.id]) plMap[ln.id] = series.createPriceLine(opts);
      else plMap[ln.id].applyOptions(opts);
    });
    Object.keys(plMap).forEach((id) => {
      if (!fibLines.find((l) => l.id === id && l.enabled)) { try { series.removePriceLine(plMap[id]); } catch {}; delete plMap[id]; }
    });

    // --- DRAG using right price labels (hit-test near right edge) ---
    const HIT_RIGHT_WIDTH = 64; // px from right edge to grab
    const HIT_TOL_Y = 12;       // px vertical tolerance

    function hitTestLineByMouse(e) {
      const rect = containerRef.current.getBoundingClientRect();
      const withinRight = e.clientX >= rect.right - HIT_RIGHT_WIDTH;
      if (!withinRight) return null;

      // nearest enabled line in Y
      let target = null;
      let bestDy = Infinity;
      fibLines.forEach((ln) => {
        if (!ln.enabled) return;
        const price = getLinePrice(ln, range, lo, last);
        const yy = price != null ? priceToY(price) : null;
        if (!Number.isFinite(yy)) return;
        const dy = Math.abs((e.clientY - rect.top) - yy);
        if (dy < bestDy) { bestDy = dy; target = ln; }
      });
      if (bestDy <= HIT_TOL_Y) return target;
      return null;
    }

    function onMouseDown(e) {
      const target = hitTestLineByMouse(e);
      if (!target) return; // not over a label

      // start drag
      draggingRef.current = { active: true, id: target.id };
      try { chart.applyOptions({ handleScroll: { mouseWheel: true, pressedMouseMove: false } }); } catch {}
      if (dragShieldRef.current) {
        dragShieldRef.current.style.display = "block";
        dragShieldRef.current.style.pointerEvents = "auto";
      }
      if (tipRef.current) tipRef.current.style.display = "block";
      e.preventDefault();
      e.stopPropagation();
    }

    function onShieldMove(e) {
      if (!draggingRef.current.active) return;
      const id = draggingRef.current.id;
      const ln = fibLines.find(x => x.id === id);
      if (!ln) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const p = yToPrice(y);
      if (p == null) return;
      const snap = nearestSnap(p);

      // helpers
      if (tipRef.current) {
        tipRef.current.textContent = `${snap.price.toFixed(6)}${snap.type === "ratio" ? " (ratio)" : ""}`;
        tipRef.current.style.top = `${y}px`;
      }
      if (snapLineRef.current) {
        const yy = priceToY(snap.price);
        if (Number.isFinite(yy)) {
          snapLineRef.current.style.top = `${yy}px`;
          snapLineRef.current.style.display = "block";
        }
      }

      // update state upstream
      const moved = fibLines.map((l) => (l.id === id ? { ...l, price: snap.price } : l));
      onFibLinesUpdate(symbol, moved);
    }

    function onShieldUp() {
      if (!draggingRef.current.active) return;
      draggingRef.current = { active: false, id: null };
      if (tipRef.current) tipRef.current.style.display = "none";
      if (snapLineRef.current) snapLineRef.current.style.display = "none";
      try { chart.applyOptions({ handleScroll: { mouseWheel: true, pressedMouseMove: true } }); } catch {}
      if (dragShieldRef.current) {
        dragShieldRef.current.style.display = "none";
        dragShieldRef.current.style.pointerEvents = "none";
      }
    }

    // Keep labels aligned (re-apply price/width/color)
    let rafId = null;
    const tick = () => {
      fibLines.forEach((ln) => {
        if (!ln.enabled) return;
        const pl = plMap[ln.id];
        if (!pl) return;
        const price = getLinePrice(ln, range, lo, last);
        if (price == null) return;
        try {
          pl.applyOptions({
            price,
            color: withAlpha(ln.color || "#ffffff", 0.75),
            lineWidth: ln.alertEnabled ? 2 : 1,
          });
        } catch {}
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // attach events
    containerRef.current.addEventListener("mousedown", onMouseDown);
    if (dragShieldRef.current) dragShieldRef.current.addEventListener("mousemove", onShieldMove);
    window.addEventListener("mouseup", onShieldUp);

    // --- HOVER TOOLTIP FOR LINES (FIB + OVERLAYS) ---
    const HOVER_TOL_Y = 10; // px
    const onHoverMove = (e) => {
      if (!tipRef.current || draggingRef.current.active) return;

      const rect = containerRef.current.getBoundingClientRect();
      const yPx = e.clientY - rect.top;
      const priceAtY = yToPrice(yPx);
      if (priceAtY == null) { tipRef.current.style.display = "none"; return; }

      // Build candidates: fib lines + overlays (using last value for overlays)
      const cands = [];

      // Fib lines
      fibLines.forEach((ln) => {
        if (!ln.enabled) return;
        const p = getLinePrice(ln, range, lo, last);
        if (p == null) return;
        const yy = priceToY(p);
        if (!Number.isFinite(yy)) return;
        const dy = Math.abs(yPx - yy);
        cands.push({
          kind: "fib",
          id: ln.id,
          name: `Fib ${ln.ratio}`,
          price: p,
          dy,
          alertEnabled: !!ln.alertEnabled,
          rsiOp: ln.rsiOp || ">=",
          rsiThreshold: ln.rsiThreshold,
        });
      });

      // Helper: last value from data arrays
      const lastVal = (arr) => (arr && arr.length ? arr[arr.length - 1].value : null);
      const pushOverlay = (show, name, arr) => {
        if (!show) return;
        const p = lastVal(arr);
        if (p == null) return;
        const yy = priceToY(p);
        if (!Number.isFinite(yy)) return;
        const dy = Math.abs(yPx - yy);
        cands.push({ kind: "overlay", name, price: p, dy });
      };

      pushOverlay(vwapShow, "VWAP", vwapDataRef.current);
      pushOverlay(ema9Show, "EMA 9", ema9DataRef.current);
      pushOverlay(ema20Show, "EMA 20", ema20DataRef.current);
      pushOverlay(ema200Show, "EMA 200", ema200DataRef.current);

      if (!cands.length) { tipRef.current.style.display = "none"; return; }

      // pick nearest within tolerance
      cands.sort((a, b) => a.dy - b.dy);
      const best = cands[0];
      if (best.dy > HOVER_TOL_Y) { tipRef.current.style.display = "none"; return; }

      // Compose text
      let text = `${best.name}: ${best.price.toFixed(6)}`;
      if (best.kind === "fib" && best.alertEnabled) {
        text += ` • Alert: RSI ${best.rsiOp} ${best.rsiThreshold}`;
      }

      // position tooltip near cursor, right-aligned to avoid covering labels
      tipRef.current.textContent = text;
      tipRef.current.style.top = `${yPx}px`;
      tipRef.current.style.left = `${Math.min(rect.width - 140, Math.max(8, e.clientX - rect.left + 12))}px`;
      tipRef.current.style.display = "block";
    };

    const onHoverLeave = () => {
      if (tipRef.current && !draggingRef.current.active) tipRef.current.style.display = "none";
    };

    containerRef.current.addEventListener("mousemove", onHoverMove);
    containerRef.current.addEventListener("mouseleave", onHoverLeave);

    return () => {
      containerRef.current && containerRef.current.removeEventListener("mousedown", onMouseDown);
      if (dragShieldRef.current) dragShieldRef.current.removeEventListener("mousemove", onShieldMove);
      window.removeEventListener("mouseup", onShieldUp);
      containerRef.current && containerRef.current.removeEventListener("mousemove", onHoverMove);
      containerRef.current && containerRef.current.removeEventListener("mouseleave", onHoverLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [fibLines, bars, autoCenter, useHeikinAshi, useHaRsi, symbol, timeframe]);

  // Alerts with delivery status to /alert (server) + Dashboard TTS handled upstream
  useEffect(() => {
    if (!bars.length || !fibLines.length) return;
    const price = lastPrice;
    const rsiVal = useHaRsi ? haRsi : rsi;
    const prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;

    fibLines.forEach((ln) => {
      if (!ln.enabled || ln.price == null || !ln.alertEnabled) return;
      if (rsiVal == null || !Number.isFinite(ln.rsiThreshold)) return;

      const wasBelow = prevClose != null ? prevClose < ln.price : null;
      const isBelow = price < ln.price;
      const crossed = wasBelow != null && wasBelow !== isBelow;
      if (!crossed) return;

      const op = ln.rsiOp || ">=";
      const ok = op === ">=" ? rsiVal >= ln.rsiThreshold : rsiVal <= ln.rsiThreshold;
      if (!ok) return;

      const message = `${symbol} ${timeframe} crossed ${Number(ln.ratio)} at ${ln.price.toFixed(6)} | RSI ${useHaRsi ? "(HA)" : ""}=${(rsiVal || 0).toFixed(1)}`;

      (async () => {
        let delivered = false;
        try {
          const res = await fetch("/alert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          });
          delivered = res.ok;
          try { await res.json(); } catch {}
        } catch (e) {
          delivered = false;
        }
        if (typeof onAlert === "function") onAlert({ ts: Date.now(), message, delivered });
      })();
    });
  }, [lastPrice, bars]);

  // Apply overlay visibility changes (create/remove line series) and color/opacity changes
  useEffect(() => {
    ensureLineSeries(vwapRef,   vwapShow,   vwapColor,   vwapOpacity);
    ensureLineSeries(ema9Ref,   ema9Show,   ema9Color,   ema9Opacity);
    ensureLineSeries(ema20Ref,  ema20Show,  ema20Color,  ema20Opacity);
    ensureLineSeries(ema200Ref, ema200Show, ema200Color, ema200Opacity);
  }, [
    vwapShow, vwapColor, vwapOpacity,
    ema9Show, ema9Color, ema9Opacity,
    ema20Show, ema20Color, ema20Opacity,
    ema200Show, ema200Color, ema200Opacity
  ]);

  // Auto-center on symbol/timeframe change
  useEffect(() => {
    if (seriesRef.current && allowAutoCenter()) {
      try { chartRef.current.timeScale().fitContent(); } catch {}
    }
  }, [symbol, timeframe, autoCenter]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h:[420px] md:h-[420px] h-[420px] rounded-xl border border-slate-800 bg-slate-900/40"
      style={{ userSelect: "none" }}
    >
      {/* Chart host */}
      <div ref={chartHostRef} style={{ position: "absolute", inset: 0, zIndex: 10 }} />
      {/* Drag shield (catches movement during drag) */}
      <div
        ref={dragShieldRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 150,
          display: "none",
          cursor: "ns-resize",
          background: "transparent",
          pointerEvents: "none",
        }}
      />
      {/* Tooltip & snap line are created on mount */}
    </div>
  );
}
