"""
Lấy số liệu kinh doanh 5 quý gần nhất cho các mã trong danh sách,
lưu vào data/fin.json để trang web đọc.
Chạy tự động bằng GitHub Actions (xem .github/workflows/update-data.yml).
"""
import json
import os
import re
import sys
import time
import traceback
import unicodedata
from datetime import datetime, timezone, timedelta

import pandas as pd

# ====== DANH SÁCH MÃ CẦN LẤY SỐ LIỆU (thêm / bớt tuỳ ý) ======
TICKERS = [
    # Ngân hàng
    "VCB", "BID", "CTG", "TCB", "MBB", "ACB", "VPB", "HDB", "STB", "SHB",
    "TPB", "VIB", "LPB", "SSB", "MSB", "OCB", "EIB", "NAB",
    # Chứng khoán
    "SSI", "VND", "HCM", "VCI", "FTS", "SHS", "MBS", "VIX",
    # Vốn hoá lớn khác
    "FPT", "HPG", "MWG", "VNM", "VIC", "VHM", "VRE", "MSN", "GAS", "PLX",
    "SAB", "VJC", "GVR", "BCM", "BVH", "DGC", "REE", "PNJ", "FRT",
]
SOURCES = ["VCI", "KBS"]
N_QUARTERS = 5
PAUSE = 3  # giây nghỉ giữa các lần gọi, tránh bị giới hạn

OUT = os.path.join(os.path.dirname(__file__), "..", "data")


def norm(s):
    s = str(s).replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


PERIOD_RE = re.compile(r"(?:(\d{4})\s*[-_/ ]?\s*q\s*([1-4]))|(?:q\s*([1-4])\s*[-_/ ]\s*(\d{2,4}))", re.I)


def parse_period(x):
    m = PERIOD_RE.search(str(x))
    if not m:
        return None
    if m.group(1):
        return int(m.group(1)), int(m.group(2))
    y = int(m.group(4))
    return (y + 2000 if y < 100 else y), int(m.group(3))


