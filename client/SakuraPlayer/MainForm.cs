using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SakuraPlayer;

internal sealed class MainForm : Form
{
    private const string WorkerUrl = "https://sakura.green-kaktus8855.workers.dev/";
    private const string CustomDomainUrl = "https://sakura.mopcblox.online/";
    private const string ProtocolScheme = "sakura-player";
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "sakura.green-kaktus8855.workers.dev",
        "sakura.mopcblox.online"
    };
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly WebView2 _browser = new() { Dock = DockStyle.Fill };
    private readonly Button _back = new() { Text = "‹", Width = 42 };
    private readonly Button _forward = new() { Text = "›", Width = 42 };
    private readonly Button _refresh = new() { Text = "↻", Width = 42 };
    private readonly Button _home = new() { Text = "HOME", Width = 72 };
    private readonly Label _connection = new() { AutoSize = true, Text = "CONNECTING TO SAKURA" };
    private readonly string? _initialLaunchUri;
    private bool _browserReady;
    private bool _launchInProgress;

    private static string ConfigDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SakuraPlayer");

    private static string ConfigPath => Path.Combine(ConfigDirectory, "player.json");

    public MainForm(string? initialLaunchUri)
    {
        _initialLaunchUri = initialLaunchUri;
        Text = "Sakura Player";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        Size = new Size(1280, 820);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9F);
        Icon = SystemIcons.Application;

        RegisterProtocolHandler();

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 54,
            BackColor = Color.FromArgb(35, 102, 166),
            Padding = new Padding(12, 8, 12, 8)
        };

        var brand = new Label
        {
            Text = "SAKURA PLAYER",
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 12F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(14, 16)
        };
        header.Controls.Add(brand);

        StyleToolbarButton(_back);
        StyleToolbarButton(_forward);
        StyleToolbarButton(_refresh);
        StyleToolbarButton(_home);
        _back.Location = new Point(210, 10);
        _forward.Location = new Point(258, 10);
        _refresh.Location = new Point(306, 10);
        _home.Location = new Point(356, 10);
        _connection.ForeColor = Color.WhiteSmoke;
        _connection.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _connection.Location = new Point(header.ClientSize.Width - 230, 19);
        header.Controls.AddRange(new Control[] { _back, _forward, _refresh, _home, _connection });
        header.Resize += (_, _) =>
            _connection.Location = new Point(header.ClientSize.Width - _connection.Width - 18, 19);

        _back.Click += (_, _) =>
        {
            if (_browserReady && _browser.CoreWebView2.CanGoBack)
                _browser.CoreWebView2.GoBack();
        };
        _forward.Click += (_, _) =>
        {
            if (_browserReady && _browser.CoreWebView2.CanGoForward)
                _browser.CoreWebView2.GoForward();
        };
        _refresh.Click += (_, _) =>
        {
            if (_browserReady)
                _browser.CoreWebView2.Reload();
        };
        _home.Click += (_, _) =>
        {
            if (_browserReady)
                _browser.CoreWebView2.Navigate(WorkerUrl + "#home");
        };

        Controls.Add(_browser);
        Controls.Add(header);

        Shown += async (_, _) => await InitializeBrowserAsync();
        FormClosed += (_, _) => _browser.Dispose();
    }

    private static void StyleToolbarButton(Button button)
    {
        button.Height = 32;
        button.Top = 10;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = Color.FromArgb(245, 248, 251);
        button.ForeColor = Color.FromArgb(40, 57, 75);
        button.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
    }

    private static void RegisterProtocolHandler()
    {
        if (!OperatingSystem.IsWindows())
            return;

        try
        {
            var executable = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executable))
                return;

            using var protocol = Registry.CurrentUser.CreateSubKey(
                @"Software\Classes\sakura-player", writable: true);
            protocol.SetValue("", "URL:Sakura Player Protocol");
            protocol.SetValue("URL Protocol", "");

            using var defaultIcon = protocol.CreateSubKey("DefaultIcon", writable: true);
            defaultIcon.SetValue("", $"\"{executable}\",0");

            using var command = protocol.CreateSubKey(@"shell\open\command", writable: true);
            command.SetValue("", $"\"{executable}\" \"%1\"");
        }
        catch
        {
            // Registration is per-user and does not require administrator rights.
        }
    }

    private async Task InitializeBrowserAsync()
    {
        try
        {
            Directory.CreateDirectory(ConfigDirectory);
            EnsureStarterConfig();

            var userData = Path.Combine(ConfigDirectory, "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _browser.EnsureCoreWebView2Async(environment);

            var core = _browser.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;

            core.NavigationStarting += async (_, args) =>
            {
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target))
                {
                    args.Cancel = true;
                    return;
                }

                if (target.Scheme.Equals(ProtocolScheme, StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                    await LaunchGameAsync(target);
                    return;
                }

                if (target.Scheme != Uri.UriSchemeHttps)
                {
                    args.Cancel = true;
                    return;
                }

                if (!AllowedHosts.Contains(target.Host))
                {
                    args.Cancel = true;
                    OpenExternal(target);
                }
            };

            core.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) &&
                    target.Scheme == Uri.UriSchemeHttps)
                    OpenExternal(target);
            };

            core.SourceChanged += (_, _) => UpdateNavigationButtons();
            core.DocumentTitleChanged += (_, _) =>
            {
                var pageTitle = core.DocumentTitle;
                Text = string.IsNullOrWhiteSpace(pageTitle)
                    ? "Sakura Player"
                    : pageTitle + " — Sakura Player";
            };

            _browserReady = true;
            _connection.Text = "SAKURA WORKER";
            UpdateNavigationButtons();
            core.Navigate(WorkerUrl + "#home");

            if (!string.IsNullOrWhiteSpace(_initialLaunchUri) &&
                Uri.TryCreate(_initialLaunchUri, UriKind.Absolute, out var launchUri))
            {
                await LaunchGameAsync(launchUri);
            }
        }
        catch (Exception ex)
        {
            _connection.Text = "BROWSER RUNTIME REQUIRED";
            var message =
                "Sakura Player needs Microsoft Edge WebView2 Runtime to display the Sakura website.\n\n" +
                "Install the Evergreen WebView2 Runtime, then reopen Sakura Player.\n\n" +
                "Details: " + ex.Message;

            var result = MessageBox.Show(
                this,
                message,
                "Sakura Player setup",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Information);

            if (result == DialogResult.OK)
                OpenExternal(new Uri("https://developer.microsoft.com/microsoft-edge/webview2/"));
        }
    }

    private static void EnsureStarterConfig()
    {
        if (File.Exists(ConfigPath))
            return;

        var starter = new PlayerConfig
        {
            RuntimeExecutable = "",
            Notes = "Set RuntimeExecutable to a compatible Sakura game client. The client must support --game-id and --platform-url."
        };
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(starter, JsonOptions));
    }

    private async Task LaunchGameAsync(Uri uri)
    {
        if (_launchInProgress)
            return;

        if (!uri.Scheme.Equals(ProtocolScheme, StringComparison.OrdinalIgnoreCase) ||
            !uri.Host.Equals("play", StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show(this, "This Sakura Player link is not supported.", "Cannot open game",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var query = ParseQuery(uri.Query);
        if (!query.TryGetValue("gameId", out var gameId) ||
            string.IsNullOrWhiteSpace(gameId) ||
            gameId.Length > 80 ||
            gameId.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch == '-')))
        {
            MessageBox.Show(this, "The game link is missing a valid game ID.", "Cannot open game",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        PlayerConfig? config;
        try
        {
            config = JsonSerializer.Deserialize<PlayerConfig>(await File.ReadAllTextAsync(ConfigPath));
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not read Sakura Player settings: " + ex.Message,
                "Player settings", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var runtimePath = Environment.ExpandEnvironmentVariables(config?.RuntimeExecutable?.Trim() ?? "");
        if (string.IsNullOrWhiteSpace(runtimePath) || !File.Exists(runtimePath))
        {
            MessageBox.Show(this,
                "Sakura Player received the Play request for game " + gameId + ", but a compatible 3D game client is not configured yet.\n\n" +
                "The current Sakura website can list games, but the platform still needs a game runtime, game-server service and join-ticket API.\n\n" +
                "Player settings: " + ConfigPath,
                "Game client not configured",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);

            if (_browserReady)
                _browser.CoreWebView2.Navigate(WorkerUrl + "#games");
            return;
        }

        _launchInProgress = true;
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = runtimePath,
                WorkingDirectory = Path.GetDirectoryName(runtimePath) ?? AppContext.BaseDirectory,
                UseShellExecute = false
            };
            startInfo.ArgumentList.Add("--game-id");
            startInfo.ArgumentList.Add(gameId);
            startInfo.ArgumentList.Add("--platform-url");
            startInfo.ArgumentList.Add(WorkerUrl.TrimEnd('/'));

            var gameProcess = Process.Start(startInfo);
            if (gameProcess is null)
                throw new InvalidOperationException("The game client did not start.");

            Hide();
            await gameProcess.WaitForExitAsync();
            Close();
        }
        catch (Exception ex)
        {
            _launchInProgress = false;
            Show();
            WindowState = FormWindowState.Normal;
            MessageBox.Show(this,
                "Could not start the configured game client.\n\n" + ex.Message,
                "Game launch failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0].Replace("+", " "));
            var value = pair.Length > 1
                ? Uri.UnescapeDataString(pair[1].Replace("+", " "))
                : "";
            values[key] = value;
        }
        return values;
    }

    private void UpdateNavigationButtons()
    {
        if (!_browserReady)
            return;

        _back.Enabled = _browser.CoreWebView2.CanGoBack;
        _forward.Enabled = _browser.CoreWebView2.CanGoForward;
    }

    private static void OpenExternal(Uri uri)
    {
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch
        {
            // A blocked external browser launch must not crash the player shell.
        }
    }

    private sealed class PlayerConfig
    {
        public string RuntimeExecutable { get; set; } = "";
        public string Notes { get; set; } = "";
    }
}
