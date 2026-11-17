// Lấy số liệu kinh doanh 5 quý gần nhất bằng thư viện vnstock-js (npm),
// lưu vào data/fin.json cho trang web đọc. Chạy tự động bằng GitHub Actions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ====== DANH SÁCH MÃ (thêm / bớt tuỳ ý) ======
export const TICKERS = [
  // Ngân hàng
  'VCB', 'BID', 'CTG', 'TCB', 'MBB', 'ACB', 'VPB', 'HDB', 'STB', 'SHB',
  'TPB', 'VIB', 'LPB', 'SSB', 'MSB', 'OCB', 'EIB', 'NAB',
  // Chứng khoán
  'SSI', 'VND', 'HCM', 'VCI', 'FTS', 'SHS', 'MBS', 'VIX',
  // Vốn hoá lớn khác
  'FPT', 'HPG', 'MWG', 'VNM', 'VIC', 'VHM', 'VRE', 'MSN', 'GAS', 'PLX',
  'SAB', 'VJC', 'GVR', 'BCM', 'BVH', 'DGC', 'REE', 'PNJ', 'FRT',
];
const N_Q = 5;
export const GROUP = Object.fromEntries([
  ...['VCB', 'BID', 'CTG', 'TCB', 'MBB', 'ACB', 'VPB', 'HDB', 'STB', 'SHB', 'TPB', 'VIB', 'LPB', 'SSB', 'MSB', 'OCB', 'EIB', 'NAB'].map((t) => [t, 'bank']),
  ...['SSI', 'VND', 'HCM', 'VCI', 'FTS', 'SHS', 'MBS', 'VIX'].map((t) => [t, 'sec']),
]);
const PAUSE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- tiện ích chuẩn hoá ----------
export const norm = (s) => String(s)
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[_\-\/]+/g, ' ').replace(/\s+/g, ' ').trim();

export function parsePeriod(x) {
  const s = String(x);
  let m = s.match(/(\d{4})\s*[-_/ ]?\s*q\s*([1-4])/i);
  if (m) return [+m[1], +m[2]];
  m = s.match(/q\s*([1-4])\s*[-_/ ]\s*(\d{2,4})/i);
  if (m) { const y = +m[2]; return [y < 100 ? y + 2000 : y, +m[1]]; }
  return null;
}
const isNum = (v) => v !== null && v !== '' && !Number.isNaN(Number(v)) && typeof v !== 'boolean';

// Tìm mảng bản ghi lớn nhất bên trong kết quả trả về
function findRecords(obj, depth = 0) {
  if (!obj || depth > 4) return null;
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === 'object' && !Array.isArray(obj[0])) return obj;
    return null;
  }
  if (typeof obj === 'object') {
    let best = null;
    for (const v of Object.values(obj)) {
      const r = findRecords(v, depth + 1);
      if (r && (!best || r.length > best.length)) best = r;
    }
    return best;
  }
  return null;
}

