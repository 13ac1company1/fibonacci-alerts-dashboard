import React from "react";
export default function AlertPanel({ alerts }) {
  if (!alerts || alerts.length === 0) return <p className="text-sm text-slate-400">No alerts yet.</p>;
  return (
    <div className="space-y-2 max-h-80 overflow-auto pr-2">
      {alerts.map((a, idx) => (
        <div key={idx} className="border border-slate-800 bg-slate-900/60 rounded-lg p-2">
          <div className="text-xs text-slate-400">{new Date(a.ts || Date.now()).toLocaleString()}</div>
          <div className="text-sm">{a.message}</div>
        </div>
      ))}
    </div>
  );
}
