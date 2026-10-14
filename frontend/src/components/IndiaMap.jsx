import React, { useState, useMemo, useCallback, useRef } from 'react';
import indiaMap from '@svg-maps/india';

// ---------------------------------------------------------------------------
// State-name (free text) → SVG map id
// ---------------------------------------------------------------------------
const STATE_TO_ID = {
  'andaman and nicobar islands': 'an',
  'andaman & nicobar islands': 'an',
  'andaman and nicobar': 'an',
  'andaman & nicobar': 'an',
  'andaman': 'an',
  'andhra pradesh': 'ap',
  'arunachal pradesh': 'ar',
  'assam': 'as',
  'bihar': 'br',
  'chandigarh': 'ch',
  'chhattisgarh': 'ct',
  'chattisgarh': 'ct',
  'dadra and nagar haveli': 'dn',
  'dadra & nagar haveli': 'dn',
  'dadra': 'dn',
  'dnhdd': 'dn',
  'daman and diu': 'dd',
  'daman & diu': 'dd',
  'daman': 'dd',
  'delhi': 'dl',
  'nct of delhi': 'dl',
  'new delhi': 'dl',
  'goa': 'ga',
  'gujarat': 'gj',
  'haryana': 'hr',
  'himachal pradesh': 'hp',
  'jammu and kashmir': 'jk',
  'jammu & kashmir': 'jk',
  'j&k': 'jk',
  'jharkhand': 'jh',
  'karnataka': 'ka',
  'kerala': 'kl',
  'lakshadweep': 'ld',
  'madhya pradesh': 'mp',
  'maharashtra': 'mh',
  'manipur': 'mn',
  'meghalaya': 'ml',
  'mizoram': 'mz',
  'nagaland': 'nl',
  'odisha': 'or',
  'orissa': 'or',
  'puducherry': 'py',
  'pondicherry': 'py',
  'punjab': 'pb',
  'rajasthan': 'rj',
  'sikkim': 'sk',
  'tamil nadu': 'tn',
  'telangana': 'tg',
  'tripura': 'tr',
  'uttar pradesh': 'up',
  'uttarakhand': 'ut',
  'uttaranchal': 'ut',
  'west bengal': 'wb',
};