// Đưa về dạng: Map "năm-quý" -> {tênkhoảnmục: giá trị}
// Bản 2.0: rows có thể là [{period/year/quarter, values:{...}}] hoặc [{name, values:[...]}] + mảng kỳ riêng
function flatten(raw) {
  // Dạng vnstock-js 2.0: {fields:[{field,titleVi,titleEn}], rows:[{period:'2026-Q3', values:{isb27: ...}}]}
  if (raw && Array.isArray(raw.rows) && raw.rows.length && raw.rows[0] && typeof raw.rows[0].values === 'object' && !Array.isArray(raw.rows[0].values)) {
    const names = {};
    for (const f of raw.fields || []) {
      if (!f || !f.field) continue;
      names[f.field] = [f.titleVi, f.titleEn].filter(Boolean);
    }
    return raw.rows.map((r) => {
      const v = r.values || {};
      const row = {};
      for (const [k, val] of Object.entries(v)) {
        const ns = names[k];
        if (ns && ns.length) { for (const n of ns) if (!(n in row)) row[n] = val; }
        else row[k] = val;
      }
      // kỳ báo cáo: "2026-Q3"; với chỉ số có thể là "2018-Qundefined" -> lấy quý trong values
      let per = String(r.period || '');
      const y = (per.match(/(\d{4})/) || [])[1] || v.year || v.yearReport;
      const q = (per.match(/Q([1-4])/i) || [])[1] || v.quarter || v.lengthReport;
      row.period = y && q >= 1 && q <= 4 ? `${y}-Q${q}` : per;
      return row;
    });
  }
  const recs = findRecords(raw);
  if (!recs || !recs.length) return raw;
  const r0 = recs[0];
  if (r0 && r0.values && typeof r0.values === 'object' && !Array.isArray(r0.values)) {
    return recs.map((r) => ({ ...r, ...r.values, values: undefined }));
  }
  if (r0 && Array.isArray(r0.values)) {
    // tìm mảng nhãn kỳ cùng độ dài
    const n = r0.values.length;
    let periods = null;
    const scan = (o, d = 0) => {
      if (!o || d > 3 || periods) return;
      if (Array.isArray(o) && o.length === n && o.every((x) => typeof x !== 'object' || x === null || parsePeriod(JSON.stringify(x)))) {
        if (o.filter((x) => parsePeriod(typeof x === 'object' ? JSON.stringify(x) : x)).length >= Math.min(2, n)) periods = o;
        return;
      }
      if (typeof o === 'object') for (const v of Object.values(o)) scan(v, d + 1);
    };
    scan(raw);
    if (periods) {
      const nameK = Object.keys(r0).find((k) => k !== 'values' && typeof r0[k] === 'string') || 'name';
      return periods.map((p, i) => {
        const row = { period: typeof p === 'object' ? JSON.stringify(p) : p };
        for (const r of recs) row[String(r[nameK])] = r.values[i];
        return row;
      });
    }
  }
  return raw;
}

export function toPeriodMap(raw0) {
  const raw = flatten(raw0);
  const recs = findRecords(raw);
  const out = new Map();
  if (!recs) return out;
  const keys = Object.keys(recs[0]);
  const nk = Object.fromEntries(keys.map((k) => [norm(k), k]));
  const yk = nk['year report'] || nk['yearreport'] || nk['year'] || nk['nam'];
  const qk = nk['length report'] || nk['lengthreport'] || nk['quarter'] || nk['quy'] || nk['ky'];
  const pk = keys.find((k) => recs.slice(0, 6).filter((r) => parsePeriod(r[k])).length >= Math.min(3, recs.length));
  if (yk && qk) {
    for (const r of recs) { const q = +r[qk]; if (q >= 1 && q <= 4) out.set(`${+r[yk]}-${q}`, r); }
    return out;
  }
  if (pk) {
    for (const r of recs) { const p = parsePeriod(r[pk]); if (p) out.set(`${p[0]}-${p[1]}`, r); }
    return out;
  }
  // Kỳ báo cáo nằm ở tên trường -> mỗi bản ghi là một khoản mục
  const pkeys = keys.filter((k) => parsePeriod(k));
  if (pkeys.length) {
    const nameK = keys.find((k) => !pkeys.includes(k) && typeof recs[0][k] === 'string') || keys[0];
    for (const pkey of pkeys) {
      const p = parsePeriod(pkey); const row = {};
      for (const r of recs) row[String(r[nameK])] = r[pkey];
      out.set(`${p[0]}-${p[1]}`, row);
    }
  }
  return out;
}

export function findKey(rows, prefer, avoid = []) {
  const keys = new Set(); for (const r of rows) Object.keys(r).forEach((k) => keys.add(k));
  const cands = [...keys].map((k) => [k, norm(k)]);
  for (const key of prefer) {
    let best = null;
    for (const [k, nk] of cands) {
      const base = nk.replace(/\(.*?\)/g, '').trim();
      if (nk.includes(key) && !avoid.some((a) => nk.includes(a))) {
        const score = (base === key ? 0 : 1) * 1000 + base.length;
        if (!best || score < best[0]) best = [score, k];
      }
    }
    if (best) return best[1];
  }
  return null;
}

