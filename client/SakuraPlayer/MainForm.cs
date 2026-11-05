using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace SakuraPlayer;

internal sealed class MainForm : Form
{
    private const string ApiRoot = "https://sakura.mopcblox.online/";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly CookieContainer _cookies = new();
    private readonly HttpClient _http;
    private readonly TextBox _username = new();
    private readonly TextBox _password = new();
    private readonly Button _loginButton = new();
    private readonly Button _logoutButton = new();
    private readonly Label _accountLabel = new();
    private readonly Label _statusLabel = new();
    private readonly Label _gamesMessage = new();
    private readonly FlowLayoutPanel _gamesPanel = new();
    private readonly Button _refreshButton = new();
    private readonly Color _blue = Color.FromArgb(31, 102, 164);
    private readonly Color _light = Color.FromArgb(243, 245, 248);
    private bool _busy;

    public MainForm()
    {
        Text = "Sakura Player";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        Size = new Size(1120, 760);
        BackColor = _light;
        Font = new Font("Segoe UI", 9F);
        Icon = SystemIcons.Application;

        var handler = new HttpClientHandler
        {
            CookieContainer = _cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
        };
        _http = new HttpClient(handler) { BaseAddress = new Uri(ApiRoot), Timeout = TimeSpan.FromSeconds(20) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("SakuraPlayer/0.1");

        BuildInterface();
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += (_, _) => _http.Dispose();
    }

    private void BuildInterface()
    {
        var header = new Panel { Dock = DockStyle.Top, Height = 62, BackColor = _blue };
        var brand = new Label
        {
            Text = "SAKURA  PLAYER",
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 16F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(24, 16)
        };
        _statusLabel.Text = "CLASSIC 2017 • PREVIEW";
        _statusLabel.ForeColor = Color.WhiteSmoke;
        _statusLabel.AutoSize = true;
        _statusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _statusLabel.Location = new Point(Width - 250, 23);
        header.Controls.Add(brand);
        header.Controls.Add(_statusLabel);
        header.Resize += (_, _) => _statusLabel.Location = new Point(header.ClientSize.Width - _statusLabel.Width - 24, 23);

        var body = new Panel { Dock = DockStyle.Fill, BackColor = _light };
        var sidebar = new Panel { Dock = DockStyle.Left, Width = 190, BackColor = Color.FromArgb(232, 236, 241), Padding = new Padding(14, 22, 14, 14) };
        var sideTitle = new Label
        {
            Text = "SAKURA",
            Font = new Font("Segoe UI", 13F, FontStyle.Bold),
            ForeColor = Color.FromArgb(60, 69, 80),
            AutoSize = true,
            Location = new Point(16, 18)
        };
        sidebar.Controls.Add(sideTitle);
        AddSideButton(sidebar, "HOME", 62);
        AddSideButton(sidebar, "GAMES", 106);
        AddSideButton(sidebar, "MY ACCOUNT", 150);

        var website = new LinkLabel
        {
            Text = "Open Sakura website",
            AutoSize = true,
            LinkColor = _blue,
            Location = new Point(18, 220)
        };
        website.LinkClicked += (_, _) => OpenWebsite();
        sidebar.Controls.Add(website);

        var content = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(26, 20, 26, 20),
            ColumnCount = 1,
            RowCount = 3,
            BackColor = _light
        };
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
        content.RowStyles.Add(new RowStyle(SizeType.Absolute, 126));
        content.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var heading = new Panel { Dock = DockStyle.Fill };
        var title = new Label
        {
            Text = "Games",
            Font = new Font("Segoe UI", 21F, FontStyle.Bold),
            ForeColor = Color.FromArgb(43, 51, 61),
            AutoSize = true,
            Location = new Point(0, 0)
        };
        var subtitle = new Label
        {
            Text = "Discover experiences on Sakura",
            ForeColor = Color.FromArgb(104, 113, 124),
            AutoSize = true,
            Location = new Point(2, 38)
        };
        ConfigureButton(_refreshButton, "REFRESH", Color.FromArgb(225, 233, 241), Color.FromArgb(42, 68, 91));
        _refreshButton.Size = new Size(104, 34);
        _refreshButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _refreshButton.Location = new Point(heading.Width - 104, 10);
        _refreshButton.Click += async (_, _) => await LoadGamesAsync();
        heading.Controls.Add(title);
        heading.Controls.Add(subtitle);
        heading.Controls.Add(_refreshButton);
        heading.Resize += (_, _) => _refreshButton.Location = new Point(heading.ClientSize.Width - 104, 8);

        var authCard = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Padding = new Padding(16),
            BorderStyle = BorderStyle.FixedSingle
        };
        var authTitle = new Label
        {
            Text = "Sign in to Sakura",
            Font = new Font("Segoe UI", 11F, FontStyle.Bold),
            ForeColor = Color.FromArgb(48, 57, 67),
            AutoSize = true,
            Location = new Point(16, 12)
        };
        authCard.Controls.Add(authTitle);

