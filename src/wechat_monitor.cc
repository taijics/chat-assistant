// Clean, ASCII-only source to avoid codepage issues.
#include <napi.h>
#include <windows.h>
#include <dwmapi.h>
#include <string>
#include <vector>
#include <atomic>
#include <mutex>
#include <thread>
#include <algorithm>
#include <map>

#pragma comment(lib, "dwmapi.lib")

static std::vector<std::wstring> g_keywords_lower;
static std::mutex g_enumMutex;
static std::map<HWND, std::wstring> g_chatHwndMap;

static HWINEVENTHOOK g_hookLoc = nullptr;
static HWINEVENTHOOK g_hookFg = nullptr;
static HWINEVENTHOOK g_hookMin = nullptr;
static HWINEVENTHOOK g_hookDestroy = nullptr;

static std::atomic<bool> g_running(false);

static Napi::ThreadSafeFunction g_tsfn;
static bool g_tsfn_inited = false;
static UINT_PTR g_retryTimer = 0;
static HWND g_messageWindow = nullptr;

// Allowed process base names (lowercase)
static const wchar_t* kAllowedProcNames[] = {
  L"wechat.exe", L"wechatapp.exe", L"wechatappex.exe", L"weixin.exe",
  L"wework.exe", L"企业微信.exe", L"telegram.exe", L"telegram desktop.exe", L"whatsapp.exe"
};

enum EventType {
  EVT_FOUND, EVT_POSITION, EVT_FOREGROUND, EVT_MINIMIZED, EVT_RESTORED, EVT_DESTROYED
};

struct EventPayload {
  EventType type;
  HWND hwnd;
  RECT rect;
  std::wstring procName;
};

static std::wstring ToLower(const std::wstring& s) {
  std::wstring r = s;
  std::transform(r.begin(), r.end(), r.begin(), towlower);
  return r;
}

static bool IsWindowCloaked(HWND hwnd) {
  BOOL cloaked = FALSE;
  HRESULT hr = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
  return SUCCEEDED(hr) && cloaked;
}

static bool GetProcessBaseNameLower(HWND hwnd, std::wstring& outLowerBase) {
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (!pid) return false;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return false;
  std::wstring path; path.resize(1024);
  DWORD size = static_cast<DWORD>(path.size());
  BOOL ok = QueryFullProcessImageNameW(h, 0, path.data(), &size);
  CloseHandle(h);
  if (!ok || size == 0) return false;
  path.resize(size);
  size_t pos = path.find_last_of(L"\\/");
  std::wstring base = (pos == std::wstring::npos) ? path : path.substr(pos + 1);
  outLowerBase = ToLower(base);
  return !outLowerBase.empty();
}

static void FireEvent(EventType t, HWND hwnd, const std::wstring& procName) {
  if (!g_tsfn_inited) return;
  RECT r{0,0,0,0};
  if (IsWindow(hwnd)) GetWindowRect(hwnd, &r);
  auto* payload = new EventPayload{ t, hwnd, r, procName };
  g_tsfn.BlockingCall(payload, [](Napi::Env env, Napi::Function cb, EventPayload* data){
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("hwnd", Napi::Number::New(env, (uintptr_t)data->hwnd));
    obj.Set("x", Napi::Number::New(env, data->rect.left));
    obj.Set("y", Napi::Number::New(env, data->rect.top));
    obj.Set("width", Napi::Number::New(env, data->rect.right - data->rect.left));
    obj.Set("height", Napi::Number::New(env, data->rect.bottom - data->rect.top));
    obj.Set("procName", Napi::String::New(env, std::string(data->procName.begin(), data->procName.end())));
    const char* typeStr = "";
    switch (data->type) {
      case EVT_FOUND: typeStr = "found"; break;
      case EVT_POSITION: typeStr = "position"; break;
      case EVT_FOREGROUND: typeStr = "foreground"; break;
      case EVT_MINIMIZED: typeStr = "minimized"; break;
      case EVT_RESTORED: typeStr = "restored"; break;
      case EVT_DESTROYED: typeStr = "destroyed"; break;
    }
    obj.Set("type", typeStr);
    cb.Call({ obj });
    delete data;
  });
}

