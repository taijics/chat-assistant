# -*- coding: utf-8 -*-
"""
企业微信(WeCom) 聊天内容区自动截图 + OCR
- /screenshot_ocr?img=xxx.png  截取企业微信“聊天内容区”（默认且唯一模式）
- 每次请求实时定位企业微信主窗口，适配窗口移动/缩放/右侧面板开合
- 动态检测右侧信息面板分界线，避免把右侧面板截进去
- 自动失败回退手动标注区域（area.json）
- 兼容你现有前端（即使传了 title=微信 也会被忽略）
- 可选 &debug=1 输出 *_debug.png（整窗客户区+红框的调试图）

依赖: pip install pillow requests pypiwin32
"""

import os, json, re, base64, urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

import requests
from PIL import Image, ImageDraw, ImageStat

# --- 百度OCR配置（与你现有保持一致） ---
BAIDU_API_KEY = 'dlbF6u1RGhfmcyAhKvTz6bpG'
BAIDU_SECRET_KEY = 'Ex09wzLZ9W720zhQkrC7778eetMfZ6Bv'

def get_baidu_access_token(api_key=BAIDU_API_KEY, secret_key=BAIDU_SECRET_KEY):
  url = 'https://aip.baidubce.com/oauth/2.0/token'
  params = {'grant_type': 'client_credentials', 'client_id': api_key, 'client_secret': secret_key}
  res = requests.post(url, params=params, timeout=8)
  return res.json().get('access_token')

def baidu_ocr(img_path, access_token=None):
  if access_token is None:
    access_token = get_baidu_access_token()
  with open(img_path, 'rb') as f:
    img_data = f.read()
  img_base64 = base64.b64encode(img_data).decode()
  url = f'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token={access_token}'
  headers = {'Content-Type': 'application/x-www-form-urlencoded'}
  data = {'image': img_base64}
  res = requests.post(url, headers=headers, data=data, timeout=20)
  obj = res.json()
  if 'words_result' in obj:
    return '\n'.join([w['words'] for w in obj['words_result']])
  return f"OCR ERROR: {obj.get('error_msg', str(obj))}"

# --- DPI 感知，避免坐标偏差 ---
import ctypes
try:
  ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
  try:
    ctypes.windll.user32.SetProcessDPIAware()
  except Exception:
    pass

# --- Win32 窗口与截图 ---
import win32gui, win32ui, win32con

AREA_CONFIG_FILE = "area.json"

# 企业微信主窗口类名（不同版本可能不同，保留多候选）
WECOM_CLASSES = ["WeWorkWindow", "WeWorkWClass", "WeComMainWndForPC", "WWCLIENT", "WeComMainWnd", "EnterpriseWeChatMainWnd"]

# 企业微信相对比例（初值），后续结合动态检测右侧栏修正
LAYOUT_WECOM = dict(
  left_rail_w    = 0.055,  # 最左竖向功能栏
  contact_list_w = 0.195,  # 会话列表
  header_h       = 0.085,  # 顶部工具栏
  inputbox_h     = 0.24,   # 底部输入区（含表情/工具条）
  right_sidebar_w= 0.27,   # 右侧信息面板（初值，会被动态修正）
)

MIN_W, MIN_H = 120, 120

def find_wecom_hwnd():
  """优先按类名匹配企业微信主窗口；找不到再用标题包含关键字兜底"""
  hwnd_found = None
  def enum_handler(hwnd, _):
    nonlocal hwnd_found
    if hwnd_found: return
    if not win32gui.IsWindowVisible(hwnd):
      return
    cls = win32gui.GetClassName(hwnd)
    if cls in WECOM_CLASSES:
      hwnd_found = hwnd
      return
    title = win32gui.GetWindowText(hwnd) or ""
    # 标题兜底：包含“企业微信”
    if "企业微信" in title:
      hwnd_found = hwnd
  win32gui.EnumWindows(enum_handler, None)
  return hwnd_found

def get_client_rect(hwnd):
  rc = win32gui.GetClientRect(hwnd)  # (0,0,w,h)
  (lx, ty) = win32gui.ClientToScreen(hwnd, (0, 0))
  (rx, by) = win32gui.ClientToScreen(hwnd, (rc[2], rc[3]))
  return (lx, ty, rx, by)

