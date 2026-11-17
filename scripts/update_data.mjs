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
const PAUSE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- tiện ích chuẩn hoá ----------
export const norm = (s) => String(s)
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

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
export function toPeriodMap(raw) {
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

const REV = ['doanh thu thuan', 'net revenue', 'net sales', 'doanh thu ban hang va cung cap dich vu', 'revenue', 'doanh thu', 'sales'];
const BANK_REV = ['tong thu nhap hoat dong', 'total operating income', 'toi', 'thu nhap lai thuan', 'net interest income'];
const NP = ['loi nhuan sau thue cua co dong cong ty me', 'co dong cua cong ty me', 'cong ty me', 'attributable to parent',
  'attribute to parent', 'parent company', 'share holder income', 'loi nhuan sau thue', 'net profit', 'profit after tax', 'net income'];
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
  const npK = findKey(incRows, NP, ['truoc thue', 'before tax', 'khong kiem soat', 'thieu so', 'minority', 'growth', 'yoy', 'margin']);
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

// ---------- gọi thư viện (thử nhiều cách gọi vì tài liệu chưa đầy đủ) ----------
async function loadLib() {
  const mod = await import('vnstock-js');
  const lib = mod.default ?? mod;
  try { if (typeof lib.init === 'function') await lib.init(); } catch (e) { console.log('init lỗi (bỏ qua):', e.message); }
  return { mod, lib };
}
async function tryCalls(calls) {
  const errs = [];
  for (const [name, fn] of calls) {
    try { const r = await fn(); if (r) return { name, r }; errs.push(`${name}: rỗng`); } catch (e) { errs.push(`${name}: ${e.message}`); }
  }
  throw new Error(errs.join(' | '));
}
async function fetchOne({ mod, lib }, sym) {
  const f = lib?.stock?.financials;
  const legacy = mod.Vnstock ? new mod.Vnstock().stock : null;
  const inc = await tryCalls([
    ['stock.financials.incomeStatement', () => f?.incomeStatement?.({ symbol: sym, period: 'quarter' })],
    ['stock.financials(income)', () => (typeof f === 'function' ? f({ ticker: sym, period: 'quarter', type: 'income' }) : null)],
    ['legacy.financials', () => legacy?.financials?.({ ticker: sym, period: 'quarter' })],
  ]);
  await sleep(PAUSE_MS);
  const bs = await tryCalls([
    ['stock.financials.balanceSheet', () => f?.balanceSheet?.({ symbol: sym, period: 'quarter' })],
    ['stock.financials(balance)', () => (typeof f === 'function' ? f({ ticker: sym, period: 'quarter', type: 'balance' }) : null)],
    ['dùng chung kết quả', () => inc.r],
  ]);
  await sleep(PAUSE_MS);
  return { inc, bs };
}

const clip = (o) => { try { const s = JSON.stringify(o, null, 1); return s.length > 6000 ? s.slice(0, 6000) + '…' : JSON.parse(s); } catch { return String(o).slice(0, 2000); } };

async function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'fin.json');
  let old = {}; try { old = JSON.parse(fs.readFileSync(file, 'utf8')).tickers || {}; } catch {}
  const debug = { node: process.version, time: new Date().toISOString() };
  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : TICKERS;
  const result = { ...old }, errors = {};
  let ctx;
  try {
    ctx = await loadLib();
    debug.exports = Object.keys(ctx.mod);
    debug.libKeys = Object.keys(ctx.lib || {});
    debug.stockKeys = Object.keys(ctx.lib?.stock || {});
    debug.financialsType = typeof ctx.lib?.stock?.financials;
    debug.financialsKeys = Object.keys(ctx.lib?.stock?.financials || {});
  } catch (e) {
    debug.loadError = String(e.stack || e);
  }
  if (ctx) {
    for (const [i, t] of tickers.entries()) {
      console.log(`[${i + 1}/${tickers.length}] ${t}`);
      try {
        const { inc, bs } = await fetchOne(ctx, t);
        if (i < 2) debug[t] = { incCall: inc.name, bsCall: bs.name, inc: clip(inc.r), bs: clip(bs.r) };
        result[t] = build(inc.r, bs.r);
      } catch (e) {
        errors[t] = String(e.message || e).slice(0, 500);
        console.log(`  LỖI ${t}: ${errors[t]}`);
      }
    }
  }
  const updated = new Date(Date.now() + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
  fs.writeFileSync(file, JSON.stringify({ updated, tickers: result, errors }, null, 1));
  fs.writeFileSync(path.join(root, 'debug.json'), JSON.stringify(debug, null, 1));
  console.log(`Xong: ${Object.keys(result).length} mã có số liệu, ${Object.keys(errors).length} mã lỗi`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
