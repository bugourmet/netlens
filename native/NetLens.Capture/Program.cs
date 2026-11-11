using System.Runtime.InteropServices;
using System.Security.Principal;
using NetLens.Capture;
using NetLens.Core;

// Usage: NetLens.Capture [--limited] [--keep] [--no-learning] [--client-sid S-1-...] [--geo-dir DIR] [--diag FILE]
// Exit codes: 0 stopped, 2 another helper is running, 3 the pipe couldn't be created.

var options = args.ToList();
bool Flag(string name) => options.Contains(name);
string? Value(string name)
{
    var i = options.IndexOf(name);
    return i >= 0 && i + 1 < options.Count ? options[i + 1] : null;
}

var diagPath = Value("--diag");
void Diag(string message)
{
    if (diagPath is null) return;
    try { File.AppendAllText(diagPath, $"{DateTime.Now:HH:mm:ss} {message}\n"); }
    catch (IOException) { }
}

AppDomain.CurrentDomain.UnhandledException += (_, e) => Diag($"FATAL {e.ExceptionObject}");

// One helper per machine: two would fight over the single named ETW session.
// Wait a little, because switching from limited to full capture starts this
// helper just before the app stops the old one.
using var instance = new Mutex(initiallyOwned: false, @"Global\NetLens.Capture");
bool isOnlyInstance;
try
{
    isOnlyInstance = instance.WaitOne(TimeSpan.FromSeconds(15));
}
catch (AbandonedMutexException)
{
    isOnlyInstance = true; // the previous helper was stopped without releasing it; we own it now
}
if (!isOnlyInstance)
{
    Diag("another helper is already running");
    return 2;
}

var identity = WindowsIdentity.GetCurrent();
var elevated = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
var limited = Flag("--limited") || !elevated;
var clientSid = Value("--client-sid") is { } sid ? new SecurityIdentifier(sid) : identity.User!;
var geoDir = Value("--geo-dir") ?? Path.Combine(AppContext.BaseDirectory, "geo");

Diag($"start elevated={elevated} limited={limited} geoDir={geoDir}");

using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    stop.Cancel();
};

using var resolver = new ProviderResolver(geoDir);
var learning = Flag("--no-learning") ? TimeSpan.Zero : TimeSpan.FromHours(1);
using var seen = new SeenStore(DataDirectory.DatabasePath(elevated, Diag), learning, Diag);
var tracker = new FlowTracker(resolver, seen);
var apps = new AppResolver(tracker);

var limits = new List<string>();
if (!resolver.HasGeoData) limits.Add("no-geo");
var mode = "full";
void UseLimitedMode()
{
    mode = "limited";
    limits.AddRange(["no-bytes", "no-dns"]);
}

PipeServer pipe;
try
{
    pipe = new PipeServer(() => Wire.Encode(tracker.Hello(mode, limits.ToArray())), clientSid, Diag, stop.Token);
}
catch (Exception e) when (e is IOException or UnauthorizedAccessException)
{
    Diag($"pipe unavailable, another program owns the name: {e.Message}");
    return 3;
}

EtwSource? etw = null;
if (limited)
{
    UseLimitedMode();
}
else
{
    try
    {
        etw = new EtwSource(tracker, apps);
        Diag("etw started");
    }
    catch (Exception e) when (e is UnauthorizedAccessException or COMException or InvalidOperationException)
    {
        Diag($"etw failed: {e.Message}");
        UseLimitedMode();
    }
}

using var poller = new TablePoller(tracker, apps, Diag);

long? idleSince = null;
var ticks = 0L;
var exitCode = 0;
using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
try
{
    while (await timer.WaitForNextTickAsync(stop.Token))
    {
        if (pipe.Completion.IsFaulted)
        {
            Diag($"pipe failed: {pipe.Completion.Exception?.GetBaseException().Message}");
            exitCode = 3;
            break;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var idle = Idle.Seconds();
        if (idle >= 300) idleSince ??= now - idle;
        else if (idleSince is { } start)
        {
            tracker.SetIdle(start, now);
            idleSince = null;
        }

        TickMessage? tick = null;
        pipe.Publish(() => Wire.Encode(tick = tracker.Tick(now)));

        if (++ticks % 10 == 0)
            Diag($"tick clients={pipe.ClientCount} flows={tracker.LiveFlowCount} net={etw?.NetworkEvents} dns={etw?.DnsEvents} active={tick?.Ids.Length}");

        // With no tray yet, don't linger elevated once nothing is watching.
        if (!Flag("--keep") && pipe.ClientCount == 0 && DateTime.UtcNow - pipe.LastClientSeen > TimeSpan.FromSeconds(60))
        {
            Diag("no clients, exiting");
            break;
        }
    }
}
catch (OperationCanceledException) { }

etw?.Dispose();
instance.ReleaseMutex();
Diag("stopped");
return exitCode;

internal static class Idle
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo
    {
        public int Size;
        public uint Time;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LastInputInfo info);

    /// <summary>Seconds since the last keyboard or mouse input. Both counters wrap, so subtract as unsigned.</summary>
    public static long Seconds()
    {
        var info = new LastInputInfo { Size = Marshal.SizeOf<LastInputInfo>() };
        return GetLastInputInfo(ref info) ? unchecked((uint)Environment.TickCount - info.Time) / 1000 : 0;
    }
}