function scaleFor(key, vals) {
  const nk = norm(key || '');
  if (/\(ty|ty dong|billion/.test(nk)) return 1;
  if (/trieu|million/.test(nk)) return 1e-3;
  if (/\(dong\)|vnd/.test(nk)) return 1e-9;
  const m = Math.max(0, ...vals.filter(isNum).map((v) => Math.abs(Number(v))));
  if (m > 1e8) return 1e-9;
  return 1;
}
const pick = (map, key, ids) => {
  if (!key) return ids.map(() => null);
  const raw = ids.map((i) => map.get(i)?.[key]);
  const sc = scaleFor(key, raw);
  return raw.map((v) => (isNum(v) ? Math.round(Number(v) * sc * 10) / 10 : null));
};

const REV = ['doanh thu thuan', 'net revenue', 'net sales', 'cong doanh thu hoat dong', 'doanh thu hoat dong', 'total operating revenue', 'doanh thu ban hang va cung cap dich vu', 'revenue', 'doanh thu', 'sales'];
const BANK_REV = ['tong thu nhap hoat dong', 'total operating income', 'toi', 'thu nhap lai thuan', 'net interest income'];
const NP = ['loi nhuan sau thue cua co dong cong ty me', 'co dong cua cong ty me', 'cong ty me', 'attributable to parent',
  'attribute to parent', 'parent company', 'share holder income', 'loi nhuan sau thue', 'loi nhuan ke toan sau thue', 'net profit', 'profit after tax', 'net income', 'sau thue'];
const LIAB = ['tong no phai tra', 'no phai tra', 'total liabilities', 'liabilities', 'liability'];
const EQ = ['von chu so huu', 'owners equity', 'owner equity', 'owner s equity', 'total equity', 'equity'];

export function build(incRaw, bsRaw) {
  const inc = toPeriodMap(incRaw), bs = toPeriodMap(bsRaw);
  if (inc.size < 2) throw new Error('không đọc được kỳ báo cáo trong kết quả kinh doanh');
  const ids = [...inc.keys()].sort((a, b) => { const [ya, qa] = a.split('-').map(Number), [yb, qb] = b.split('-').map(Number); return ya - yb || qa - qb; }).slice(-N_Q);
  const incRows = ids.map((i) => inc.get(i)), bsRows = [...bs.values()];
  let revK = findKey(incRows, REV, ['gia von', 'giam tru', 'tai chinh', 'chi phi', 'cost', 'deduction', 'financial', 'growth', 'yoy']);
  let revLabel = 'Doanh thu thuần';
  const bankK = findKey(incRows, BANK_REV, ['growth', 'yoy']);
  if (bankK && !revK) { revK = bankK; revLabel = /tong thu nhap|total operating|toi/.test(norm(bankK)) ? 'Tổng thu nhập hoạt động' : 'Thu nhập lãi thuần'; }
  const npK = findKey(incRows, NP, ['truoc thue', 'before tax', 'chi phi thue', 'tax expense', 'khong kiem soat', 'thieu so', 'minority', 'growth', 'yoy', 'margin']);
  const liabK = findKey(bsRows, LIAB, ['ngan han', 'dai han', 'khac', 'short', 'long', 'va von', 'nguon von', 'and equity', 'other']);
  const eqK = findKey(bsRows, EQ, ['tong cong nguon von', 'no phai tra va', 'liabilities and', 'khac', 'other', 'minority', 'growth', 'return']);
  const rev = pick(inc, revK, ids), np = pick(inc, npK, ids);
  if (rev.every((v) => v == null) && np.every((v) => v == null)) throw new Error('không tìm thấy trường doanh thu / lợi nhuận');
  const last = ids[ids.length - 1]; const y0 = `${+last.split('-')[0] - 1}-4`;
  return {
    q: ids.map((i) => { const [y, q] = i.split('-'); return `Q${q}/${y.slice(2)}`; }),
    rev, np,
    liab: pick(bs, liabK, [last])[0], liab0: pick(bs, liabK, [y0])[0], eq: pick(bs, eqK, [last])[0],
    revLabel, src: 'BCTC quý, nguồn VietCap qua vnstock-js',
    _keys: { rev: revK, np: npK, liab: liabK, eq: eqK },
  };
}


// ---------- giá & chỉ số định giá ----------
export function toBars(raw) {
  const recs = findRecords(raw) || [];
  if (!recs.length) return [];
  const ks = Object.keys(recs[0]); const nk = Object.fromEntries(ks.map((k) => [norm(k), k]));
  const g = (...names) => names.map((n) => nk[n]).find(Boolean);
  const tK = g('time', 'date', 'trading date', 't'), oK = g('open', 'o'), hK = g('high', 'h'), lK = g('low', 'l'), cK = g('close', 'c', 'price'), vK = g('volume', 'v', 'vol');
  if (!tK || !cK) return [];
  const toNum = (x) => (isNum(x) ? Math.round(Number(x) * 100) / 100 : null);
  return recs.map((r) => {
    let t = r[tK]; if (typeof t === 'number') t = new Date(t > 1e12 ? t : t * 1000).toISOString().slice(0, 10);
    t = String(t).slice(0, 10);
    const c = toNum(r[cK]);
    return [t, toNum(r[oK]) ?? c, toNum(r[hK]) ?? c, toNum(r[lK]) ?? c, c, toNum(r[vK]) ?? 0];
  }).filter((b) => b[4] != null).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const RATIO_KEYS = {
  pe: ['pe', 'p e', 'price to earning', 'price to earnings'],
  pb: ['pb', 'p b', 'price to book'],
  roe: ['roe', 'return on equity'], roa: ['roa', 'return on assets'],
  eps: ['eps', 'earning per share', 'earnings per share'], bvps: ['bvps', 'book value per share'],
  cap: ['market cap', 'market capitalization', 'von hoa'],
  gm: ['gross margin', 'gross profit margin', 'bien loi nhuan gop'], nm: ['net margin', 'net profit margin', 'bien loi nhuan rong'],
  de: ['debt to equity', 'de', 'd e', 'liabilities to equity'], dy: ['dividend yield'],
};
export function ratiosLatest(raw) {
  let row = null, label = null;
  const map = toPeriodMap(raw);
  if (map.size) {
    const id = [...map.keys()].sort((a, b) => { const [ya, qa] = a.split('-').map(Number), [yb, qb] = b.split('-').map(Number); return ya - yb || qa - qb; }).pop();
    row = map.get(id); const [y, q] = id.split('-'); label = `Q${q}/${y.slice(2)}`;
  } else {
    const recs = findRecords(flatten(raw)); row = recs ? recs[recs.length - 1] : (raw && typeof raw === 'object' ? raw : null);
  }
  if (!row) return null;
  const pickKey = (r, prefs) => { const ks = Object.keys(r).map((k) => [k, norm(k)]); for (const p of prefs) { const h = ks.find(([, nk]) => nk === p) || ks.find(([, nk]) => nk.startsWith(p + ' ') && !/growth|yoy|change/.test(nk)); if (h) return h[0]; } return null; };
  const keys = Object.keys(row).map((k) => [k, norm(k)]);
  const out = { q: label };
  if (map.size) {
    const ids = [...map.keys()].sort((a, b) => { const [ya, qa] = a.split('-').map(Number), [yb, qb] = b.split('-').map(Number); return ya - yb || qa - qb; }).slice(-12);
    const hist = { q: ids.map((i) => { const [y, q] = i.split('-'); return `Q${q}/${y.slice(2)}`; }) };
    for (const name of ['pe', 'pb', 'roe', 'roa', 'nm', 'gm', 'de', 'eps']) {
      const vals = ids.map((i) => { const r = map.get(i); const k = pickKey(r, RATIO_KEYS[name]); return k && isNum(r[k]) ? Number(r[k]) : null; });
      if (vals.some((v) => v != null)) hist[name] = vals;
    }
    out.hist = hist;
  }
  for (const [name, prefs] of Object.entries(RATIO_KEYS)) {
    let hit = null;
    for (const p of prefs) { hit = keys.find(([, nk]) => nk === p) || keys.find(([, nk]) => nk.startsWith(p + ' ') && !/growth|yoy|change/.test(nk)); if (hit) break; }
    if (hit && isNum(row[hit[0]])) out[name] = Number(row[hit[0]]);
  }
  return out;
}

// ---------- điều phối: toàn bộ mã, giá đầy đủ, BCTC xoay vòng ----------
const argv = process.argv.slice(2);
const MODE = (argv.find((a) => a.startsWith('--mode=')) || '--mode=daily').split('=')[1]; // daily | full | none
const ONLY = argv.filter((a) => !a.startsWith('--'));
const WORKERS = 3, CALL_GAP = 350, TIME_BUDGET_MS = 4.5 * 3600e3, ROTATE_DAYS = 7;
const T0 = Date.now();
const clip = (o) => { try { const s = JSON.stringify(o, null, 1); return s.length > 4000 ? s.slice(0, 4000) + '…' : JSON.parse(s); } catch { return String(o).slice(0, 2000); } };

async function retry(fn, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { const r = await fn(); await sleep(CALL_GAP); return r; } catch (e) { err = e; await sleep(1500 * (i + 1) * (/rate|429/i.test(String(e.message)) ? 4 : 1)); }
  }
  throw err;
}
async function pool(items, n, fn) {
  let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: n }, run));
}

