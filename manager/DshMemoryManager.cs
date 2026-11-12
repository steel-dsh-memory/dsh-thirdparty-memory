using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

/// <summary>
/// dsh-thirdparty-memory 单文件管理器（自带 Node 运行时）。
///
/// 首次运行会把内置的 Node + 插件文件解到 %LOCALAPPDATA%\dsh-thirdparty-memory\，
/// 之后双击即用：启动本地记忆页服务 → 打开浏览器 → 托盘常驻。
///
/// 命令行：
///   dsh-memory-manager.exe                 启动并打开记忆页（托盘常驻）
///   --install                              解压 + 接到所有 DSH profile + 启动并打开
///   --start / --stop / --restart / --status
///   --no-tray                              打开后不常驻托盘
///   --port 7900                            自定义端口（会记住；被占用则拒绝启动）
///   --store <dir>                          指定记忆存储目录（见存储规则）
///   --host 127.0.0.1                       自定义监听地址
///   --dir / --data / --version / --help
///
/// 退出码：0 正常 / 1 失败 / 2 已在运行 / 3 端口被其它程序占用（拒绝）
/// </summary>
static class Program
{
    const string Version = "0.4.4";
    const int DefaultPort = 7891;
    const string DefaultHost = "127.5.0.1";
    const string MutexName = "Global\\dsh-thirdparty-memory-manager";

    static string appRoot;
    static string appDir;
    static string runtimeDir;
    static string dataDir;
    static string serverJs;
    static string nodeExe;
    static string dataFile;
    static string configPath;
    static string host = DefaultHost;
    static int port = DefaultPort;
    static string PluginDirOverride = "";
    static string StoreDirOverride = "";
    static string StoreDir = "";
    static string PreviousStoreDir = "";
    static bool Silent = false;
    static bool LangForced = false;

    // 无 BOM 的 UTF-8。带 BOM 的 JSON 会让 DSH 的 readProfileManifest 直接抛
    // SyntaxError（DesktopHostFatalError，启动即崩），任何写 JSON 的地方都必须用它。
    static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

    // 内嵌资源名 → 目标文件名
    static readonly string[,] Resources =
    {
        { "app_index.js", "index.js" },
        { "app_core.js", "core.js" },
        { "app_server.js", "server.js" },
        { "app_ui.html", "ui.html" },
        { "app_patch.yml", "cordis.patch.yml" },
        { "app_package.json", "package.json" },
        { "app_attach.ps1", "attach.ps1" },
        { "app_readme.md", "README.md" },
        { "app_readme_zh_cn.md", "README.zh-CN.md" },
        { "app_readme_zh_tw.md", "README.zh-TW.md" },
        { "app_tutorial.md", "docs\\tutorial.md" },
        { "app_tutorial_zh_cn.md", "docs\\tutorial.zh-CN.md" },
        { "app_tutorial_zh_tw.md", "docs\\tutorial.zh-TW.md" },
        { "app_tutorial.txt", "docs\\tutorial.txt" },
        { "app_tutorial_zh_cn.txt", "docs\\tutorial.zh-CN.txt" },
        { "app_tutorial_zh_tw.txt", "docs\\tutorial.zh-TW.txt" },
        { "app_license.txt", "LICENSE" },
        { "app_node_license.txt", "docs\\NODE-LICENSE.txt" },
    };

