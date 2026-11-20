"""Tạo ảnh TikTok "ĐIỂM TIN CHỨNG KHOÁN NGÀY" (1080x1920).

Cách dùng:  python3 scripts/tiktok/render.py du-lieu.json tiktok/2026-11-20.png

du-lieu.json:
{
  "ngay": "20/11/2026", "thu": "Thứ Sáu",
  "vnindex": {"diem": "1.670,01", "thay_doi": "-19,61 (-1,16%)", "ghi_chu": "Khối ngoại bán ròng **xxx tỷ**"},   (có thể bỏ)
  "tam_diem": ["3 câu ngắn, bọc số liệu nổi bật trong **...**"],
  "tin": [{"ma": "FPT", "noi_dung": "1–2 dòng ngắn"}]   (nên 5 tin, mỗi tin 1 dòng; giữ trống ~200px đáy cho phần chữ TikTok)
}
Không ghi số điện thoại / Zalo (ảnh dùng cho TikTok).
"""
import json, sys, pathlib
from playwright.sync_api import sync_playwright

src, out = sys.argv[1], sys.argv[2]
data = json.loads(pathlib.Path(src).read_text(encoding="utf-8"))
tpl = pathlib.Path(__file__).with_name("diem-tin.html")
pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    try:
        b = p.chromium.launch()
    except Exception:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg = b.new_page(viewport={"width": 1080, "height": 1920})
    pg.add_init_script("window.DATA=" + json.dumps(data, ensure_ascii=False) + ";")
    pg.goto(tpl.resolve().as_uri())
    pg.evaluate("document.fonts.ready.then(()=>1)")
    pg.wait_for_timeout(300)
    over = pg.evaluate("(()=>{const l=document.querySelector('.ls'),f=document.querySelector('.ft');return l.getBoundingClientRect().bottom>f.getBoundingClientRect().top-8||f.getBoundingClientRect().bottom>1720})()")
    pg.screenshot(path=out, full_page=False)
    b.close()
print(("CẢNH BÁO: nội dung tràn khung, hãy bớt tin hoặc rút ngắn câu. " if over else "") + "Đã lưu " + out)
