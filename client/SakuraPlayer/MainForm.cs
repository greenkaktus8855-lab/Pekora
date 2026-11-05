using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SakuraPlayer;

internal sealed class MainForm : Form
{
    private const string WorkerUrl = "https://sakura.green-kaktus8855.workers.dev/";
    private const string CustomDomainUrl = "https://sakura.mopcblox.online/";
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "sakura.green-kaktus8855.workers.dev",
        "sakura.mopcblox.online"
    };

    private readonly WebView2 _browser = new() { Dock = DockStyle.Fill };
    private readonly Button _back = new() { Text = "‹", Width = 42 };
    private readonly Button _forward = new() { Text = "›", Width = 42 };
    private readonly Button _refresh = new() { Text = "↻", Width = 42 };
    private readonly Button _home = new() { Text = "HOME", Width = 72 };
    private readonly Label _connection = new() { AutoSize = true, Text = "CONNECTING TO SAKURA" };
    private bool _browserReady;

    public MainForm()
    {
        Text = "Sakura Player";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        Size = new Size(1280, 820);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9F);
        Icon = SystemIcons.Application;

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

    private async Task InitializeBrowserAsync()
    {
        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SakuraPlayer",
                "WebView2");

            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _browser.EnsureCoreWebView2Async(environment);

            var core = _browser.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;

            core.NavigationStarting += (_, args) =>
            {
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) ||
                    target.Scheme != Uri.UriSchemeHttps)
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
}