static bool IsWeChatCandidate(HWND hwnd) {
  if (!IsWindow(hwnd)) return false;
  if (!IsWindowVisible(hwnd)) return false;
  if (IsWindowCloaked(hwnd)) return false;
  std::wstring baseLower;
  if (GetProcessBaseNameLower(hwnd, baseLower)) {
    if (baseLower == L"telegram desktop.exe" || baseLower == L"whatsapp.exe" || baseLower == L"telegram.exe") return true;
    if (GetWindow(hwnd, GW_OWNER) != NULL) return false;
    for (auto pn : kAllowedProcNames) {
      if (baseLower == pn) return true;
    }
  }
  wchar_t title[512] = {0};
  GetWindowTextW(hwnd, title, 512);
  std::wstring tl = ToLower(std::wstring(title));
  for (auto &kw : g_keywords_lower) {
    if (!kw.empty() && tl.find(kw) != std::wstring::npos) return true;
  }
  return false;
}

struct FindState { std::map<HWND, std::wstring> foundWindows; };

static BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
  FindState* st = reinterpret_cast<FindState*>(lParam);
  if (!st) return FALSE;
  if (IsWeChatCandidate(hwnd)) {
    std::wstring baseLower;
    if (GetProcessBaseNameLower(hwnd, baseLower)) {
      RECT r;
      if (GetWindowRect(hwnd, &r)) {
        LONG w = r.right - r.left;
        LONG h = r.bottom - r.top;
        if (w > 50 && h > 50) {
          st->foundWindows[hwnd] = baseLower;
        }
      }
    }
  }
  return TRUE;
}

static void TryFindWeChat() {
  std::lock_guard<std::mutex> lock(g_enumMutex);
  FindState st;
  EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&st));
  for (const auto& kv : st.foundWindows) {
    if (g_chatHwndMap.find(kv.first) == g_chatHwndMap.end()) {
      FireEvent(EVT_FOUND, kv.first, kv.second);
    }
  }
  g_chatHwndMap = st.foundWindows;
}

static VOID CALLBACK RetryTimerProc(HWND, UINT, UINT_PTR, DWORD) {
  if (!g_running.load()) return;
  TryFindWeChat();
}

static void CALLBACK WinEventProc(HWINEVENTHOOK, DWORD event, HWND hwnd,
                                  LONG idObject, LONG /*idChild*/,
                                  DWORD, DWORD) {
  std::lock_guard<std::mutex> lock(g_enumMutex);
  auto it = g_chatHwndMap.find(hwnd);
  if (it == g_chatHwndMap.end()) return;
  if (idObject != OBJID_WINDOW) return;
  const std::wstring& procName = it->second;
  switch (event) {
    case EVENT_OBJECT_LOCATIONCHANGE: FireEvent(EVT_POSITION, hwnd, procName); break;
    case EVENT_SYSTEM_FOREGROUND:     FireEvent(EVT_FOREGROUND, hwnd, procName); break;
    case EVENT_SYSTEM_MINIMIZESTART:  FireEvent(EVT_MINIMIZED, hwnd, procName); break;
    case EVENT_SYSTEM_MINIMIZEEND:    FireEvent(EVT_RESTORED, hwnd, procName); break;
    case EVENT_OBJECT_DESTROY:
      FireEvent(EVT_DESTROYED, hwnd, procName);
      g_chatHwndMap.erase(hwnd);
      TryFindWeChat();
      break;
    default: break;
  }
}

static LRESULT CALLBACK MessageWndProc(HWND hWnd, UINT msg, WPARAM w, LPARAM l) {
  switch (msg) {
    case WM_DESTROY: PostQuitMessage(0); break;
    default: break;
  }
  return DefWindowProc(hWnd, msg, w, l);
}

static void InitHooks() {
  if (g_hookLoc) return;
  DWORD flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS | WINEVENT_SKIPOWNTHREAD;
  g_hookLoc     = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, NULL, WinEventProc, 0, 0, flags);
  g_hookFg      = SetWinEventHook(EVENT_SYSTEM_FOREGROUND,   EVENT_SYSTEM_FOREGROUND,   NULL, WinEventProc, 0, 0, flags);
  g_hookMin     = SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART,EVENT_SYSTEM_MINIMIZEEND,  NULL, WinEventProc, 0, 0, flags);
  g_hookDestroy = SetWinEventHook(EVENT_OBJECT_DESTROY,      EVENT_OBJECT_DESTROY,      NULL, WinEventProc, 0, 0, flags);
}