    [STAThread]
    static int Main(string[] argv)
    {
        string action = "run";
        bool noTray = false, silent = false;
        for (int i = 0; i < argv.Length; i++)
        {
            string a = argv[i].ToLowerInvariant();
            switch (a)
            {
                case "--install": action = "install"; break;
                case "--start": action = "start"; silent = true; Silent = true; break;
                case "--stop": action = "stop"; silent = true; Silent = true; break;
                case "--restart": action = "restart"; break;
                case "--status": action = "status"; silent = true; Silent = true; break;
                case "--no-tray": noTray = true; break;
                case "--port":
                    if (i + 1 < argv.Length && !int.TryParse(argv[++i], out port))
                    {
                        MessageBox.Show("--port 需要一个数字，例如 --port 7900", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return 1;
                    }
                    break;
                case "--host":
                    if (i + 1 < argv.Length) host = argv[++i];
                    break;
                case "--plugin-dir":
                    if (i + 1 < argv.Length) PluginDirOverride = argv[++i].Trim().TrimEnd('\\', '"');
                    break;
                case "--store":
                    if (i + 1 < argv.Length) StoreDirOverride = argv[++i].Trim().TrimEnd('\\', '"');
                    break;
                case "--lang":
                    if (i + 1 < argv.Length) { string code = argv[++i].Trim(); if (code == "en" || code == "zh-CN" || code == "zh-TW") { Lang = code; LangForced = true; } }
                    break;
                case "--dir": MessageBox.Show(appDir, AppTitle); return 0;
                case "--data": MessageBox.Show(dataFile, AppTitle); return 0;
                case "--version": MessageBox.Show("dsh-thirdparty-memory " + Version, AppTitle); return 0;
                case "--help":
                case "-h":
                    MessageBox.Show(HelpText(), AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
            }
        }

        try
        {
            // 先定位 %LOCALAPPDATA% 与配置文件，把 port / pluginDir 读进来，
            // 再解压（Prepare 依赖 PluginDirOverride，顺序不能反）。
            appRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dsh-thirdparty-memory");
            configPath = Path.Combine(appRoot, "config.json");
            Directory.CreateDirectory(appRoot);
            bool firstRun = !File.Exists(configPath);
            if (!LangForced)
            {
                Lang = LoadStringSetting("lang");
                if (Lang.Length == 0 || !(Lang == "en" || Lang == "zh-CN" || Lang == "zh-TW")) Lang = DetectSystemLang();
            }
            if (LangForced)
            {
                SaveLangOnly();
            }
            else if (firstRun)
            {
                Lang = AskLanguage();
                SaveLangOnly();
            }
            if (PluginDirOverride.Length == 0) PluginDirOverride = LoadStringSetting("pluginDir");
            if (port == DefaultPort)
            {
                int savedPort = LoadPort();
                if (savedPort > 0) port = savedPort;
            }
            Prepare();
        }
        catch (Exception error)
        {
            // 静默模式（--start/--stop/--status）不弹窗，只用退出码表达失败。
            bool storeIssue = error.Message != null && error.Message.Contains("存储目录不合规");
            if (!Silent) MessageBox.Show(L("msg.initFail") + error.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return storeIssue ? 4 : 1;
        }

        if (action != "status") SavePort(port);

        if (action == "status")
        {
            if (PortBusy()) return IsOurServer() ? 0 : 3;
            return 1;
        }

        if (action == "stop" || action == "restart")
        {
            int killed = StopServer();
            if (action == "stop")
            {
                if (!silent) MessageBox.Show(killed > 0 ? L("msg.stopped") : L("msg.notRunning"), AppTitle);
                return 0;
            }
            Thread.Sleep(400);
        }

        if (action == "install")
        {
            string result = RunAttach();
            if (!silent && result != null)
                MessageBox.Show(result, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        // ── 端口占用检测：自己的实例可复用，别人占的必须拒绝 ──────────────────
        if (PortBusy())
        {
            if (!IsOurServer())
            {
                string busy = "端口 " + port + " 已被其它程序占用，记忆页没有启动。\n\n"
                    + "请换一个端口，例如：\n    dsh-memory-manager.exe --port 7900\n"
                    + "或在托盘菜单里选「更换端口…」。";
                if (!silent) MessageBox.Show(busy, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 3;
            }
        }
        else
        {
            string error = StartServer();
            if (error != null)
            {
                if (!silent) MessageBox.Show(error, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            for (int i = 0; i < 80 && !Healthy(); i++) Thread.Sleep(100);
            if (!Healthy())
            {
                string message = "记忆页服务没能启动（端口 " + port + "）。\n"
                    + "可以换端口重试：--port 7900";
                if (!silent) MessageBox.Show(message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        if (action == "start") return 0;

        OpenPage();
        if (noTray) return 0;

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

    // ── 界面语言：英文为根（索引 0），另有简体/繁体中文 ────────────────────
    static readonly string[] LangCodes = { "en", "zh-CN", "zh-TW" };
    static readonly Dictionary<string, string[]> L10N = new Dictionary<string, string[]>
    {
        { "tray.title", new[] { "DSH Memory Manager", "DSH 记忆管理器", "DSH 記憶管理器" } },
        { "tray.open", new[] { "Open memory page", "打开记忆页", "開啟記憶頁" } },
        { "tray.copy", new[] { "Copy address", "复制地址", "複製位址" } },
        { "tray.store", new[] { "Storage location…", "记忆存储位置…", "記憶儲存位置…" } },
        { "tray.openstore", new[] { "Open storage folder", "打开存储目录", "開啟儲存資料夾" } },
        { "tray.port", new[] { "Change port…", "更换端口…", "更換連接埠…" } },
        { "tray.restart", new[] { "Restart service", "重启记忆页服务", "重新啟動記憶頁服務" } },
        { "tray.stop", new[] { "Stop service", "停止记忆页服务", "停止記憶頁服務" } },
        { "tray.attach", new[] { "Attach to DSH…", "接到 DSH（安装插件）…", "接到 DSH（安裝外掛）…" } },
        { "tray.openapp", new[] { "Open install folder", "打开安装目录", "開啟安裝目錄" } },
        { "tray.lang", new[] { "Language", "语言", "語言" } },
        { "tray.quit", new[] { "Quit (keep service)", "退出（保留服务）", "結束（保留服務）" } },
        { "lang.choose", new[] { "Choose UI language", "选择界面语言", "選擇介面語言" } },
        { "lang.hint", new[] { "You can switch later from the tray menu.", "之后可在托盘菜单随时切换。", "之後可在系統匣選單隨時切換。" } },
        { "msg.initFail", new[] { "Initialization failed: ", "初始化失败：", "初始化失敗：" } },
        { "msg.portBusy", new[] { "Port {0} is used by another program; the memory page was not started.\n\nTry: dsh-memory-manager.exe --port 7900\n(or “Change port…” in the tray menu)", "端口 {0} 已被其它程序占用，记忆页没有启动。\n\n可换端口：dsh-memory-manager.exe --port 7900\n或用托盘菜单的「更换端口…」", "連接埠 {0} 已被其他程式佔用，記憶頁沒有啟動。\n\n可換連接埠：dsh-memory-manager.exe --port 7900\n或用系統匣選單的「更換連接埠…」" } },
        { "msg.storeRule", new[] { "Storage folder not allowed: ", "存储目录不合规：", "儲存目錄不合規：" } },
        { "msg.storeEmpty", new[] { "Storage folder cannot be empty.", "存储目录不能为空。", "儲存目錄不能為空。" } },
        { "msg.driveMissing", new[] { "Drive does not exist: ", "盘符不存在：", "磁碟機不存在：" } },
        { "msg.rootNo", new[] { "Do not use a bare drive root; pick a subfolder.", "不允许直接用盘符根目录，请选一个子目录。", "不允許直接用磁碟機根目錄，請選一個子資料夾。" } },
        { "msg.asciiOnly", new[] { "Folder names may only use A-Z a-z 0-9 space _ - .  Offending: ", "目录名只允许英文字母、数字、空格、下划线、短横线和点。违规段：", "資料夾名稱只允許英文字母、數字、空格、底線、短橫線和點。違規段：" } },
        { "msg.notEmpty", new[] { "Target folder is not empty: ", "目标目录不是空目录：", "目標目錄不是空目錄：" } },
        { "msg.notEmptyHint", new[] { "\nPick an empty folder or create one.", "\n请选一个空目录（或新建一个）。", "\n請選一個空目錄（或新建一個）。" } },
        { "msg.sameDir", new[] { "That is already the current storage folder.", "这就是当前的存储目录。", "這就是目前的儲存目錄。" } },
        { "msg.pickStore", new[] { "Pick a storage folder: existing drive + ASCII-only folder name + empty folder", "选择记忆存储目录：现有盘符 + 纯英文目录名 + 空目录", "選擇記憶儲存目錄：現有磁碟機 + 純英文資料夾名稱 + 空目錄" } },
        { "msg.migrateQ", new[] { "The old folder still holds {0} memories:\n{1}\n\nCopy them into the new folder?\nYes = copy, No = switch only, Cancel = abort", "旧目录里还有 {0} 条记忆：\n{1}\n\n要迁移到新目录吗？\n是 = 复制，否 = 只切换，取消 = 放弃", "舊目錄裡還有 {0} 條記憶：\n{1}\n\n要遷移到新目錄嗎？\n是 = 複製，否 = 只切換，取消 = 放棄" } },
        { "msg.storeDone", new[] { "Storage folder switched to:\n{0}\n\n{1}\n\nRestart DSH so the plugin uses it too.", "存储目录已切换到：\n{0}\n\n{1}\n\n重启 DSH 后插件也会使用这个目录。", "儲存目錄已切換到：\n{0}\n\n{1}\n\n重新啟動 DSH 後外掛也會使用這個目錄。" } },
        { "msg.migrated", new[] { "Copied {0} memories.", "已迁移 {0} 条记忆。", "已遷移 {0} 條記憶。" } },
        { "msg.notMigrated", new[] { "Old data left in place.", "未迁移旧数据（仍在原处）。", "未遷移舊資料（仍在原處）。" } },
        { "msg.storeFail", new[] { "Switch failed: ", "切换失败：", "切換失敗：" } },
        { "msg.stopped", new[] { "Memory page stopped.", "记忆页已停止。", "記憶頁已停止。" } },
        { "msg.notRunning", new[] { "No memory page was running.", "没有正在运行的记忆页。", "沒有正在執行的記憶頁。" } },
        { "msg.startFail", new[] { "Failed to start: ", "启动失败：", "啟動失敗：" } },
        { "msg.startFailHint", new[] { "The memory page could not start (port {0}).", "记忆页服务没能启动（端口 {0}）。", "記憶頁服務沒能啟動（連接埠 {0}）。" } },
        { "msg.browserFail", new[] { "Could not open the browser: ", "打开浏览器失败：", "開啟瀏覽器失敗：" } },
        { "msg.manualUrl", new[] { "\nOpen manually: ", "\n请手动访问 ", "\n請手動開啟 " } },
        { "msg.portPrompt", new[] { "Enter a new port (1-65535).\nCurrent: {0}", "输入新的端口（1–65535）。\n当前：{0}", "輸入新的連接埠（1–65535）。\n目前：{0}" } },
        { "msg.portTitle", new[] { "Change port", "更换端口", "更換連接埠" } },
        { "msg.portBusyShort", new[] { "Port {0} is used by another program; kept the old port.", "端口 {0} 已被其它程序占用，未切换。", "連接埠 {0} 已被其他程式佔用，未切換。" } },
        { "msg.attachDone", new[] { "Plugin attached to detected DSH profiles.\n\n", "已把插件接到检测到的 DSH profile。\n\n", "已把外掛接到偵測到的 DSH profile。\n\n" } },
        { "msg.attachNext", new[] { "\n\nNext: restart DSH (bundles load at boot).", "\n\n下一步：重启 DSH（bundle 只在启动时读取）。", "\n\n下一步：重新啟動 DSH（bundle 只在啟動時讀取）。" } },
        { "msg.attachFail", new[] { "Attach failed: ", "接线失败：", "接線失敗：" } },
        { "msg.attachMissing", new[] { "attach.ps1 is missing; cannot attach.", "缺少 attach.ps1，无法接线。", "缺少 attach.ps1，無法接線。" } },
        { "msg.wipeGone", new[] { "Bulk deletion was removed on purpose: delete memories one by one in the memory page.", "按设计已取消批量清空：请在记忆页里逐条删除。", "依設計已取消批次清空：請在記憶頁裡逐條刪除。" } },
        { "help.title", new[] { "DSH Memory Manager", "DSH 记忆管理器", "DSH 記憶管理器" } },
        { "btn.ok", new[] { "OK", "确定", "確定" } },
        { "btn.cancel", new[] { "Cancel", "取消", "取消" } },
    };

    static string Lang = "en";

    static int LangIndex()
    {
        for (int i = 0; i < LangCodes.Length; i++) if (LangCodes[i] == Lang) return i;
        return 0;
    }

    static string L(string key)
    {
        string[] row;
        if (!L10N.TryGetValue(key, out row)) return key;
        int index = LangIndex();
        return row[index] ?? row[0];
    }

    static string L(string key, params object[] args)
    {
        string text = L(key);
        try { return string.Format(text, args); } catch { return text; }
    }

    static string DetectSystemLang()
    {
        try
        {
            string name = System.Globalization.CultureInfo.CurrentUICulture.Name.ToLowerInvariant();
            if (name.StartsWith("zh"))
                return (name.Contains("hant") || name.Contains("tw") || name.Contains("hk")) ? "zh-TW" : "zh-CN";
        }
        catch { }
        return "en";
    }

    static string AskLanguage()
    {
        using (var form = new Form())
        {
            form.Text = "Language / 语言 / 語言";
            form.Width = 400; form.Height = 205;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MaximizeBox = false; form.MinimizeBox = false;
            var title = new Label { Left = 18, Top = 14, Width = 350, Height = 22, Text = L("lang.choose"), Font = new Font(form.Font, FontStyle.Bold) };
            var hint = new Label { Left = 18, Top = 38, Width = 350, Height = 20, Text = L("lang.hint") };
            var combo = new ComboBox { Left = 18, Top = 72, Width = 350, DropDownStyle = ComboBoxStyle.DropDownList };
            combo.Items.AddRange(new object[] { "English", "简体中文 (Simplified Chinese)", "繁體中文 (Traditional Chinese)" });
            combo.SelectedIndex = LangIndex();
            var ok = new Button { Text = L("btn.ok"), Left = 196, Top = 112, Width = 80, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = L("btn.cancel"), Left = 288, Top = 112, Width = 80, DialogResult = DialogResult.Cancel };
            form.Controls.AddRange(new Control[] { title, hint, combo, ok, cancel });
            form.AcceptButton = ok;
            form.CancelButton = cancel;
            if (form.ShowDialog() != DialogResult.OK) return Lang;
            int index = combo.SelectedIndex;
            if (index < 0 || index >= LangCodes.Length) index = 0;
            return LangCodes[index];
        }
    }

    static void SaveLangOnly()
    {
        SyncLangToPage();
        try
        {
            var text = new StringBuilder();
            text.Append("{\n");
            text.Append("  \"lang\": \"").Append(Lang).Append("\"");
            if (File.Exists(configPath))
            {
                text.Append("\n}\n");
                string existing = File.ReadAllText(configPath, Encoding.UTF8);
                if (existing.IndexOf("\"lang\"", StringComparison.Ordinal) < 0)
                {
                    int brace = existing.LastIndexOf('}');
                    string head = brace > 0 ? existing.Substring(0, brace).TrimEnd() : "{";
                    if (!head.EndsWith(",")) head += ",";
                    File.WriteAllText(configPath, head + "\n  \"lang\": \"" + Lang + "\"\n}\n", Utf8NoBom);
                    return;
                }
                File.WriteAllText(configPath, ReplaceLang(existing), Utf8NoBom);
                return;
            }
            text.Append("\n}\n");
            File.WriteAllText(configPath, text.ToString(), Utf8NoBom);
        }
        catch { }
    }

    static void SyncLangToPage()
    {
        try
        {
            if (!Healthy() || !IsOurServer()) return;
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                client.Headers[HttpRequestHeader.ContentType] = "application/json; charset=utf-8";
                client.UploadString("http://" + host + ":" + port + "/api/settings", "POST", "{\"lang\":\"" + Lang + "\"}");
            }
        }
        catch { }
    }

    static string ReplaceLang(string json)
    {
        int index = json.IndexOf("\"lang\"", StringComparison.Ordinal);
        if (index < 0) return json;
        int colon = json.IndexOf(':', index);
        int start = json.IndexOf('"', colon + 1);
        int end = json.IndexOf('"', start + 1);
        if (colon < 0 || start < 0 || end < 0) return json;
        return json.Substring(0, start + 1) + Lang + json.Substring(end);
    }

    static ToolStripMenuItem BuildLangMenu()
    {
        var menu = new ToolStripMenuItem(L("tray.lang"));
        for (int i = 0; i < LangCodes.Length; i++)
        {
            string code = LangCodes[i];
            var item = new ToolStripMenuItem(code + (i == 0 ? " · English" : ""), null, (s, e) =>
            {
                Lang = code;
                SaveLangOnly();
                SyncLangToPage();
                MessageBox.Show(L("lang.hint"), AppTitle);
            });
            item.Checked = code == Lang;
            item.CheckOnClick = true;
            menu.DropDownItems.Add(item);
        }
        return menu;
    }

    static string AppTitle { get { return L("tray.title") + " " + Version; } }

    static string HelpText()
    {
        return "dsh 记忆管理器 —— DSH 长期记忆的桌面壳（自带 Node，单文件）\n\n"
             + "双击：启动记忆页 → 浏览器打开 → 托盘常驻\n\n"
             + "--install    接到本机所有 DSH profile（之后 DSH 里才能用记忆工具）\n"
             + "--start      只启动服务\n"
             + "--stop       停止服务\n"
             + "--restart    重启服务并打开\n"
             + "--status     健康检查（0 正常 / 1 未运行 / 3 端口被别人占用）\n"
             + "--port N     自定义端口（会记住；被占用则拒绝启动）\n"
             + "--no-tray    打开后不常驻托盘\n"
             + "--store DIR  记忆存储目录（现有盘符 + 纯英文目录名 + 空目录）\n"
             + "--dir/--data/--version\n\n"
             + "当前端口：" + port + "    数据：" + dataFile;
    }

    // ── 解压 / 路径 ─────────────────────────────────────────────────────────
    // ── 存储目录规则 ────────────────────────────────────────────────────────
    // 只允许：现有盘符 + 全英文（ASCII）目录名 + 目录为空（或它本身就是当前存储目录）。
    // 目标目录已有别的内容时拒绝，避免把记忆塞进别人的目录里。
    static string ValidateStore(string path, string previous)
    {
        if (string.IsNullOrWhiteSpace(path)) return "存储目录不能为空。";
        string full;
        try { full = Path.GetFullPath(path); }
        catch (Exception error) { return "路径无效：" + error.Message; }
        string root = Path.GetPathRoot(full);
        if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return "盘符不存在：" + (root ?? "?");
        string rest = full.Substring(root.Length).TrimEnd('\\', '/');
        if (rest.Length == 0) return "不允许直接用盘符根目录，请选一个子目录。";
        foreach (string segment in rest.Split('\\', '/'))
        {
            if (segment.Length == 0) continue;
            foreach (char ch in segment)
            {
                bool ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
                          || ch == ' ' || ch == '_' || ch == '-' || ch == '.';
                if (!ok) return "目录名只允许英文字母、数字、空格、下划线、短横线和点：\"" + segment + "\"";
            }
        }
        if (!Directory.Exists(full)) return null; // 不存在 → 稍后创建
        bool same = !string.IsNullOrEmpty(previous) && string.Equals(full.TrimEnd('\\'), previous.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        string[] children = Directory.GetFileSystemEntries(full);
        if (children.Length == 0) return null;
        if (same) return null;
        return "目标目录不是空目录：" + full + "\n请选一个空目录（或新建一个）。";
    }

    static void EnsureStoreDir()
    {
        if (!Directory.Exists(StoreDir)) Directory.CreateDirectory(StoreDir);
    }

    static int CountEntries(string file)
    {
        try
        {
            if (!File.Exists(file)) return 0;
            string text = File.ReadAllText(file, Encoding.UTF8);
            int count = 0, index = 0;
            while (true)
            {
                index = text.IndexOf("\"content\"", index, StringComparison.Ordinal);
                if (index < 0) break;
                count++;
                index += 9;
            }
            return count;
        }
        catch { return 0; }
    }

    static void Prepare()
    {
        appRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "dsh-thirdparty-memory");
        appDir = PluginDirOverride.Length > 0 ? PluginDirOverride : Path.Combine(appRoot, "app");
        runtimeDir = Path.Combine(appRoot, "runtime");
        dataDir = Path.Combine(appRoot, "data");
        configPath = Path.Combine(appRoot, "config.json");
        serverJs = Path.Combine(appDir, "server.js");
        nodeExe = Path.Combine(runtimeDir, "node.exe");

        // 存储目录：--store > 配置 storeDir > 兼容旧默认（<安装目录>\data，仅当已有数据）>
        // %APPDATA%\dsh-thirdparty-memory（与插件自身 defaultDataDir 一致，数据与安装分离）
        string savedStore = LoadStringSetting("storeDir");
        string legacyStore = Path.Combine(appDir, "data");
        bool legacyHasData = Directory.Exists(legacyStore)
            && (File.Exists(Path.Combine(legacyStore, "memory.json")) || File.Exists(Path.Combine(legacyStore, "memory.sqlite")));
        string defaultStore = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "dsh-thirdparty-memory");
        PreviousStoreDir = savedStore.Length > 0 ? savedStore : (legacyHasData ? legacyStore : defaultStore);
        string candidate = StoreDirOverride.Length > 0 ? StoreDirOverride : PreviousStoreDir;
        string storeError = ValidateStore(candidate, PreviousStoreDir);
        if (storeError != null) throw new Exception("存储目录不合规：" + storeError);
        StoreDir = Path.GetFullPath(candidate);
        dataFile = Path.Combine(StoreDir, "memory.json");

        Directory.CreateDirectory(appRoot);
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(runtimeDir);
        Directory.CreateDirectory(appDir);
        Directory.CreateDirectory(Path.Combine(appDir, "docs"));
        Directory.CreateDirectory(StoreDir);
        bool external = PluginDirOverride.Length > 0;
        if (external)
        {
            // 用户指向自己已有的安装目录：只读它，不覆盖（否则会把改过的源码盖掉）
            if (!File.Exists(serverJs)) throw new Exception("指定目录里没有 server.js：" + appDir);
        }
        else
        {
            ExtractAppFiles();
        }
        ExtractNode();
    }

    static Stream OpenResource(string name)
    {
        Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (stream == null) throw new Exception("缺少内嵌资源：" + name);
        return stream;
    }

    static void ExtractAppFiles()
    {
        for (int i = 0; i < Resources.GetLength(0); i++)
        {
            string name = Resources[i, 0];
            string target = Path.Combine(appDir, Resources[i, 1]);
            string folder = Path.GetDirectoryName(target);
            if (!Directory.Exists(folder)) Directory.CreateDirectory(folder);
            // 每次启动都覆盖：保证 exe 里的代码永远是最新的（用户数据在 data\ 不受影响）
            using (Stream source = OpenResource(name))
            using (FileStream output = File.Create(target))
            {
                source.CopyTo(output);
            }
        }
    }

    static void ExtractNode()
    {
        if (File.Exists(nodeExe) && new FileInfo(nodeExe).Length > 50 * 1024 * 1024) return;
        using (Stream packed = OpenResource("node_gz"))
        using (var gzip = new GZipStream(packed, CompressionMode.Decompress))
        using (FileStream output = File.Create(nodeExe))
        {
            gzip.CopyTo(output);
        }
    }

    static int LoadPort()
    {
        try
        {
            if (!File.Exists(configPath)) return 0;
            string text = File.ReadAllText(configPath, Encoding.UTF8);
            int index = text.IndexOf("\"port\"");
            if (index < 0) return 0;
            int colon = text.IndexOf(':', index);
            if (colon < 0) return 0;
            var digits = new StringBuilder();
            for (int i = colon + 1; i < text.Length; i++)
            {
                if (char.IsDigit(text[i])) digits.Append(text[i]);
                else if (digits.Length > 0) break;
            }
            int value;
            return int.TryParse(digits.ToString(), out value) ? value : 0;
        }
        catch { return 0; }
    }

    static string LoadStringSetting(string key)
    {
        try
        {
            if (!File.Exists(configPath)) return "";
            string text = File.ReadAllText(configPath, Encoding.UTF8);
            int index = text.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
            if (index < 0) return "";
            int colon = text.IndexOf(':', index);
            if (colon < 0) return "";
            int start = text.IndexOf('"', colon + 1);
            if (start < 0) return "";
            int end = text.IndexOf('"', start + 1);
            if (end <= start) return "";
            // 配置里是 JSON 转义过的（F:\\dir），读回来要还原成 F:\dir
            return text.Substring(start + 1, end - start - 1).Replace("\\\\", "\\");
        }
        catch { return ""; }
    }

    static void SavePort(int value)
    {
        try
        {
            var text = new StringBuilder();
            text.Append("{\n");
            text.Append("  \"port\": ").Append(value).Append(",\n");
            text.Append("  \"host\": \"").Append(host).Append("\"");
            if (PluginDirOverride.Length > 0)
            {
                text.Append(",\n  \"pluginDir\": \"").Append(PluginDirOverride.Replace("\\", "\\\\")).Append("\"");
            }
            if (StoreDir.Length > 0)
            {
                text.Append(",\n  \"storeDir\": \"").Append(StoreDir.Replace("\\", "\\\\")).Append("\"");
            }
            text.Append(",\n  \"lang\": \"").Append(Lang).Append("\"");
            text.Append("\n}\n");
            File.WriteAllText(configPath, text.ToString(), Utf8NoBom);
        }
        catch { }
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
        catch { return false; }
    }

    static bool PortBusy()
    {
        return Healthy();
    }

    /// <summary>端口上的服务是不是本插件的记忆页。</summary>
    static bool IsOurServer()
    {
        try
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                client.Headers[HttpRequestHeader.Accept] = "application/json";
                string body = client.DownloadString("http://" + host + ":" + port + "/api/state");
                return body.Contains("dataFile") && body.Contains("settings");
            }
        }
        catch { return false; }
    }

    static string StartServer()
    {
        if (!File.Exists(serverJs)) return "缺少 server.js：" + serverJs;
        if (!File.Exists(nodeExe)) return "缺少内置 Node 运行时：" + nodeExe;
        try
        {
            var info = new ProcessStartInfo(nodeExe, "\"" + serverJs + "\"")
            {
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            info.EnvironmentVariables["MEMORY_PAGE_HOST"] = host;
            info.EnvironmentVariables["MEMORY_PAGE_PORT"] = port.ToString();
            info.EnvironmentVariables["MEMORY_DATA_FILE"] = dataFile;
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
            const string query = "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'";
            using (var searcher = new ManagementObjectSearcher(query))
            {
                foreach (ManagementObject item in searcher.Get())
                {
                    string commandLine = Convert.ToString(item["CommandLine"]);
                    if (commandLine == null || commandLine.IndexOf("server.js", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (commandLine.IndexOf("dsh-thirdparty-memory", StringComparison.OrdinalIgnoreCase) < 0
                        && commandLine.IndexOf(appRoot, StringComparison.OrdinalIgnoreCase) < 0) continue;
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
            MessageBox.Show("打开浏览器失败：" + error.Message + "\n请手动访问 http://" + host + ":" + port + "/", AppTitle);
        }
    }

    // ── 接到 DSH profile ────────────────────────────────────────────────────
    static string RunAttach()
    {
        string script = Path.Combine(appDir, "attach.ps1");
        if (!File.Exists(script)) return "缺少 attach.ps1，无法接线。";
        try
        {
            var info = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -PluginDir \"" + appDir + "\" -DataFile \"" + dataFile + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (Process process = Process.Start(info))
            {
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit(30000);
                string summary = "已把插件接到检测到的 DSH profile。\n\n" + output.Trim();
                if (error.Trim().Length > 0) summary += "\n\n[stderr]\n" + error.Trim();
                summary += "\n\n下一步：重启 DSH（bundle 只在启动时读取），之后在设置→插件里应能看到 dsh-thirdparty-memory。";
                return summary;
            }
        }
        catch (Exception error)
        {
            return "接线失败：" + error.Message;
        }
    }

    // ── 破坏性操作：二次确认 ────────────────────────────────────────────────
    static bool ConfirmTwice(string first, string second)
    {
        if (MessageBox.Show(first, AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2) != DialogResult.Yes) return false;
        return MessageBox.Show(second, AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                   MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    static void ChangePort()
    {
        string input = Prompt.Show("输入新的端口（1–65535）。\n当前：" + port, "更换端口", port.ToString());
        int next;
        if (input == null || !int.TryParse(input.Trim(), out next) || next < 1 || next > 65535)
        {
            return;
        }
        port = next;
        SavePort(port);
        StopServer();
        Thread.Sleep(400);
        if (PortBusy() && !IsOurServer())
        {
            MessageBox.Show("端口 " + port + " 已被其它程序占用，未切换到该端口。", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        string error = StartServer();
        if (error != null) MessageBox.Show(error, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
        for (int i = 0; i < 40 && !Healthy(); i++) Thread.Sleep(100);
        OpenPage();
    }

    // ── 更换存储目录 ────────────────────────────────────────────────────────
    static void ChangeStore()
    {
        using (var dialog = new FolderBrowserDialog())
        {
            dialog.Description = L("msg.pickStore");
            dialog.ShowNewFolderButton = true;
            if (dialog.ShowDialog() != DialogResult.OK) return;
            string target = dialog.SelectedPath.TrimEnd('\\');
            bool sameDir = string.Equals(target, StoreDir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            if (sameDir)
            {
                MessageBox.Show(L("msg.sameDir"), AppTitle);
                return;
            }
            string error = ValidateStore(target, StoreDir);
            if (error != null)
            {
                MessageBox.Show(error, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            // 0.4.0 起真实数据可能在同目录的 .sqlite（JSON 只是迁移源），两者都算数据。
            string sqliteFile = Path.ChangeExtension(dataFile, ".sqlite");
            bool jsonExists = File.Exists(dataFile);
            bool sqliteExists = File.Exists(sqliteFile);
            int count = CountEntries(dataFile);
            bool migrate = false;
            if (jsonExists || sqliteExists)
            {
                string headline = count > 0
                    ? "旧目录里还有 " + count + " 条记忆"
                    : (sqliteExists ? "旧目录里有 SQLite 记忆库" : "旧目录里有记忆数据");
                var answer = MessageBox.Show(
                    headline + "：\n" + dataFile + "\n\n要把它们迁移到新目录吗？\n\n是 = 复制过去（JSON 与 SQLite 一起复制）\n否 = 只切换目录（旧数据留在原处）",
                    AppTitle, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
                if (answer == DialogResult.Cancel) return;
                migrate = answer == DialogResult.Yes;
            }

            try
            {
                StopServer();
                Thread.Sleep(300);
                Directory.CreateDirectory(target);
                if (migrate)
                {
                    // SQLite 连 -wal/-shm 一起复制，避免只搬主库丢最后一批已提交页。
                    foreach (string suffix in new[] { "", "-wal", "-shm" })
                    {
                        string source = sqliteFile + suffix;
                        if (!File.Exists(source)) continue;
                        string dst = Path.Combine(target, Path.GetFileName(source));
                        if (File.Exists(dst)) File.Copy(dst, dst + ".bak", true);
                        File.Copy(source, dst, true);
                    }
                    if (jsonExists)
                    {
                        string targetFile = Path.Combine(target, "memory.json");
                        if (File.Exists(targetFile)) File.Copy(targetFile, targetFile + ".bak", true);
                        File.Copy(dataFile, targetFile, true);
                    }
                }
                StoreDir = Path.GetFullPath(target);
                StoreDirOverride = StoreDir;
                dataFile = Path.Combine(StoreDir, "memory.json");
                SavePort(port);
                string startError = StartServer();
                if (startError != null) { MessageBox.Show(startError, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
                for (int i = 0; i < 50 && !Healthy(); i++) Thread.Sleep(100);
                string attachResult = RunAttach();
                MessageBox.Show(
                    "存储目录已切换到：\n" + StoreDir + "\n\n"
                    + (migrate ? (count > 0 ? "已迁移 " + count + " 条记忆。\n" : "已迁移记忆数据（JSON/SQLite）。\n") : "未迁移旧数据（仍在原处）。\n")
                    + "\n重启 DSH 后插件也会使用这个目录。",
                    AppTitle);
                OpenPage();
            }
            catch (Exception error2)
            {
                MessageBox.Show("切换失败：" + error2.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    static void OpenStoreFolder()
    {
        try { Process.Start("explorer.exe", "\"" + StoreDir + "\""); } catch { }
    }

    // ── 托盘 ────────────────────────────────────────────────────────────────
    static void RunTray()
    {
        Application.EnableVisualStyles();
        var menu = new ContextMenuStrip();
        menu.Items.Add(L("tray.open"), null, (s, e) => OpenPage());
        menu.Items.Add(L("tray.copy"), null, (s, e) => Clipboard.SetText("http://" + host + ":" + port + "/"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(L("tray.store"), null, (s, e) => ChangeStore());
        menu.Items.Add(L("tray.openstore"), null, (s, e) => OpenStoreFolder());
        menu.Items.Add(L("tray.port"), null, (s, e) => ChangePort());
        menu.Items.Add(L("tray.restart"), null, (s, e) =>
        {
            StopServer();
            Thread.Sleep(400);
            StartServer();
            for (int i = 0; i < 40 && !Healthy(); i++) Thread.Sleep(100);
            OpenPage();
        });
        menu.Items.Add(L("tray.stop"), null, (s, e) => StopServer());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(L("tray.attach"), null, (s, e) =>
        {
            string result = RunAttach();
            if (result != null) MessageBox.Show(result, AppTitle);
        });
        menu.Items.Add(L("tray.openapp"), null, (s, e) =>
        {
            try { Process.Start("explorer.exe", "\"" + appDir + "\""); } catch { }
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(BuildLangMenu());
        menu.Items.Add(L("tray.quit"), null, (s, e) => Application.Exit());

        var tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = L("tray.title") + " · " + port,
            Visible = true,
            ContextMenuStrip = menu,
        };
        tray.DoubleClick += (s, e) => OpenPage();
        tray.BalloonTipTitle = AppTitle;
        tray.BalloonTipText = "记忆页已在运行：" + "http://" + host + ":" + port + "/";
        try { tray.ShowBalloonTip(2500); } catch { }
        Application.ApplicationExit += (s, e) => { tray.Visible = false; tray.Dispose(); };
        Application.Run();
    }
}

/// <summary>WinForms 没有内置输入框，这里用一个小窗体代替。</summary>
static class Prompt
{
    public static string Show(string text, string caption, string initial)
    {
        using (var form = new Form())
        {
            form.Text = caption;
            form.Width = 380;
            form.Height = 170;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MaximizeBox = false;
            form.MinimizeBox = false;

            var label = new Label { Left = 16, Top = 14, Width = 340, Height = 44, Text = text };
            var box = new TextBox { Left = 16, Top = 62, Width = 340, Text = initial };
            var ok = new Button { Text = "确定", Left = 196, Top = 96, Width = 76, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "取消", Left = 280, Top = 96, Width = 76, DialogResult = DialogResult.Cancel };
            form.Controls.AddRange(new Control[] { label, box, ok, cancel });
            form.AcceptButton = ok;
            form.CancelButton = cancel;
            return form.ShowDialog() == DialogResult.OK ? box.Text : null;
        }
    }
}
