using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

static class Program
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            var mode = (args != null && args.Length > 0) ? (args[0] ?? "").ToLowerInvariant() : "paste";
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return 2;

            // 检查前台进程是否 QQ/QQNT/QQEX
            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == 0) return 2;
            string baseName = "";
            try { using (var p = Process.GetProcessById((int)pid)) baseName = (p.MainModule?.ModuleName ?? ""); } catch { }
            var lower = (baseName ?? "").Trim().ToLowerInvariant();
            if (lower != "qq.exe" && lower != "qqnt.exe" && lower != "qqex.exe")
            {
                // 只对 QQ/QQNT/QQEX 生效；非 QQ 返回特殊码，不执行任何操作
                return 3;
            }

            // 置前
            try { SetForegroundWindow(hwnd); } catch { }
            Thread.Sleep(60);

            AutomationElement root = null;
            try { root = AutomationElement.FromHandle(hwnd); } catch { }
            AutomationElement editor = null;
            try
            {
                if (root != null)
                {
                    var cond = new OrCondition(
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document)
                    );
                    editor = root.FindFirst(TreeScope.Descendants, cond);

                    if (editor != null)
                    {
                        bool focusable = false;
                        try { focusable = editor.Current.IsEnabled && editor.Current.IsKeyboardFocusable; } catch { }
                        if (focusable)
                        {
                            try { editor.SetFocus(); } catch { }
                            Thread.Sleep(60);
                        }
                    }
                }
            }
            catch { }

            try { SendKeys.SendWait("^{v}"); } catch { }
            Thread.Sleep(80);
            if (mode == "paste-send" || mode == "send")
            {
                try { SendKeys.SendWait("~"); } catch { }
            }

            return 0;
        }
        catch
        {
            return 1;
        }
    }
}