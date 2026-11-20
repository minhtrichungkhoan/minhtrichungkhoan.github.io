"""Bộ ảnh lướt TikTok 3 trang (1080x1920) từ JSON bản tin cuối phiên.

Cách dùng:  python3 scripts/tiktok/carousel.py du-lieu-ban-tin.json tiktok/2026-11-20
  -> tiktok/2026-11-20-trang-1.png, -trang-2.png, -trang-3.png

Dùng lại JSON của scripts/ban-tin/render.py (chi_so, do_rong, khoi_ngoai, nganh, su_kien...)
và thêm khoá "carousel":
  tieu_de   : tiêu đề trang 1 (ngắn, bọc từ khoá trong **...**)
  mo_ta     : 1 câu dưới số VN-Index
  gt_ghi_chu: vd "+6% so phiên trước"
  kn_rong   : vd "-842,6 tỷ";  kn_ghi_chu: vd "Mua 1.406,5 · Bán 2.249,0 tỷ"
  keo / de  : [[mã, "+3,04"]] tối đa 4 mã mỗi bên (trang 2)
  tang / giam: [[mã, "+4,91%"]] tối đa 6 mã mỗi bên (trang 3)
  su_kien   : [[nhãn, nội dung]] tối đa 6 dòng ngắn (trang 3; bỏ trống thì dùng su_kien của bản tin)
Không ghi số điện thoại / Zalo.
"""
import json, sys, pathlib
from playwright.sync_api import sync_playwright

src, prefix = sys.argv[1], sys.argv[2]
data = json.loads(pathlib.Path(src).read_text(encoding="utf-8"))
tpl = pathlib.Path(__file__).with_name("carousel.html")
pathlib.Path(prefix).parent.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    try:
        b = p.chromium.launch()
    except Exception:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for page in (1, 2, 3):
        pg = b.new_page(viewport={"width": 1080, "height": 1920})
        pg.add_init_script("window.DATA=" + json.dumps(data, ensure_ascii=False) + f";window.PAGE={page};")
        pg.goto(tpl.resolve().as_uri())
        pg.evaluate("document.fonts.ready.then(()=>1)")
        pg.wait_for_timeout(300)
        over = pg.evaluate("(()=>{const k=[...document.getElementById('pg').children];return k.some(x=>x.getBoundingClientRect().bottom>1700)})()")
        out = f"{prefix}-trang-{page}.png"
        pg.screenshot(path=out)
        print(("CẢNH BÁO tràn khung (rút gọn nội dung): " if over else "Đã lưu ") + out)
        pg.close()
    b.close()
