"""Tạo ảnh bản tin cuối phiên cho website (rộng 2160px, cao tự co theo nội dung).

Cách dùng:  python3 scripts/ban-tin/render.py du-lieu.json ban-tin/2026-11-20.png

Khoá JSON (khối nào không có số liệu xác thực thì bỏ khoá đó):
  ngay, thu, tieu_de, phu_de,
  diem_nhan: [câu],                               ** ** = vàng nhạt, ++ ++ = xanh, -- -- = đỏ
  chi_so: [[tên, đóng cửa, thay đổi, giá trị khớp]], chi_so_cot4, chi_so_ghi_chu,
  do_rong: {san, tang, dung, giam, ghi_chu},
  dong_tien: [câu],
  khoi_ngoai: {tom_tat, mua: [[mã, giá trị]], ban: [[mã, giá trị]]},
  nganh: {manh: [[ngành, %]], yeu: [[ngành, %]]},
  co_phieu: [[nhãn, nội dung]], su_kien: [[nhãn, nội dung]]
"""
import json, sys, pathlib
from playwright.sync_api import sync_playwright

src, out = sys.argv[1], sys.argv[2]
data = json.loads(pathlib.Path(src).read_text(encoding="utf-8"))
tpl = pathlib.Path(__file__).with_name("ban-tin.html")
pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    try:
        b = p.chromium.launch()
    except Exception:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport={"width": 1080, "height": 1000}, device_scale_factor=2)
    pg.add_init_script("window.DATA=" + json.dumps(data, ensure_ascii=False) + ";")
    pg.goto(tpl.resolve().as_uri())
    pg.evaluate("document.fonts.ready.then(()=>1)")
    pg.wait_for_timeout(300)
    pg.locator("#pg").screenshot(path=out)
    b.close()
print("Đã lưu " + out)
