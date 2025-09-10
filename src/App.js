import React from "react";
import Dashboard from "./Dashboard.js";
export default function App() {
  const symbols = ["XRPUSDT"];
  return (
    <div className="min-h-screen">
      {/* <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Fib Alerts Dashboard</h1>
          <p className="text-sm text-slate-400">US endpoints • Global Fib Controls • HA & RSI toggles</p>
        </div>
      </header> */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Dashboard defaultSymbols={symbols} />
      </main>
    </div>
  );
}