def bitblt_to_image(x, y, w, h):
  """抓屏到内存，返回PIL Image"""
  hdc = win32gui.GetWindowDC(0)
  srcdc = win32ui.CreateDCFromHandle(hdc)
  memdc = srcdc.CreateCompatibleDC()
  bmp = win32ui.CreateBitmap()
  bmp.CreateCompatibleBitmap(srcdc, w, h)
  memdc.SelectObject(bmp)
  memdc.BitBlt((0, 0), (w, h), srcdc, (x, y), win32con.SRCCOPY)
  bmpinfo = bmp.GetInfo()
  bmpstr = bmp.GetBitmapBits(True)
  img = Image.frombuffer('RGB', (bmpinfo['bmWidth'], bmpinfo['bmHeight']), bmpstr, 'raw', 'BGRX', 0, 1)
  win32gui.DeleteObject(bmp.GetHandle())
  memdc.DeleteDC()
  srcdc.DeleteDC()
  win32gui.ReleaseDC(0, hdc)
  return img

def save_region_png(path, x, y, w, h):
  img = bitblt_to_image(x, y, w, h)
  img.save(path)
  return True

# --------- 动态检测企业微信右侧信息面板分界线（关键） ----------
def detect_right_sidebar_x(client_rect, ratios):
  """
  在客户区中部高度，对右半部分做列均值梯度扫描，
  寻找聊天内容区与右侧信息面板之间的竖向分界线。
  返回：分界线的屏幕x坐标；失败返回None
  """
  L, T, R, B = client_rect
  w = R - L; h = B - T
  if w < 400 or h < 300:
    return None

  top = T + int(h * ratios.get("header_h", 0.08))
  bottom = B - int(h * ratios.get("inputbox_h", 0.22))
  if bottom <= top + 50:
    top = T + int(h * 0.10)
    bottom = B - int(h * 0.22)

  # 只分析右侧 45% 宽度
  scan_left = L + int(w * 0.55)
  scan_right = R
  scan_w = scan_right - scan_left
  h_band = bottom - top
  if scan_w < 150 or h_band < 100:
    return None

  band_img = bitblt_to_image(scan_left, top, scan_w, h_band).convert('L')
  # 降采样，提速+去噪
  down_w = 400
  ratio = scan_w / down_w
  if scan_w > down_w:
    band_img = band_img.resize((down_w, max(50, int(h_band / ratio))), Image.BILINEAR)
  else:
    down_w = scan_w
    ratio = 1.0

  # 每列灰度均值 -> 相邻差的绝对值作为“边界强度”
  cols = [ImageStat.Stat(band_img.crop((i, 0, i+1, band_img.height))).mean[0] for i in range(down_w)]
  diffs = [abs(cols[i] - cols[i-1]) for i in range(1, down_w)]

  # 在右侧 30%~80% 范围找最强竖线（避免中间气泡干扰）
  lo = int(down_w * 0.30)
  hi = int(down_w * 0.80)
  if hi <= lo: lo, hi = 0, down_w - 1
  best_idx = max(range(lo+1, hi), key=lambda i: diffs[i], default=None)
  if best_idx is None:
    return None

  mean_diff = sum(diffs) / max(1, len(diffs))
  if diffs[best_idx] < mean_diff * 2.2:  # 阈值可调
    return None

  x_in_scan = int(best_idx * ratio)
  x_screen = scan_left + x_in_scan
  if x_screen < L + int(w * 0.60):
    return None
  return x_screen

def compute_wecom_chat_rect(client_rect, override=None):
  """
  从企业微信客户区按比例 + 右栏动态检测，计算聊天内容区
  返回: (x, y, w, h, ratios) 或 None
  """
  L, T, R, B = client_rect
  w = max(0, R - L); h = max(0, B - T)
  if w < MIN_W or h < MIN_H:
    return None

  ratios = dict(LAYOUT_WECOM)
  if override: ratios.update(override)

  left   = L + int(w * (ratios["left_rail_w"] + ratios["contact_list_w"]))
  top    = T + int(h * ratios["header_h"])
  right0 = R - int(w * ratios["right_sidebar_w"])
  bottom = B - int(h * ratios["inputbox_h"])

  # 动态检测右侧分界线，修正 right
  x_div = detect_right_sidebar_x(client_rect, ratios)
  right = right0
  if x_div and (L + int(w*0.60)) < x_div < (R - 10):
    right = x_div

  cw = max(1, right - left)
  ch = max(1, bottom - top)

  if cw < MIN_W or ch < MIN_H:
    # 兜底：给出相对居中的矩形，避免比例误差导致过小
    left   = L + int(w * 0.25)
    top    = T + int(h * 0.10)
    right  = R - int(w * 0.02)
    bottom = B - int(h * 0.22)
    cw = max(1, right - left)
    ch = max(1, bottom - top)
    if cw < MIN_W or ch < MIN_H:
      return None

  return (left, top, cw, ch, ratios)