// Giữ nến ngày cho 3 năm gần nhất, gộp nến tuần cho giai đoạn cũ hơn (giảm dung lượng)
export function compactBars(bars) {
  if (bars.length < 800) return bars;
  const cut = bars.length - 780, old = bars.slice(0, cut), recent = bars.slice(cut), wk = [];
  const weekKey = (t) => { const d = new Date(t + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
  for (const b of old) {
    const k = weekKey(b[0]); const w = wk.at(-1);
    if (w && w._k === k) { w[2] = Math.max(w[2], b[2]); w[3] = Math.min(w[3], b[3]); w[4] = b[4]; w[5] += b[5]; }
    else { const nb = [b[0], b[1], b[2], b[3], b[4], b[5]]; nb._k = k; wk.push(nb); }
  }
  return [...wk.map((w) => [w[0], w[1], w[2], w[3], w[4], w[5]]), ...recent];
}
const mergeBars = (oldB, newB) => { const m = new Map(oldB.map((b) => [b[0], b])); for (const b of newB) m.set(b[0], b); return [...m.values()].sort((x, y) => (x[0] < y[0] ? -1 : 1)); };

// Danh sách mã của 3 sàn + tên + ngành
async function universe(vn, debug) {
  const out = {};
  for (const ex of ['HOSE', 'HNX', 'UPCOM']) {
    try {
      const raw = await retry(() => vn.symbols({ exchange: ex }));
      const recs = findRecords(raw) || (Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? { symbol: x } : x)) : []);
      if (ex === 'HOSE') debug.symbolsSample = clip(recs.slice(0, 3));
      const ks = recs.length ? Object.keys(recs[0]) : [];
      const nk = Object.fromEntries(ks.map((k) => [norm(k), k]));
      const codeK = nk.symbol || nk.ticker || nk.code || nk['ma'] || ks[0];
      const nameK = nk['organ name'] || nk['company name'] || nk.name || nk['organ short name'] || nk['short name'] || ks.find((k) => /name|ten/i.test(k));
      const indK = ks.find((k) => /industry|icb|sector|nganh/i.test(norm(k)) && typeof recs[0][k] === 'string');
      const typeK = ks.find((k) => /^(type|kind|loai|security type|product grp id)$/i.test(norm(k)));
      for (const r of recs) {
        const c = String(r[codeK] || '').toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(c)) continue;
        if (typeK && r[typeK] && /(cw|warrant|bond|fund|etf|chung quyen|trai phieu)/i.test(norm(r[typeK])) && !/stock|co phieu/i.test(norm(r[typeK]))) continue;
        out[c] = { n: nameK ? r[nameK] : undefined, ex, ind: indK ? r[indK] : undefined };
      }
    } catch (e) { debug['symbolsErr_' + ex] = String(e.message || e); }
  }
  return out;
}