        AddField(authCard, "USERNAME", _username, 16, 46, 205);
        AddField(authCard, "PASSWORD", _password, 244, 46, 205);
        _password.UseSystemPasswordChar = true;
        ConfigureButton(_loginButton, "SIGN IN", Color.FromArgb(83, 157, 78), Color.White);
        _loginButton.Location = new Point(472, 62);
        _loginButton.Size = new Size(112, 34);
        _loginButton.Click += async (_, _) => await LoginAsync();
        authCard.Controls.Add(_loginButton);

        _accountLabel.AutoSize = true;
        _accountLabel.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
        _accountLabel.ForeColor = Color.FromArgb(52, 73, 94);
        _accountLabel.Location = new Point(16, 69);
        _accountLabel.Visible = false;
        authCard.Controls.Add(_accountLabel);

        ConfigureButton(_logoutButton, "SIGN OUT", Color.FromArgb(235, 238, 242), Color.FromArgb(57, 67, 78));
        _logoutButton.Size = new Size(105, 32);
        _logoutButton.Location = new Point(472, 62);
        _logoutButton.Visible = false;
        _logoutButton.Click += async (_, _) => await LogoutAsync();
        authCard.Controls.Add(_logoutButton);

        var gamesHost = new Panel { Dock = DockStyle.Fill, BackColor = _light };
        var gamesTitle = new Label
        {
            Text = "AVAILABLE GAMES",
            Font = new Font("Segoe UI", 9F, FontStyle.Bold),
            ForeColor = Color.FromArgb(91, 101, 113),
            Dock = DockStyle.Top,
            Height = 32,
            TextAlign = ContentAlignment.MiddleLeft
        };
        _gamesPanel.Dock = DockStyle.Fill;
        _gamesPanel.AutoScroll = true;
        _gamesPanel.FlowDirection = FlowDirection.TopDown;
        _gamesPanel.WrapContents = false;
        _gamesPanel.Padding = new Padding(0, 2, 8, 12);
        _gamesMessage.Text = "Loading games...";
        _gamesMessage.ForeColor = Color.FromArgb(105, 114, 124);
        _gamesMessage.AutoSize = true;
        _gamesMessage.Margin = new Padding(4, 16, 4, 4);
        _gamesPanel.Controls.Add(_gamesMessage);
        gamesHost.Controls.Add(_gamesPanel);
        gamesHost.Controls.Add(gamesTitle);

