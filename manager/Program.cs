using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

/// <summary>
/// dsh-thirdparty-memory 记忆管理器（Windows 桌面壳）。
///
/// 双击即用：确保本地记忆页服务在跑 → 用默认浏览器打开记忆页 → 在托盘常驻。
/// 命令行：
///   dsh-memory-manager.exe                 启动并打开记忆页（托盘常驻）
///   dsh-memory-manager.exe --start         只启动服务，不开浏览器
///   dsh-memory-manager.exe --stop          停止服务后退出
///   dsh-memory-manager.exe --restart       重启服务并打开记忆页
///   dsh-memory-manager.exe --status        健康检查（退出码 0 = 正常）
///   dsh-memory-manager.exe --no-tray       启动并打开浏览器后立即退出（不常驻托盘）
/// 可选参数：
///   --port <n>    --host <ip>    --data <memory.json 路径>
/// 退出码：0 正常 / 1 失败 / 2 已在运行（仅 --start）
/// </summary>
static class Program
{
    const string DefaultHost = "127.5.0.1";
    const int DefaultPort = 7891;
    const string MutexName = "Global\\dsh-thirdparty-memory-manager";

    static string appDir;
    static string host = DefaultHost;
    static int port = DefaultPort;
    static string dataFile = "";

    [STAThread]
    static int Main(string[] argv)
    {
        appDir = Path.GetDirectoryName(Application.ExecutablePath);
        bool stop = false, restart = false, statusOnly = false, noTray = false, openPage = true, silent = false;
        for (int i = 0; i < argv.Length; i++)
        {
            string a = argv[i].ToLowerInvariant();
            switch (a)
            {
                case "--stop": stop = true; openPage = false; silent = true; break;
                case "--start": openPage = false; silent = true; break;
                case "--restart": restart = true; break;
                case "--status": statusOnly = true; openPage = false; silent = true; break;
                case "--no-tray": noTray = true; break;
                case "--port":
                    if (i + 1 < argv.Length) int.TryParse(argv[++i], out port);
                    break;
                case "--host":
                    if (i + 1 < argv.Length) host = argv[++i];
                    break;
                case "--data":
                    if (i + 1 < argv.Length) dataFile = argv[++i];
                    break;
                case "--help":
                case "-h":
                    MessageBox.Show(HelpText(), "dsh 记忆管理器", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
            }
        }

        if (statusOnly) return Healthy() ? 0 : 1;

        if (stop || restart)
        {
            StopServer();
            if (stop) return 0;
        }

        if (!Healthy())
        {
            string error = StartServer();
            if (error != null)
            {
                if (!silent) MessageBox.Show(error, "dsh 记忆管理器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            for (int i = 0; i < 60 && !Healthy(); i++) Thread.Sleep(100);
            if (!Healthy())
            {
                const string message = "记忆页服务没能启动。\n请检查 node.exe 是否在本程序同目录（或已安装 Node.js）。";
                if (!silent) MessageBox.Show(message, "dsh 记忆管理器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
        else if (silent && openPage == false && !restart)
        {
            return 2; // 已经在跑
        }

        if (openPage) OpenPage();
        if (!openPage || noTray)
        {
            if (noTray && openPage) return 0;
            if (!openPage) return 0;
        }

        bool created;
        using (var mutex = new Mutex(true, MutexName, out created))
        {
            if (!created)
            {
                OpenPage();
                return 0;
            }
            RunTray();
        }
        return 0;
    }

    static string HelpText()
    {
        return "dsh 记忆管理器 —— 本地长期记忆的快速开关\n\n"
             + "双击：启动记忆页并在浏览器打开，托盘常驻\n"
             + "--start    只启动服务\n"
             + "--stop     停止服务\n"
             + "--restart  重启服务并打开\n"
             + "--status   健康检查（退出码 0 = 正常）\n"
             + "--no-tray  打开后不常驻托盘\n"
             + "--port/--host/--data  覆盖端口 / 地址 / 数据文件\n\n"
             + "记忆页地址：http://" + host + ":" + port + "/";
    }

    // ── 服务控制 ────────────────────────────────────────────────────────────
    static bool Healthy()
    {
        try
        {
            using (var client = new TcpClient())
            {
                IAsyncResult ar = client.BeginConnect(host, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(400)) return false;
                client.EndConnect(ar);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    static string ResolveNode()
    {
        string[] candidates =
        {
            Path.Combine(appDir, "node.exe"),
            Path.Combine(appDir, "node", "node.exe"),
            Path.Combine(appDir, "runtime", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                @".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"),
            @"C:\Program Files\nodejs\node.exe",
        };
        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in path.Split(';'))
        {
            if (dir.Trim().Length == 0) continue;
            string candidate = Path.Combine(dir.Trim(), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    static string StartServer()
    {
        string server = Path.Combine(appDir, "server.js");
        if (!File.Exists(server)) return "找不到 server.js：\n" + server;
        string node = ResolveNode();
        if (node == null) return "找不到 node.exe。请把 node.exe 放到本程序同目录，或安装 Node.js。";
        try
        {
            var info = new ProcessStartInfo(node, "\"" + server + "\"")
            {
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            info.EnvironmentVariables["MEMORY_PAGE_HOST"] = host;
            info.EnvironmentVariables["MEMORY_PAGE_PORT"] = port.ToString();
            if (dataFile.Length > 0) info.EnvironmentVariables["MEMORY_DATA_FILE"] = dataFile;
            Process.Start(info);
            return null;
        }
        catch (Exception error)
        {
            return "启动失败：" + error.Message;
        }
    }

    static int StopServer()
    {
        int killed = 0;
        try
        {
            string query = "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'";
            using (var searcher = new ManagementObjectSearcher(query))
            {
                foreach (ManagementObject item in searcher.Get())
                {
                    string commandLine = Convert.ToString(item["CommandLine"]);
                    if (commandLine == null || commandLine.IndexOf("server.js", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (commandLine.IndexOf(appDir, StringComparison.OrdinalIgnoreCase) < 0
                        && commandLine.IndexOf("dsh-thirdparty", StringComparison.OrdinalIgnoreCase) < 0
                        && commandLine.IndexOf("memory", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    try
                    {
                        Process.GetProcessById(Convert.ToInt32(item["ProcessId"])).Kill();
                        killed++;
                    }
                    catch { }
                }
            }
        }
        catch { }
        return killed;
    }

    static void OpenPage()
    {
        try
        {
            Process.Start(new ProcessStartInfo("http://" + host + ":" + port + "/") { UseShellExecute = true });
        }
        catch (Exception error)
        {
            MessageBox.Show("打开浏览器失败：" + error.Message + "\n请手动访问 http://" + host + ":" + port + "/",
                "dsh 记忆管理器", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    static void OpenDataFile()
    {
        string path = dataFile.Length > 0 ? dataFile : Path.Combine(appDir, "data", "memory.json");
        try
        {
            if (!File.Exists(path)) MessageBox.Show("还没有数据文件：\n" + path, "dsh 记忆管理器");
            else Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            MessageBox.Show("打开失败：" + error.Message, "dsh 记忆管理器");
        }
    }

    // ── 破坏性操作：二次确认（一次点击不算确认）──────────────────────────
    static bool ConfirmTwice(string title, string first, string second)
    {
        if (MessageBox.Show(first, title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2) != DialogResult.Yes) return false;
        return MessageBox.Show(second, title, MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                   MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    static string PostJson(string path, string json)
    {
        try
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                client.Headers[HttpRequestHeader.ContentType] = "application/json; charset=utf-8";
                return client.UploadString("http://" + host + ":" + port + path, "POST", json);
            }
        }
        catch
        {
            return null;
        }
    }

    static void WipeMemories()
    {
        const string title = "dsh 记忆管理器";
        if (!ConfirmTwice(title, "这会删除全部记忆，且不可恢复。\n\n确定要清空吗？",
                "最后一次确认：真的要清空全部记忆？")) return;
        if (!Healthy())
        {
            StartServer();
            for (int i = 0; i < 50 && !Healthy(); i++) Thread.Sleep(100);
        }
        string result = PostJson("/api/wipe", "{\"confirm\":\"WIPE\"}");
        if (result == null)
            MessageBox.Show("清空失败：记忆页服务没有响应。", title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        else
            MessageBox.Show("已清空全部记忆。", title, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    // ── 托盘 ────────────────────────────────────────────────────────────────
    static void RunTray()
    {
        Application.EnableVisualStyles();
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开记忆页", null, (s, e) => OpenPage());
        menu.Items.Add("复制地址", null, (s, e) => Clipboard.SetText("http://" + host + ":" + port + "/"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("重启记忆页服务", null, (object s, EventArgs e) =>
        {
            StopServer();
            Thread.Sleep(400);
            StartServer();
            for (int i = 0; i < 40 && !Healthy(); i++) Thread.Sleep(100);
            OpenPage();
        });
        menu.Items.Add("停止记忆页服务", null, (s, e) => StopServer());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("清空所有记忆…（二次确认）", null, (s, e) => WipeMemories());
        menu.Items.Add("打开数据文件", null, (s, e) => OpenDataFile());
        menu.Items.Add("数据目录", null, (object s, EventArgs e) =>
        {
            try { Process.Start("explorer.exe", "\"" + Path.Combine(appDir, "data") + "\""); } catch { }
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (s, e) => Application.Exit());

        var tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "DSH 记忆管理器 · http://" + host + ":" + port + "/",
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (s, e) => OpenPage();
        tray.BalloonTipTitle = "DSH 记忆管理器";
        tray.BalloonTipText = "记忆页已在运行，双击图标即可打开。";
        try { tray.ShowBalloonTip(2500); } catch { }
        Application.ApplicationExit += (s, e) => { tray.Visible = false; tray.Dispose(); };
        Application.Run();
    }
}