async function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const pxDir = path.join(root, 'px');
  fs.mkdirSync(pxDir, { recursive: true });
  const debug = { node: process.version, time: new Date().toISOString(), mode: MODE };
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  let summary = readJ(path.join(root, 'summary.json'), {}); summary.items ||= {}; summary.idx ||= {};
  let symbols = readJ(path.join(root, 'symbols.json'), {});
  const errors = {};
  const updated = new Date(Date.now() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);

  if (MODE !== 'none') {
    const { vn } = await import('vnstock-js');
    // 1) danh sách mã
    const uni = await universe(vn, debug);
    if (Object.keys(uni).length > 300) symbols = uni;
    for (const t of TICKERS) symbols[t] ||= { ex: 'HOSE' };
    fs.writeFileSync(path.join(root, 'symbols.json'), JSON.stringify(symbols));
    let codes = ONLY.length ? ONLY : Object.keys(symbols).sort();
    debug.universe = codes.length;

    // 2) chỉ số thị trường
    for (const ix of ['VNINDEX', 'VN30', 'HNXINDEX', 'UPCOMINDEX']) {
      try {
        const f = path.join(pxDir, ix + '.json'); const old = readJ(f, null);
        const fresh = old?.bars?.length > 50;
        const raw = await retry(() => vn.index(ix).history(fresh ? '1mo' : 'max')).catch(() => retry(() => vn.index(ix).history('5y')));
        let bars = toBars(raw); if (fresh) bars = mergeBars(old.bars, bars);
        bars = compactBars(bars);
        if (bars.length) {
          fs.writeFileSync(f, JSON.stringify({ s: ix, bars }));
          const L = bars.at(-1), P = bars.at(-2) || L;
          summary.idx[ix] = { c: L[4], chp: P[4] ? (L[4] / P[4] - 1) * 100 : 0, t: L[0], spark: bars.slice(-60).map((b) => b[4]) };
        }
      } catch (e) { errors[ix] = String(e.message || e).slice(0, 200); }
    }

    // 2b) khối ngoại toàn thị trường từ đầu năm (1 lượt gọi)
    try {
      const yStart = new Date().getFullYear() + '-01-01';
      const raw = await retry(() => vn.market.foreign({ range: { from: yStart }, exchange: 'ALL' })).catch(() => retry(() => vn.market.foreign({ range: 'ytd', exchange: 'ALL' })));
      debug.marketForeignSample = clip(Array.isArray(raw) ? raw.slice(-2) : raw);
      const recs = findRecords(raw) || [];
      if (recs.length) {
        const ks = Object.keys(recs[0]); const nk = Object.fromEntries(ks.map((x) => [norm(x), x]));
        const dK = nk.time || nk.date || nk['trading date'] || ks.find((x) => /date|time/i.test(x));
        const vK = nk['net value'] || nk['net buy value'] || ks.find((x) => /net.*val/i.test(x)) || ks.find((x) => /net/i.test(x));
        if (dK && vK) {
          const rows = recs.map((r) => [String(r[dK]).slice(0, 10), isNum(r[vK]) ? Math.round(Number(r[vK])) : 0]).filter((x) => x[0] >= yStart).sort((a, b) => (a[0] < b[0] ? -1 : 1));
          fs.writeFileSync(path.join(root, 'foreign.json'), JSON.stringify({ from: rows[0]?.[0], rows }));
        }
      }
    } catch (e) { errors.marketForeign = String(e.message || e).slice(0, 200); }

    // 3) giá + BCTC
    const day = Math.floor(Date.now() / 86400e3);
    const core = new Set(TICKERS);
    let finCount = 0, pxCount = 0;
    await pool(codes, WORKERS, async (t, k) => {
      if (Date.now() - T0 > TIME_BUDGET_MS) { errors[t] = 'hết thời gian, để lần sau'; return; }
      const f = path.join(pxDir, t + '.json'); const old = readJ(f, {}) || {};
      const rec = { ...old, s: t, n: symbols[t]?.n || old.n, ex: symbols[t]?.ex || old.ex, ind: symbols[t]?.ind || old.ind, g: GROUP[t] || old.g || 'other' };
      const st = vn.stock(t);
      try {
        const fresh = old.bars?.length > 50 && (Date.now() - new Date(old.bars.at(-1)[0]).getTime()) < 25 * 86400e3;
        let raw; try { raw = await retry(() => st.history(fresh ? '1mo' : 'max')); } catch { raw = await retry(() => st.history('5y')); }
        if (k < 2) debug[t + '_hist'] = clip(Array.isArray(raw) ? raw.slice(-2) : raw);
        let bars = toBars(raw); if (fresh) bars = mergeBars(old.bars, bars);
        if (bars.length) { rec.bars = compactBars(bars); pxCount++; }
      } catch (e) { errors[t] = 'giá: ' + String(e.message || e).slice(0, 150); }
      // BCTC: mã cốt lõi mỗi ngày, các mã khác xoay vòng 7 ngày (hoặc tất cả khi --mode=full)
      const doFin = MODE === 'full' || ONLY.length || core.has(t) || (k % ROTATE_DAYS) === (day % ROTATE_DAYS) || !old.fin;
      if (doFin && Date.now() - T0 < TIME_BUDGET_MS) {
        try {
          const inc = await retry(() => st.financials('income', { period: 'quarter' }));
          const bs = await retry(() => st.financials('balance', { period: 'quarter' }));
          rec.fin = build(inc, bs); finCount++;
        } catch (e) { errors[t] = ((errors[t] || '') + ' bctc: ' + String(e.message || e)).slice(0, 300); }
        try { const rat = await retry(() => st.financials('ratios', { period: 'quarter' })); rec.ratios = ratiosLatest(rat); } catch {}
      }
      if (rec.bars?.length) {
        fs.writeFileSync(f, JSON.stringify(rec));
        if (core.has(t)) { const L = rec.bars.at(-1), P = rec.bars.at(-2) || L; summary.items[t] = { c: L[4], chp: P[4] ? (L[4] / P[4] - 1) * 100 : 0, v: L[5], t: L[0] }; }
      }
      if (k % 100 === 0) console.log(`[${k}/${codes.length}] ${t} · ${Math.round((Date.now() - T0) / 60000)} phút`);
    });
    debug.pxCount = pxCount; debug.finCount = finCount;
  }

  // 4) trung vị theo ngành + file tổng hợp số liệu quý
  const med = (a) => { const b = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const grp = {}, finAll = {};
  for (const fn of fs.readdirSync(pxDir)) {
    const d = readJ(path.join(pxDir, fn), null); if (!d || !d.s) continue;
    if (d.fin) finAll[d.s] = d.fin;
    if (!d.ratios) continue;
    for (const g of new Set([d.g || 'other', d.ind].filter(Boolean))) (grp[g] ||= []).push(d.ratios);
  }
  // dòng tiền theo ngành: giá trị giao dịch (giá đóng cửa × khối lượng), biến động giá, khối ngoại ròng
  try {
    // lấy 21 phiên gần nhất: các ngày xuất hiện ở đa số mã cốt lõi (tránh lệch ngày giữa chỉ số và cổ phiếu)
    const cnt = new Map(); let seen = 0;
    for (const t of TICKERS) { const d = readJ(path.join(pxDir, t + '.json'), null); if (!d?.bars?.length) continue; seen++; for (const b of d.bars.slice(-30)) cnt.set(b[0], (cnt.get(b[0]) || 0) + 1); }
    const dates = [...cnt.entries()].filter(([, c]) => c >= Math.max(1, seen / 2)).map(([t]) => t).sort().slice(-21);
    if (dates.length >= 6) {
      const D = dates.length - 1, sec = {}; let frFromMin = null;
      for (const fn of fs.readdirSync(pxDir)) {
        const d = readJ(path.join(pxDir, fn), null);
        if (!d || !d.s || !d.bars || d.s.length !== 3) continue;
        const ind = d.ind || ({ bank: 'Ngân hàng', sec: 'Chứng khoán' })[d.g]; if (!ind) continue;
        const bm = new Map(d.bars.slice(-40).map((b) => [b[0], b]));
        const val = dates.map((t) => { const b = bm.get(t); return b ? b[4] * b[5] : 0; });
        const cl = dates.map((t) => bm.get(t)?.[4] ?? null);
        if (!cl[D]) continue;
        const avg = val.slice(0, D).reduce((x, y) => x + y, 0) / D;
        if (avg <= 0 && val[D] <= 0) continue;
        const ret = (k) => (cl[D - k] ? cl[D] / cl[D - k] - 1 : null);
        const fm = new Map((d.fr || []).map((x) => [x[0], x[1]]));
        const S = (sec[ind] ||= { name: ind, n: 0, val: Array(dates.length).fill(0), w: 0, r1: 0, r5: 0, r20: 0, w5: 0, w20: 0, f1: 0, f5: 0, f20: 0, rY: 0, wY: 0, fY: 0, top: [] });
        S.n++; val.forEach((v, i) => (S.val[i] += v));
        const w = Math.max(avg, 1);
        if (ret(1) != null) { S.r1 += ret(1) * w; S.w += w; }
        if (ret(5) != null) { S.r5 += ret(5) * w; S.w5 += w; }
        if (ret(20) != null) { S.r20 += ret(20) * w; S.w20 += w; }
        S.f1 += fm.get(dates[D]) || 0;
        S.f5 += dates.slice(-5).reduce((x, t) => x + (fm.get(t) || 0), 0);
        S.f20 += dates.reduce((x, t) => x + (fm.get(t) || 0), 0);
        const yS = dates[D].slice(0, 4) + '-01-01';
        const prevY = [...d.bars].reverse().find((b) => b[0] < yS);
        if (prevY && prevY[4]) { S.rY += (cl[D] / prevY[4] - 1) * w; S.wY += w; }
        S.top.push({ s: d.s, v: val[D], c: ret(1) != null ? ret(1) * 100 : null });
      }
      const B = 1e9, tot = Object.values(sec).reduce((x, S) => x + S.val[D], 0) || 1;
      const out = Object.values(sec).filter((S) => S.n >= 1).map((S) => {
        const avg = S.val.slice(0, D).reduce((x, y) => x + y, 0) / D;
        return {
          name: S.name, n: S.n, v: S.val[D] / B, avg: avg / B, ratio: avg ? S.val[D] / avg : null, share: (S.val[D] / tot) * 100,
          c1: S.w ? (S.r1 / S.w) * 100 : null, c5: S.w5 ? (S.r5 / S.w5) * 100 : null, c20: S.w20 ? (S.r20 / S.w20) * 100 : null,
          f1: S.f1 / B, f5: S.f5 / B, f20: S.f20 / B, cY: S.wY ? (S.rY / S.wY) * 100 : null, fY: S.fY / B, spark: S.val.map((v) => Math.round(v / B)),
          top: S.top.sort((a, b) => b.v - a.v).slice(0, 5).map((x) => ({ s: x.s, v: Math.round(x.v / B * 10) / 10, c: x.c != null ? Math.round(x.c * 100) / 100 : null })),
        };
      }).sort((a, b) => b.v - a.v);
      fs.writeFileSync(path.join(root, 'sectors.json'), JSON.stringify({ updated, date: dates[D], dates, total: tot / B, mkt: (() => {
        const fj = readJ(path.join(root, 'foreign.json'), null); if (!fj?.rows?.length) return null;
        const r = fj.rows, sum = (k) => r.slice(-k).reduce((a, x) => a + x[1], 0) / B;
        return { date: r.at(-1)[0], from: fj.from, f1: r.at(-1)[1] / B, f5: sum(5), f20: sum(20), fY: sum(r.length), spark: r.slice(-20).map((x) => Math.round(x[1] / B)) };
      })(), sectors: out }));
      debug.sectors = out.length;
    }
  } catch (e) { debug.sectorErr = String(e.stack || e).slice(0, 500); }
  summary.groups = Object.fromEntries(Object.entries(grp).filter(([, rs]) => rs.length >= 3).map(([g, rs]) => [g, { n: rs.length, pe: med(rs.map((r) => r.pe).filter((v) => v > 0 && v < 200)), pb: med(rs.map((r) => r.pb).filter((v) => v > 0)), roe: med(rs.map((r) => r.roe)) }]));
  summary.updated = updated;
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary));
  fs.writeFileSync(path.join(root, 'fin.json'), JSON.stringify({ updated, tickers: Object.fromEntries(TICKERS.filter((t) => finAll[t]).map((t) => [t, finAll[t]])), errors: Object.fromEntries(Object.entries(errors).slice(0, 300)) }));
  debug.errorCount = Object.keys(errors).length; debug.errorsSample = Object.fromEntries(Object.entries(errors).slice(0, 40));
  debug.minutes = Math.round((Date.now() - T0) / 60000);
  fs.writeFileSync(path.join(root, 'debug.json'), JSON.stringify(debug, null, 1));
  console.log(`Xong sau ${debug.minutes} phút · lỗi: ${debug.errorCount}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