# ---------------- 手动区域兜底（与你原逻辑一致） ----------------
import tkinter as tk

def select_area_gui():
  class AreaSelector:
    def __init__(self):
      self.root = tk.Tk()
      self.root.attributes('-fullscreen', True)
      self.root.attributes('-alpha', 0.3)
      self.root.config(bg='gray')
      self.start_x = self.start_y = self.end_x = self.end_y = 0
      self.rect = None
      self.canvas = tk.Canvas(self.root, cursor="cross", bg="gray", highlightthickness=0)
      self.canvas.pack(fill=tk.BOTH, expand=True)
      self.canvas.bind("<ButtonPress-1>", self.on_press)
      self.canvas.bind("<B1-Motion>", self.on_drag)
      self.canvas.bind("<ButtonRelease-1>", self.on_release)

    def on_press(self, e):
      self.start_x = self.canvas.canvasx(e.x)
      self.start_y = self.canvas.canvasy(e.y)
      if self.rect: self.canvas.delete(self.rect)
      self.rect = self.canvas.create_rectangle(self.start_x, self.start_y, self.start_x, self.start_y, outline='red', width=2)

    def on_drag(self, e):
      cx = self.canvas.canvasx(e.x); cy = self.canvas.canvasy(e.y)
      self.canvas.coords(self.rect, self.start_x, self.start_y, cx, cy)

    def on_release(self, e):
      self.end_x = self.canvas.canvasx(e.x); self.end_y = self.canvas.canvasy(e.y)
      self.root.quit()

    def get_area(self):
      self.root.mainloop()
      x1 = int(min(self.start_x, self.end_x)); y1 = int(min(self.start_y, self.end_y))
      x2 = int(max(self.start_x, self.end_x)); y2 = int(max(self.start_y, self.end_y))
      w = x2 - x1; h = y2 - y1
      self.root.destroy()
      return (x1, y1, w, h)

  print("请用鼠标框选截图区域（左键按住拖拽，松手确定）")
  sel = AreaSelector()
  x, y, w, h = sel.get_area()
  print(f"已标记区域: x={x}, y={y}, width={w}, height={h}")
  return (x, y, w, h)

def load_area_config():
  if os.path.exists(AREA_CONFIG_FILE):
    with open(AREA_CONFIG_FILE, "r", encoding="utf-8") as f:
      return json.load(f)
  else:
    x, y, w, h = select_area_gui()
    area = {"x": x, "y": y, "width": w, "height": h}
    with open(AREA_CONFIG_FILE, "w", encoding="utf-8") as f:
      json.dump(area, f)
    return area

# ---------------- OCR 清洗（保持你的规则） ----------------
def ocr_wechat(img_path):
  text = baidu_ocr(img_path)
  return clean_ocr_text(text)