def to_period_rows(df):
    """Đưa bảng về dạng: mỗi dòng là một quý, chỉ số = (năm, quý), cột = khoản mục."""
    if df is None or len(df) == 0:
        return None
    df = df.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [" ".join(str(p) for p in c if str(p) != "") for c in df.columns]
    if not isinstance(df.index, pd.RangeIndex):
        df = df.reset_index()
    cols = {norm(c): c for c in df.columns}

    def pick(keys):
        for k in keys:
            for nc, c in cols.items():
                if nc == k:
                    return c
        return None

    ycol = pick(["yearreport", "year", "nam", "year_report"])
    qcol = pick(["lengthreport", "quarter", "quy", "ky", "length_report"])
    if ycol is not None and qcol is not None:
        df = df[pd.to_numeric(df[qcol], errors="coerce").between(1, 4)]
        df.index = [(int(y), int(q)) for y, q in zip(df[ycol], df[qcol])]
        return df.sort_index()

    pcol = None
    for c in df.columns:
        vals = df[c].astype(str).head(8).tolist()
        if vals and sum(parse_period(v) is not None for v in vals) >= max(1, len(vals) // 2):
            pcol = c
            break
    if pcol is not None:
        df = df[df[pcol].map(lambda v: parse_period(v) is not None)]
        df.index = [parse_period(v) for v in df[pcol]]
        return df.sort_index()

    # Kỳ báo cáo nằm ở tên cột -> xoay bảng
    pcols = [c for c in df.columns if parse_period(c)]
    if pcols:
        name_col = next((c for c in df.columns if c not in pcols and not pd.api.types.is_numeric_dtype(df[c])), df.columns[0])
        t = df.set_index(name_col)[pcols].T
        t.index = [parse_period(c) for c in t.index]
        t.columns = [str(c) for c in t.columns]
        return t.sort_index()
    return None


def find_col(df, prefer, avoid=()):
    """Tìm cột theo danh sách từ khoá ưu tiên (so khớp không dấu)."""
    cands = [(c, norm(c)) for c in df.columns]
    for key in prefer:
        best = None
        for c, nc in cands:
            base = re.sub(r"\(.*?\)", "", nc).strip()
            if key in nc and not any(a in nc for a in avoid):
                score = (base != key, len(base))
                if best is None or score < best[0]:
                    best = (score, c)
        if best:
            return best[1]
    return None


def scale_for(col, series):
    nc = norm(col)
    if "ty" in re.findall(r"\(([^)]*)\)", nc) or "(ty" in nc:
        return 1
    if "trieu" in nc:
        return 1e-3
    if "(dong)" in nc or "vnd" in nc:
        return 1e-9
    v = pd.to_numeric(series, errors="coerce").abs().max()
    if pd.notna(v) and v > 1e8:
        return 1e-9
    return 1


def values(df, col, idx):
    if col is None:
        return [None] * len(idx)
    sc = scale_for(col, df[col])
    out = []
    for i in idx:
        try:
            v = pd.to_numeric(df.loc[[i], col], errors="coerce").iloc[-1]
            out.append(None if pd.isna(v) else round(float(v) * sc, 1))
        except Exception:
            out.append(None)
    return out


REV_KEYS = ["doanh thu thuan", "doanh thu ban hang va cung cap dich vu", "doanh thu", "net revenue", "revenue",
            "net sales", "sales"]
BANK_REV_KEYS = ["tong thu nhap hoat dong", "total operating income", "thu nhap lai thuan", "net interest income"]
NP_KEYS = ["loi nhuan sau thue cua co dong cong ty me", "co dong cua cong ty me", "cong ty me",
           "attributable to parent", "attribute to parent", "parent company",
           "loi nhuan sau thue", "net profit", "profit after tax"]
LIAB_KEYS = ["tong no phai tra", "no phai tra", "total liabilities", "liabilities"]
EQ_KEYS = ["von chu so huu", "owner's equity", "owners' equity", "owner equity", "equity"]


def fetch(symbol, debug):
    from vnstock import Finance

    last_err = None
    for src in SOURCES:
        try:
            fin = Finance(symbol=symbol, source=src)
            inc_raw = fin.income_statement(period="quarter", lang="vi")
            time.sleep(PAUSE)
            bs_raw = fin.balance_sheet(period="quarter", lang="vi")
            time.sleep(PAUSE)
            if debug is not None:
                debug[f"{symbol}-{src}"] = {
                    "inc_cols": [str(c) for c in getattr(inc_raw, "columns", [])][:120],
                    "inc_head": str(getattr(inc_raw, "head", lambda n: "")(3))[:3000],
                    "bs_cols": [str(c) for c in getattr(bs_raw, "columns", [])][:120],
                    "bs_head": str(getattr(bs_raw, "head", lambda n: "")(3))[:3000],
                }
            inc, bs = to_period_rows(inc_raw), to_period_rows(bs_raw)
            if inc is None or bs is None or len(inc) < 2:
                raise ValueError("không đọc được kỳ báo cáo")

            idx = list(inc.index)[-N_QUARTERS:]
            bank_col = find_col(inc, BANK_REV_KEYS)
            rev_col = find_col(inc, REV_KEYS, avoid=("gia von", "giam tru", "tai chinh", "chi phi"))
            rev_label = "Doanh thu thuần"
            if bank_col is not None and rev_col is None:
                rev_col, rev_label = bank_col, ("Tổng thu nhập hoạt động" if "tong thu nhap" in norm(bank_col)
                                                else "Thu nhập lãi thuần")
            np_col = find_col(inc, NP_KEYS, avoid=("truoc thue", "co dong khong kiem soat", "thieu so", "minority"))
            liab_col = find_col(bs, LIAB_KEYS, avoid=("ngan han", "dai han", "khac", "short", "long", "va von", "nguon von"))
            eq_col = find_col(bs, EQ_KEYS, avoid=("tong cong nguon von", "no phai tra va", "liabilities and", "khac"))

            rev, np_ = values(inc, rev_col, idx), values(inc, np_col, idx)
            last = idx[-1]
            liab = values(bs, liab_col, [last])[0] if last in bs.index else None
            eq = values(bs, eq_col, [last])[0] if last in bs.index else None
            y0 = (last[0] - 1, 4)
            liab0 = values(bs, liab_col, [y0])[0] if y0 in bs.index else None

            if all(v is None for v in rev) and all(v is None for v in np_):
                raise ValueError("không tìm thấy cột doanh thu / lợi nhuận")
            return {
                "q": [f"Q{q}/{str(y)[2:]}" for y, q in idx],
                "rev": rev, "np": np_, "liab": liab, "liab0": liab0, "eq": eq,
                "revLabel": rev_label,
                "src": f"BCTC quý, nguồn {src} qua vnstock",
                "_cols": {"rev": str(rev_col), "np": str(np_col), "liab": str(liab_col), "eq": str(eq_col)},
            }
        except Exception as e:  # thử nguồn tiếp theo
            last_err = f"{src}: {e}"
            traceback.print_exc()
            time.sleep(PAUSE)
    raise RuntimeError(last_err)


def main():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "fin.json")
    old = {}
    if os.path.exists(path):
        try:
            old = json.load(open(path, encoding="utf-8")).get("tickers", {})
        except Exception:
            old = {}

    only = sys.argv[1:]
    tickers = only or TICKERS
    debug = {}
    result, errors = dict(old), {}
    for i, t in enumerate(tickers):
        print(f"[{i + 1}/{len(tickers)}] {t}", flush=True)
        try:
            result[t] = fetch(t, debug if i < 3 else None)
        except Exception as e:
            errors[t] = str(e)
            print(f"  LỖI {t}: {e}", flush=True)

    vn = timezone(timedelta(hours=7))
    data = {"updated": datetime.now(vn).strftime("%d/%m/%Y %H:%M"), "tickers": result, "errors": errors}
    json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(debug, open(os.path.join(OUT, "debug.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Xong: {len(result)} mã có số liệu, {len(errors)} mã lỗi")
    if not result:
        sys.exit(1)


if __name__ == "__main__":
    main()