// Reverse lookup: id → display name
const ID_TO_NAME = {};
indiaMap.locations.forEach((loc) => {
  ID_TO_NAME[loc.id] = loc.name;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveStateId(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  return STATE_TO_ID[key] || null;
}

/** Linear interpolation between two hex colors */
function lerpColor(a, b, t) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const ca = parse(a);
  const cb = parse(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// Dark theme: no-data states are medium gray on a dark background; shaded states use blue ramp.
const COLOR_EMPTY = '#4b5563'; // gray-600 — unshaded states on dark bg
const COLOR_MIN = '#93c5fd';   // blue-300 — lightest data shade
const COLOR_MAX = '#1e40af';   // blue-800 — darkest data shade

const METRICS = [
  { key: 'customers', label: 'Unique Customers' },
  { key: 'revenue', label: 'Annual Revenue (₹L)' },
  { key: 'quantity', label: 'Total Licenses' },
];

function formatValue(val, metricKey) {
  if (metricKey === 'revenue') {
    return val.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return val.toLocaleString('en-IN');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function IndiaMap({ leads = [] }) {
  const [selectedMetric, setSelectedMetric] = useState('customers');
  const [tooltip, setTooltip] = useState(null); // { x, y, stateId }
  const containerRef = useRef(null);

  // Compute three metrics per state id
  const stateData = useMemo(() => {
    const data = {}; // stateId -> { customersSet, revenue, quantity }

    leads.forEach((lead) => {
      if (lead.phase === 'Lost') return;
      const id = resolveStateId(lead.state);
      if (!id) return;
      if (!data[id]) {
        data[id] = { customersSet: new Set(), revenue: 0, quantity: 0 };
      }
      const d = data[id];

      if (lead.customer_name) d.customersSet.add(lead.customer_name);

      // Annual revenue: (TCV / contract_months) × 12 — PO Received only
      if (lead.phase === 'PO Received') {
        const tcv = parseFloat(lead.potential_tcv_lakhs) || 0;
        const months = parseInt(lead.contract_period_months, 10) || 12;
        d.revenue += (tcv / months) * 12;
      }

      d.quantity += parseInt(lead.quantity, 10) || 0;
    });

    const result = {};
    Object.entries(data).forEach(([id, d]) => {
      result[id] = {
        customers: d.customersSet.size,
        revenue: Math.round(d.revenue * 10) / 10,
        quantity: d.quantity,
      };
    });
    return result;
  }, [leads]);

  // Derive per-metric max and color map
  const { colorMap, maxVal, sortedStates } = useMemo(() => {
    let max = 0;
    const vals = {};
    Object.entries(stateData).forEach(([id, d]) => {
      const v = d[selectedMetric];
      vals[id] = v;
      if (v > max) max = v;
    });

    const colors = {};
    Object.entries(vals).forEach(([id, v]) => {
      if (max === 0) {
        colors[id] = COLOR_MIN;
      } else {
        colors[id] = lerpColor(COLOR_MIN, COLOR_MAX, v / max);
      }
    });

    // Top 5
    const sorted = Object.entries(vals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, v]) => ({ id, value: v }));

    return { colorMap: colors, maxVal: max, sortedStates: sorted };
  }, [stateData, selectedMetric]);

  // Tooltip handlers — use a ref to the container so we never crash on null
  const getPos = useCallback((e) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 10 };
  }, []);

  const handleMouseEnter = useCallback(
    (e, stateId) => { const p = getPos(e); setTooltip({ ...p, stateId }); },
    [getPos]
  );
  const handleMouseMove = useCallback(
    (e) => { const p = getPos(e); setTooltip(prev => prev ? { ...prev, ...p } : prev); },
    [getPos]
  );
  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  // Tooltip content
  const tooltipData = tooltip && stateData[tooltip.stateId];
  const tooltipName = tooltip ? ID_TO_NAME[tooltip.stateId] || tooltip.stateId : '';

  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: 16 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Geographic Distribution</p>
        <select
          value={selectedMetric}
          onChange={(e) => setSelectedMetric(e.target.value)}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid #475569',
            fontSize: 12,
            color: '#e2e8f0',
            background: '#334155',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Body: Map + Top 5 */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Map — compact */}
        <div
          ref={containerRef}
          style={{ position: 'relative', flex: '0 0 55%', maxWidth: '55%', maxHeight: 360 }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={indiaMap.viewBox}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{ display: 'block', maxHeight: 350 }}
          >
            {indiaMap.locations.map((loc) => (
              <path
                key={loc.id}
                d={loc.path}
                fill={colorMap[loc.id] || COLOR_EMPTY}
                stroke="#1e293b"
                strokeWidth={0.6}
                style={{ cursor: 'pointer', transition: 'fill 0.2s' }}
                onMouseEnter={(e) => handleMouseEnter(e, loc.id)}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
            ))}
          </svg>

          {/* Tooltip */}
          {tooltip && (
            <div
              style={{
                position: 'absolute',
                top: tooltip.y,
                left: tooltip.x,
                background: '#1e293b',
                color: '#f1f5f9',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 12,
                lineHeight: 1.6,
                pointerEvents: 'none',
                zIndex: 50,
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                {tooltipName}
              </div>
              {tooltipData ? (
                <>
                  <div>Unique Customers: {tooltipData.customers}</div>
                  <div>Annual Revenue: ₹{formatValue(tooltipData.revenue, 'revenue')}L</div>
                  <div>Total Licenses: {formatValue(tooltipData.quantity, 'quantity')}</div>
                </>
              ) : (
                <div style={{ color: '#94a3b8' }}>No data</div>
              )}
            </div>
          )}

          {/* Legend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 6,
              fontSize: 10,
              color: '#94a3b8',
            }}
          >
            <span>Low</span>
            <div
              style={{
                height: 6,
                width: 80,
                borderRadius: 3,
                background: `linear-gradient(to right, ${COLOR_MIN}, ${COLOR_MAX})`,
              }}
            />
            <span>High</span>
            <span style={{ marginLeft: 8 }}>
              <span style={{ color: COLOR_EMPTY }}>■</span> No data
            </span>
          </div>
        </div>

        {/* Top 5 */}
        <div style={{ flex: '1 1 50%', minWidth: 0 }}>
          <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>
            Top 5 States
          </p>
          {sortedStates.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12 }}>No data available</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sortedStates.map((item, idx) => {
                const barPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
                return (
                  <div key={item.id}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 3,
                        fontSize: 12,
                        color: '#e2e8f0',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>
                        {ID_TO_NAME[item.id] || item.id}
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        {selectedMetric === 'revenue' ? '₹' : ''}
                        {formatValue(item.value, selectedMetric)}
                        {selectedMetric === 'revenue' ? 'L' : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        background: '#334155',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${barPct}%`,
                          borderRadius: 3,
                          background: lerpColor(COLOR_MIN, COLOR_MAX, 0.4 + (0.6 * (4 - idx)) / 4),
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