def clean_ocr_text(text):
  # 先全局去掉干扰词
  text = re.sub(r'(发起收款|客户转账|商品图册|直播)', '', text)
  # 去掉“星期几/周几 + 时间”
  # 去掉“昨天/前天 + 时间”（含可选上午/下午/中午/晚上，支持可选秒）
  # 示例：昨天23:49、前天 08:12、昨天 下午 3:05、前天 21:30:10
  text = re.sub(
    r'(?:昨|前)天\s*(?:上午|中午|下午|晚上)?\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?',
    '',
    text
  )

  # 去掉“星期几/周几 + 时间”
  text = re.sub(r'(星期[一二三四五六日天]|周[一二三四五六日天])\s*\d{1,2}[:：]\d{2}', '', text)

  lines = text.splitlines()
  out = []
  for i, line in enumerate(lines):
    s = (line or '').strip()
    if not s:
      continue
    # 去掉纯时间行
    if re.match(r'^\d{1,2}[:：]\d{2}$', s):
      continue
    # 去掉 [表情] 或 【表情】
    if re.match(r'^[\[\【][^\[\]【】]{1,6}[\]\】]$', s):
      continue
    # 去掉常见无关提示行
    if re.search(r'(图片|文件|视频|表情|动图|拍摄|语音|聊天)', s):
      continue
    # 英文昵称短行
    if re.match(r'^[A-Za-z|_\- ]{2,12}$', s):
      prev = lines[i-1].strip() if i>0 else ''
      nxt  = lines[i+1].strip() if i<len(lines)-1 else ''
      if prev or nxt:
        continue
    # 保留含中英文数字的行
    if re.search(r'[\u4e00-\u9fa5A-Za-z0-9]', s):
      out.append(s)
  return '\n'.join(out)

# ---------------- HTTP 服务 ----------------
class ScreenshotOCRHandler(BaseHTTPRequestHandler):
  def _json(self, status=200, data=None):
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.end_headers()
    self.wfile.write(json.dumps(data or {}, ensure_ascii=False).encode("utf-8"))

  def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    if parsed.path == "/screenshot_ocr":
      qs = urllib.parse.parse_qs(parsed.query)
      img   = qs.get("img",   ["wecom.png"])[0]
      debug = qs.get("debug", ["0"])[0] == "1"

      # 可选：通过查询参数临时微调比例（0~0.9）
      def fget(key):
        try: return float(qs.get(key,[None])[0])
        except: return None
      override = {}
      for k in ["left_rail_w","contact_list_w","header_h","inputbox_h","right_sidebar_w"]:
        v = fget(k)
        if v is not None and 0 <= v < 0.9:
          override[k] = v

      area_used = None
      try:
        hwnd = find_wecom_hwnd()
        if hwnd:
          client_rc = get_client_rect(hwnd)  # (L,T,R,B)
          computed = compute_wecom_chat_rect(client_rc, override if override else None)
          if computed:
            x, y, w, h, ratios = computed
            ok = save_region_png(img, x, y, w, h)
            if ok:
              area_used = {"x": x, "y": y, "width": w, "height": h,
                           "mode": "auto-wecom", "hwnd": int(hwnd), "ratios": ratios}
              if debug:
                L, T, R, B = client_rc
                whole = bitblt_to_image(L, T, R-L, B-T).convert('RGB')
                drw = ImageDraw.Draw(whole)
                drw.rectangle([x-L, y-T, x-L+w, y-T+h], outline=(255,0,0), width=4)
                whole.save(os.path.splitext(img)[0] + "_debug.png")
      except Exception:
        pass

      if area_used is None:
        # 自动失败 -> 回退手动区域
        area = load_area_config()
        if not save_region_png(img, area["x"], area["y"], area["width"], area["height"]):
          self._json(500, {"status":"error","message":"Screenshot failed."})
          return
        area_used = dict(area, **{"mode":"manual"})

      text = ocr_wechat(img)
      self._json(200, {"status":"ok","file":img,"text":text,"area":area_used})

    elif parsed.path == "/reset_area":
      x, y, w, h = select_area_gui()
      area = {"x":x,"y":y,"width":w,"height":h}
      with open(AREA_CONFIG_FILE,"w",encoding="utf-8") as f:
        json.dump(area, f)
      self._json(200, {"status":"ok","area":area})
    else:
      self.send_response(404)
      self.end_headers()
      self.wfile.write(b"Not found.")

def run_server():
  server = HTTPServer(("127.0.0.1", 5678), ScreenshotOCRHandler)
  print("已启动：仅支持企业微信聊天内容区自动截图；失败回退手动区域(area.json)")
  print("接口：   http://127.0.0.1:5678/screenshot_ocr?img=wecom.png")
  print("调试图： http://127.0.0.1:5678/screenshot_ocr?img=wecom.png&debug=1  （生成 wecom_debug.png）")
  print("重选区域：http://127.0.0.1:5678/reset_area")
  server.serve_forever()

if __name__ == "__main__":
  run_server()