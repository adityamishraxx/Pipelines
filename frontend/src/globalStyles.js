// Single global CSS string, injected once in App.jsx — matches reference app
// convention. Utility classes for common elements; components fall back to
// inline style={{}} for one-off layout tweaks.
export const GLOBAL_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f2f7; color: #1c1c1e; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }

  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 12px; border: 1px solid #e5e5ea; background: #fff; color: #1c1c1e; font-size: 13px; font-weight: 590; cursor: pointer; transition: all .15s; }
  .btn:hover { background: #f8fafc; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn:active { transform: scale(0.98); }
  .btn-primary { background: #0a84ff; border-color: #0a84ff; color: #fff; box-shadow: 0 1px 2px rgba(10,132,255,.35); }
  .btn-primary:hover { background: #0066d6; }
  .btn-danger { background: #fff; border-color: #fecaca; color: #dc2626; }
  .btn-danger:hover { background: #fef2f2; }
  .btn-success { background: #059669; border-color: #059669; color: #fff; }
  .btn-success:hover { background: #047857; }
  .btn-sm { padding: 5px 10px; font-size: 12px; }

  .card { background: #fff; border: 1px solid rgba(0,0,0,.05); border-radius: 20px; padding: 20px; box-shadow: 0 1px 1px rgba(0,0,0,.03), 0 8px 28px rgba(17,12,46,.06); }
  .card-sm { background: #fff; border: 1px solid #eceef1; border-radius: 14px; padding: 14px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }

  .input, select.input, textarea.input { width: 100%; padding: 9px 12px; border: 1px solid #e5e5ea; border-radius: 12px; font-size: 13px; outline: none; background: #fff; color: #1c1c1e; font-family: inherit; }
  .input:focus { border-color: #0a84ff; box-shadow: 0 0 0 3px rgba(10,132,255,.12); }
  .input::placeholder { color: #94a3b8; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  label.field-label { font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px; }

  .badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .badge-red { background: #fee2e2; color: #b91c1c; }
  .badge-amber { background: #fef3c7; color: #92400e; }
  .badge-green { background: #dcfce7; color: #0a84ff; }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .badge-purple { background: #ede9fe; color: #5b21b6; }
  .badge-gray { background: #f1f5f9; color: #475569; }
  .badge-orange { background: #ffedd5; color: #9a3412; }
  .badge-teal { background: #ccfbf1; color: #115e59; }

  table.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.data-table th { text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
  table.data-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  table.data-table tbody tr:hover { background: #f8fafc; cursor: pointer; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.5); display: flex; align-items: flex-start; justify-content: center; z-index: 100; overflow-y: auto; padding: 40px 16px; }
  .modal { background: #fff; border-radius: 20px; width: 100%; max-width: 760px; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
  .modal-header { padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
  .modal-body { padding: 24px; max-height: 70vh; overflow-y: auto; }

  .kpi-card { background: #fff; border: 1px solid rgba(0,0,0,.05); border-radius: 20px; padding: 18px; box-shadow: 0 1px 1px rgba(0,0,0,.03), 0 8px 28px rgba(17,12,46,.06); }
  .kpi-card.clickable { cursor: pointer; transition: box-shadow .15s; }
  .kpi-card.clickable:hover { box-shadow: 0 2px 4px rgba(0,0,0,.04), 0 16px 40px rgba(17,12,46,.10); transform: translateY(-2px); }

  .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin: 0 0 12px; }

  .tab { padding: 7px 16px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; color: #64748b; }
  .tab.active { background: #fff; color: #1c1c1e; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 1px 1px rgba(0,0,0,.04); }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }

  /* Continuous, smooth ticker (e.g. overdue follow-ups). The track holds two identical copies of the
     content back-to-back and slides left by exactly half its width, so the loop is seamless with no
     jump. Pauses on hover so a user can read an entry. Respects reduced-motion preferences. */
  .marquee { overflow: hidden; white-space: nowrap; }
  .marquee__track { display: inline-flex; white-space: nowrap; will-change: transform; animation: crm-marquee linear infinite; }
  .marquee:hover .marquee__track { animation-play-state: paused; }
  @keyframes crm-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @media (prefers-reduced-motion: reduce) { .marquee__track { animation: none; } }

  /* Clickable conversion-funnel bands — subtle lift + brighten on hover. */
  .funnel-band { transition: filter .15s ease, transform .15s ease; }
  .funnel-band:hover { filter: brightness(1.06) saturate(1.08); transform: translateY(-1px); }
`;