static void UnhookAll() {
  if (g_hookLoc) UnhookWinEvent(g_hookLoc);
  if (g_hookFg) UnhookWinEvent(g_hookFg);
  if (g_hookMin) UnhookWinEvent(g_hookMin);
  if (g_hookDestroy) UnhookWinEvent(g_hookDestroy);
  g_hookLoc = g_hookFg = g_hookMin = g_hookDestroy = nullptr;
}

static void WorkerThread() {
  WNDCLASSW wc = {0};
  wc.lpfnWndProc = MessageWndProc;
  wc.hInstance = GetModuleHandle(NULL);
  wc.lpszClassName = L"WeChatMonitorHiddenWindow";
  RegisterClassW(&wc);
  g_messageWindow = CreateWindowW(wc.lpszClassName, L"", 0, 0,0,0,0, HWND_MESSAGE, NULL, wc.hInstance, NULL);
  g_retryTimer = SetTimer(g_messageWindow, 1, 2000, RetryTimerProc);
  InitHooks();
  TryFindWeChat();
  MSG msg;
  while (g_running.load() && GetMessage(&msg, NULL, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }
  if (g_retryTimer) { KillTimer(g_messageWindow, g_retryTimer); g_retryTimer = 0; }
  if (g_messageWindow) { DestroyWindow(g_messageWindow); g_messageWindow = nullptr; }
  UnhookAll();
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Expected (optionsObject, callback)").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (g_running.load()) {
    Napi::Error::New(env, "Already running").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  if (!opts.Has("keywords") || !opts.Get("keywords").IsArray()) {
    Napi::TypeError::New(env, "options.keywords must be an array of strings").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Array arr = opts.Get("keywords").As<Napi::Array>();
  g_keywords_lower.clear();
  for (uint32_t i = 0; i < arr.Length(); ++i) {
    auto v = arr.Get(i);
    if (v.IsString()) {
      std::u16string s = v.As<Napi::String>().Utf16Value();
      const wchar_t* p = reinterpret_cast<const wchar_t*>(s.c_str());
      g_keywords_lower.emplace_back(ToLower(std::wstring(p)));
    }
  }
  Napi::Function cb = info[1].As<Napi::Function>();
  g_tsfn = Napi::ThreadSafeFunction::New(env, cb, "wechat-monitor-callback", 0, 1);
  g_tsfn_inited = true;
  g_running.store(true);
  { std::lock_guard<std::mutex> lock(g_enumMutex); g_chatHwndMap.clear(); }
  std::thread th([](){
    WorkerThread();
    if (g_tsfn_inited) {
      g_tsfn.Release();
      g_tsfn_inited = false;
    }
  });
  th.detach();
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (!g_running.load()) return info.Env().Undefined();
  g_running.store(false);
  if (g_messageWindow) PostMessage(g_messageWindow, WM_CLOSE, 0, 0);
  return info.Env().Undefined();
}

Napi::Value IsRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_running.load());
}

// setZOrder(assistantHandleBuffer: Buffer, wechatHandleNumber: number, chatType: string)
Napi::Value SetZOrder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (assistantHandleBuffer, wechatHandleNumber)").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
  uintptr_t wParam = (uintptr_t) info[1].As<Napi::Number>().Int64Value();

  std::string chatType = (info.Length() >= 3 && info[2].IsString()) ? info[2].As<Napi::String>().Utf8Value() : "";

  HWND assistant = nullptr;
  if (buf.Length() >= sizeof(HWND)) assistant = *reinterpret_cast<HWND*>(buf.Data());
  HWND chatWindow = (HWND) wParam;
  if (!assistant || !chatWindow) return Napi::Boolean::New(env, false);

  HWND insertAfter = chatWindow;
  if (chatType.find("wechat") != std::string::npos || chatType.find("企业微信") != std::string::npos) {
    insertAfter = HWND_TOPMOST;
  }
  BOOL ok = SetWindowPos(
    assistant,
    insertAfter,
    0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING
  );
  return Napi::Boolean::New(env, ok ? true : false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("isRunning", Napi::Function::New(env, IsRunning));
  exports.Set("setZOrder", Napi::Function::New(env, SetZOrder));
  return exports;
}

NODE_API_MODULE(wechat_monitor, Init)