        content.Controls.Add(heading, 0, 0);
        content.Controls.Add(authCard, 0, 1);
        content.Controls.Add(gamesHost, 0, 2);
        body.Controls.Add(content);
        body.Controls.Add(sidebar);
        Controls.Add(body);
        Controls.Add(header);
    }

    private static void AddField(Control parent, string caption, TextBox input, int x, int y, int width)
    {
        var label = new Label
        {
            Text = caption,
            ForeColor = Color.FromArgb(103, 112, 123),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(x, y)
        };
        input.Location = new Point(x, y + 18);
        input.Size = new Size(width, 28);
        input.BorderStyle = BorderStyle.FixedSingle;
        parent.Controls.Add(label);
        parent.Controls.Add(input);
    }

    private static void ConfigureButton(Button button, string text, Color backColor, Color foreColor)
    {
        button.Text = text;
        button.BackColor = backColor;
        button.ForeColor = foreColor;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
    }

    private static void AddSideButton(Control parent, string text, int y)
    {
        var button = new Button
        {
            Text = text,
            Location = new Point(8, y),
            Size = new Size(150, 34),
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(10, 0, 0, 0),
            FlatStyle = FlatStyle.Flat,
            BackColor = text == "GAMES" ? Color.FromArgb(214, 225, 237) : Color.Transparent,
            ForeColor = Color.FromArgb(60, 70, 82),
            Font = new Font("Segoe UI", 8.5F, FontStyle.Bold),
            TabStop = false
        };
        button.FlatAppearance.BorderSize = 0;
        parent.Controls.Add(button);
    }

    private async Task InitializeAsync()
    {
        await CheckSessionAsync();
        await LoadGamesAsync();
    }

    private async Task CheckSessionAsync()
    {
        try
        {
            using var response = await _http.GetAsync("api/me");
            if (!response.IsSuccessStatusCode) return;
            var result = await response.Content.ReadFromJsonAsync<ApiEnvelope>(JsonOptions);
            if (!string.IsNullOrWhiteSpace(result?.User?.Username))
                SetSignedIn(result.User.Username);
        }
        catch
        {
            SetStatus("WEBSITE CONNECTION UNAVAILABLE");
        }
    }

    private async Task LoginAsync()
    {
        if (_busy) return;
        var username = _username.Text.Trim();
        var password = _password.Text;
        if (username.Length == 0 || password.Length == 0)
        {
            MessageBox.Show(this, "Enter your Sakura username and password.", "Sign in", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        SetBusy(true);
        try
        {
            using var response = await _http.PostAsJsonAsync("api/login", new LoginRequest(username, password));
            if (!response.IsSuccessStatusCode)
            {
                MessageBox.Show(this, await ReadApiErrorAsync(response), "Sign in failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var result = await response.Content.ReadFromJsonAsync<ApiEnvelope>(JsonOptions);
            if (string.IsNullOrWhiteSpace(result?.User?.Username))
            {
                MessageBox.Show(this, "The website returned an unexpected sign-in response.", "Sign in failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _password.Clear();
            SetSignedIn(result.User.Username);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not reach Sakura: " + ex.Message, "Connection error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task LogoutAsync()
    {
        if (_busy) return;
        SetBusy(true);
        try
        {
            using var response = await _http.PostAsync("api/logout", content: null);
            if (!response.IsSuccessStatusCode)
                MessageBox.Show(this, await ReadApiErrorAsync(response), "Sign out failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            SetSignedOut();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not sign out: " + ex.Message, "Connection error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetSignedIn(string username)
    {
        _username.Visible = false;
        _password.Visible = false;
        foreach (Control control in _username.Parent.Controls)
        {
            if (control is Label label && (label.Text == "USERNAME" || label.Text == "PASSWORD"))
                label.Visible = false;
        }
        _loginButton.Visible = false;
        _accountLabel.Text = "SIGNED IN AS  " + username;
        _accountLabel.Visible = true;
        _logoutButton.Visible = true;
        SetStatus("SIGNED IN");
    }

    private void SetSignedOut()
    {
        _username.Visible = true;
        _password.Visible = true;
        foreach (Control control in _username.Parent.Controls)
        {
            if (control is Label label && (label.Text == "USERNAME" || label.Text == "PASSWORD"))
                label.Visible = true;
        }
        _loginButton.Visible = true;
        _accountLabel.Visible = false;
        _logoutButton.Visible = false;
        _username.Clear();
        _password.Clear();
        SetStatus("NOT SIGNED IN");
    }

    private async Task LoadGamesAsync()
    {
        _refreshButton.Enabled = false;
        _gamesPanel.Controls.Clear();
        _gamesMessage.Text = "Loading games...";
        _gamesPanel.Controls.Add(_gamesMessage);
        try
        {
            using var response = await _http.GetAsync("api/games");
            if (!response.IsSuccessStatusCode)
            {
                _gamesMessage.Text = await ReadApiErrorAsync(response);
                return;
            }

            var result = await response.Content.ReadFromJsonAsync<ApiEnvelope>(JsonOptions);
            var games = result?.Games ?? new List<GameInfo>();
            _gamesPanel.Controls.Clear();
            if (games.Count == 0)
            {
                _gamesMessage.Text = "No games have been published on Sakura yet.";
                _gamesPanel.Controls.Add(_gamesMessage);
                return;
            }

            foreach (var game in games)
                _gamesPanel.Controls.Add(CreateGameCard(game));
        }
        catch (Exception ex)
        {
            _gamesMessage.Text = "Sakura is unavailable: " + ex.Message;
            if (_gamesPanel.Controls.Count == 0) _gamesPanel.Controls.Add(_gamesMessage);
        }
        finally
        {
            _refreshButton.Enabled = true;
        }
    }

    private Control CreateGameCard(GameInfo game)
    {
        var card = new Panel
        {
            Width = Math.Max(560, _gamesPanel.ClientSize.Width - 34),
            Height = 142,
            BackColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
            Margin = new Padding(0, 0, 0, 12),
            Padding = new Padding(12)
        };

        var picture = new PictureBox
        {
            Location = new Point(12, 12),
            Size = new Size(116, 116),
            BackColor = Color.FromArgb(224, 231, 238),
            SizeMode = PictureBoxSizeMode.Zoom
        };
        card.Controls.Add(picture);
        if (!string.IsNullOrWhiteSpace(game.ThumbnailUrl))
            _ = LoadThumbnailAsync(picture, game.ThumbnailUrl);

        var title = new Label
        {
            Text = string.IsNullOrWhiteSpace(game.Title) ? "Untitled game" : game.Title,
            Location = new Point(146, 14),
            AutoSize = true,
            MaximumSize = new Size(430, 28),
            Font = new Font("Segoe UI", 12F, FontStyle.Bold),
            ForeColor = Color.FromArgb(43, 52, 63)
        };
        var description = new Label
        {
            Text = string.IsNullOrWhiteSpace(game.Description) ? "No description." : game.Description,
            Location = new Point(146, 45),
            Size = new Size(390, 42),
            ForeColor = Color.FromArgb(101, 111, 122),
            AutoEllipsis = true
        };
        var idLabel = new Label
        {
            Text = "GAME ID: " + (game.Id ?? "—"),
            Location = new Point(146, 96),
            AutoSize = true,
            Font = new Font("Segoe UI", 7.5F, FontStyle.Bold),
            ForeColor = Color.FromArgb(137, 145, 155)
        };
        var locked = new Button
        {
            Text = "CLIENT NOT CONNECTED",
            Size = new Size(194, 32),
            Enabled = false,
            BackColor = Color.FromArgb(231, 235, 239),
            ForeColor = Color.FromArgb(110, 119, 129),
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 7.5F, FontStyle.Bold),
            Anchor = AnchorStyles.Right | AnchorStyles.Bottom,
            Location = new Point(card.Width - 210, 96)
        };
        locked.FlatAppearance.BorderSize = 0;
        card.Controls.Add(title);
        card.Controls.Add(description);
        card.Controls.Add(idLabel);
        card.Controls.Add(locked);
        return card;
    }

    private async Task LoadThumbnailAsync(PictureBox picture, string source)
    {
        try
        {
            var uri = Uri.TryCreate(source, UriKind.Absolute, out var absolute)
                ? absolute
                : new Uri(new Uri(ApiRoot), source);
            if (uri.Scheme != Uri.UriSchemeHttps) return;
            using var response = await _http.GetAsync(uri);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync();
            using var image = Image.FromStream(stream);
            var copy = new Bitmap(image);
            if (picture.IsDisposed)
            {
                copy.Dispose();
                return;
            }
            picture.Image = copy;
        }
        catch
        {
            // A missing thumbnail should not prevent the game list from loading.
        }
    }

    private static async Task<string> ReadApiErrorAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String)
                return error.GetString() ?? "The request failed.";
        }
        catch (JsonException)
        {
            // Use the HTTP status when the response is not JSON.
        }
        return "Request failed (" + (int)response.StatusCode + " " + response.ReasonPhrase + ").";
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        _loginButton.Enabled = !busy;
        _logoutButton.Enabled = !busy;
        _username.Enabled = !busy;
        _password.Enabled = !busy;
    }

    private void SetStatus(string message)
    {
        _statusLabel.Text = message;
        var header = _statusLabel.Parent;
        if (header is not null)
            _statusLabel.Location = new Point(Math.Max(12, header.ClientSize.Width - _statusLabel.Width - 24), 23);
    }

    private static void OpenWebsite()
    {
        Process.Start(new ProcessStartInfo("https://sakura.mopcblox.online/") { UseShellExecute = true });
    }

    private sealed record LoginRequest(string Username, string Password);

    private sealed class ApiEnvelope
    {
        public UserInfo? User { get; set; }
        public List<GameInfo>? Games { get; set; }
    }

    private sealed class UserInfo
    {
        public string Username { get; set; } = "";
    }

    private sealed class GameInfo
    {
        public string? Id { get; set; }
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? ThumbnailUrl { get; set; }
    }
}
