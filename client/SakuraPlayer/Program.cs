namespace SakuraPlayer;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var launchUri = args.FirstOrDefault(argument =>
            Uri.TryCreate(argument, UriKind.Absolute, out var uri) &&
            uri.Scheme.Equals("sakura-player", StringComparison.OrdinalIgnoreCase));

        Application.Run(new MainForm(launchUri));
    }
}
