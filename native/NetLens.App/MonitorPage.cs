namespace NetLens.App;

/// <summary>Hosts the TypeScript UI and relays between it and the capture helper.</summary>
public sealed class MonitorPage : ContentPage
{
    private readonly HybridWebView _web = new() { HybridRoot = "wwwroot", DefaultFile = "index.html" };
    private readonly CaptureClient _capture;

    public MonitorPage()
    {
        _capture = new CaptureClient(Send);
        BackgroundColor = Color.FromArgb("#03070a");
        Content = _web;
        _web.RawMessageReceived += (_, e) => Handle(e.Message);
    }

    /// <summary>
    /// Messages from the page: "ready", "start:full", "start:limited", "open:&lt;https url&gt;".
    /// Anything else is ignored.
    /// </summary>
    private void Handle(string? message)
    {
        if (message is null) return;
        if (message == "ready")
        {
            _capture.Attach();
        }
        else if (message is "start:full" or "start:limited")
        {
            _capture.RequestStart(message["start:".Length..]);
        }
        else if (message.StartsWith("open:", StringComparison.Ordinal)
            && Uri.TryCreate(message["open:".Length..], UriKind.Absolute, out var url)
            && url.Scheme == Uri.UriSchemeHttps)
        {
            // Links open in the user's browser, never inside the app's own web view.
            MainThread.BeginInvokeOnMainThread(() => _ = Launcher.Default.OpenAsync(url));
        }
    }

    private void Send(string line) => MainThread.BeginInvokeOnMainThread(() => _web.SendRawMessage(line));
}
