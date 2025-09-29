import sys
import time
import win32gui
import win32ui
import win32con
from PIL import Image

def has_printwindow():
    return hasattr(win32gui, "PrintWindow")

def find_hwnd(title_part):
    def callback(hwnd, hwnds):
        if win32gui.IsWindowVisible(hwnd):
            text = win32gui.GetWindowText(hwnd)
            if title_part.lower() in text.lower():
                hwnds.append(hwnd)
    hwnds = []
    win32gui.EnumWindows(callback, hwnds)
    return hwnds[0] if hwnds else None

def screenshot_printwindow(hwnd, path):
    left, top, right, bot = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bot - top
    hwndDC = win32gui.GetWindowDC(hwnd)
    mfcDC = win32ui.CreateDCFromHandle(hwndDC)
    saveDC = mfcDC.CreateCompatibleDC()
    saveBitMap = win32ui.CreateBitmap()
    saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
    saveDC.SelectObject(saveBitMap)
    result = win32gui.PrintWindow(hwnd, saveDC.GetSafeHdc(), 0)
    bmpinfo = saveBitMap.GetInfo()
    bmpstr = saveBitMap.GetBitmapBits(True)
    im = Image.frombuffer(
        'RGB',
        (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
        bmpstr, 'raw', 'BGRX', 0, 1)
    im.save(path)
    win32gui.DeleteObject(saveBitMap.GetHandle())
    saveDC.DeleteDC()
    mfcDC.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwndDC)
    return result

def screenshot_bitblt(hwnd, path):
    left, top, right, bot = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bot - top
    hwndDC = win32gui.GetWindowDC(hwnd)
    mfcDC = win32ui.CreateDCFromHandle(hwndDC)
    saveDC = mfcDC.CreateCompatibleDC()
    saveBitMap = win32ui.CreateBitmap()
    saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
    saveDC.SelectObject(saveBitMap)
    saveDC.BitBlt((0, 0), (width, height), mfcDC, (0, 0), win32con.SRCCOPY)
    bmpinfo = saveBitMap.GetInfo()
    bmpstr = saveBitMap.GetBitmapBits(True)
    im = Image.frombuffer(
        'RGB',
        (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
        bmpstr, 'raw', 'BGRX', 0, 1)
    im.save(path)
    win32gui.DeleteObject(saveBitMap.GetHandle())
    saveDC.DeleteDC()
    mfcDC.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwndDC)
    return True

def screenshot(hwnd, path):
    if has_printwindow():
        print("使用 PrintWindow 截图")
        ok = screenshot_printwindow(hwnd, path)
        if not ok:
            print("PrintWindow 截图失败，尝试 BitBlt 方案")
            return screenshot_bitblt(hwnd, path)
        return True
    else:
        print("PrintWindow 不可用，使用 BitBlt 截图")
        return screenshot_bitblt(hwnd, path)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python win_screenshot_auto.py <window_title_part> <output_path>")
        sys.exit(1)
    title_part = sys.argv[1]
    output = sys.argv[2]

    print(f"等待窗口标题包含“{title_part}”的程序启动...")

    hwnd = None
    while hwnd is None:
        hwnd = find_hwnd(title_part)
        if hwnd is None:
            time.sleep(2)

    print(f"找到窗口，开始截图: hwnd={hwnd}")
    if screenshot(hwnd, output):
        print("截图成功:", output)
    else:
        print("截图失败。")
        sys.exit(3)