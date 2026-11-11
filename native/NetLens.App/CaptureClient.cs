using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace NetLens.App;

/// <summary>
/// Connects the UI to the capture helper. Starts the helper only when the UI asks
/// (after the user agreed), then relays its pipe line by line.
/// </summary>
internal sealed class CaptureClient
{
    private const string PipeName = "netlens-capture";
    private const int UacDeclined = 1223;
    private const long MaxLogBytes = 256 * 1024;

    private enum Relay { NotRunning, Foreign, Ended, Resync }
    private enum Launch { Started, Declined, Failed }

    private readonly Action<string> _send;
    private readonly string _helperPath = Path.Combine(AppContext.BaseDirectory, "capture", "NetLens.Capture.exe");
    private readonly object _gate = new();
    private Task? _loop;
    private NamedPipeClientStream? _pipe;
    private TaskCompletionSource<string>? _startRequest;
    private bool _resync;
    private bool _upgrading;
    private int? _helperPid;
    private string _lastStatus = "connecting";

    public CaptureClient(Action<string> send)
    {
        _send = send;
    }

    /// <summary>Called when the page (re)loads: starts relaying, or replays the state for a fresh page.</summary>
    public void Attach()
    {
        lock (_gate)
        {
            if (_loop is null)
            {
                _loop = Task.Run(RunAsync);
                return;
            }
            if (_pipe is not null)
            {
                // Reconnecting makes the helper send a full hello to the new page.
                _resync = true;
                _pipe.Dispose();
                return;
            }
        }
        Status(_lastStatus);
    }

    /// <summary>
    /// The user chose a capture mode: "full" asks for admin, "limited" doesn't.
    /// While limited capture is running, "full" switches to full capture.
    /// </summary>
    public void RequestStart(string mode)
    {
        lock (_gate)
        {
            if (_startRequest is { Task.IsCompleted: false })
            {
                _startRequest.TrySetResult(mode);
                return;
            }
        }
        if (mode == "full") _ = Task.Run(UpgradeToFull);
    }

    /// <summary>
    /// Asks for admin first and only then stops the limited helper, so declining
    /// the prompt leaves limited capture running instead of nothing.
    /// </summary>
    private void UpgradeToFull()
    {
        int limitedPid;
        lock (_gate)
        {
            if (_pipe is null || _helperPid is not { } pid) return;
            limitedPid = pid;
        }

        var launched = LaunchHelper("full");
        if (launched != Launch.Started)
        {
            Status(launched == Launch.Declined ? "upgrade-declined" : "upgrade-failed");
            return;
        }

        lock (_gate) _upgrading = true;
        try
        {
            // The limited helper runs as this user, so it can be stopped. The new
            // one is waiting for it and takes over the moment it exits.
            using var limited = Process.GetProcessById(limitedPid);
            limited.Kill();
        }
        catch (Exception e) when (e is ArgumentException or Win32Exception or InvalidOperationException)
        {
            Log($"couldn't stop the limited helper: {e.Message}");
        }
    }

    private async Task RunAsync()
    {
        var timeout = TimeSpan.FromMilliseconds(600);
        var everConnected = false;
        while (true)
        {
            var result = await RelayAsync(timeout);
            timeout = TimeSpan.FromMilliseconds(600);
            if (result == Relay.Resync) continue;
            if (result == Relay.Ended) everConnected = true;

            // Switching to full capture: the old helper just stopped, so connect to its replacement.
            bool upgrading;
            lock (_gate)
            {
                upgrading = _upgrading;
                _upgrading = false;
            }
            if (upgrading)
            {
                Status("connecting");
                timeout = TimeSpan.FromSeconds(20);
                continue;
            }

            var status = result == Relay.Foreign ? "conflict" : everConnected ? "lost" : "needs-start";
            while (true)
            {
                var mode = await NextStartAsync(status);
                Status("connecting");
                var launched = LaunchHelper(mode);
                if (launched == Launch.Started) break;
                status = launched == Launch.Declined ? "declined" : "denied";
            }
            timeout = TimeSpan.FromSeconds(20); // allow time for the UAC prompt
        }
    }

    // Registers the wait before announcing the status, so a quick answer can't be missed.
    private Task<string> NextStartAsync(string status)
    {
        Task<string> next;
        lock (_gate)
        {
            _startRequest = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            next = _startRequest.Task;
        }
        Status(status);
        return next;
    }

    private Launch LaunchHelper(string mode)
    {
        var start = mode == "limited"
            ? new ProcessStartInfo(_helperPath, "--limited") { CreateNoWindow = true, UseShellExecute = false }
            : new ProcessStartInfo(_helperPath, $"--client-sid {WindowsIdentity.GetCurrent().User!.Value}") { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
        try
        {
            Process.Start(start)?.Dispose();
            return Launch.Started;
        }
        catch (Win32Exception e) when (e.NativeErrorCode == UacDeclined)
        {
            return Launch.Declined;
        }
        catch (Win32Exception e)
        {
            Log($"helper failed to start: {e.Message}");
            return Launch.Failed;
        }
    }

    /// <summary>Relays until the pipe closes.</summary>
    private async Task<Relay> RelayAsync(TimeSpan timeout)
    {
        var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.In, PipeOptions.Asynchronous);
        try
        {
            await pipe.ConnectAsync((int)timeout.TotalMilliseconds);
            if (!IsOurHelper(pipe))
            {
                Log("pipe server is not this app's helper");
                return Relay.Foreign;
            }
            lock (_gate) _pipe = pipe;
            using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 64 * 1024);
            while (await reader.ReadLineAsync() is { } line) _send(line);
            return Relay.Ended;
        }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException or ObjectDisposedException or OperationCanceledException)
        {
            lock (_gate)
            {
                if (_resync)
                {
                    _resync = false;
                    return Relay.Resync;
                }
            }
            return _pipe == pipe ? Relay.Ended : Relay.NotRunning;
        }
        finally
        {
            lock (_gate)
            {
                if (_pipe == pipe) _pipe = null;
            }
            await pipe.DisposeAsync();
        }
    }

    private void Status(string state)
    {
        _lastStatus = state;
        _send($$"""{"type":"status","state":"{{state}}"}""");
    }

    private static void Log(string message)
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NetLens");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "app.log");
            if (File.Exists(file) && new FileInfo(file).Length > MaxLogBytes) File.Move(file, file + ".old", overwrite: true);
            File.AppendAllText(file, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}\n");
        }
        catch (IOException) { }
    }

    /// <summary>Stops another process from feeding the UI fake data by claiming the pipe name first.</summary>
    private bool IsOurHelper(NamedPipeClientStream pipe)
    {
        if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out var pid)) return false;
        var process = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (process == IntPtr.Zero) return false;
        try
        {
            var size = 1024;
            var path = new StringBuilder(size);
            if (!QueryFullProcessImageName(process, 0, path, ref size)
                || !string.Equals(path.ToString(), _helperPath, StringComparison.OrdinalIgnoreCase))
                return false;
            lock (_gate) _helperPid = pid;
            return true;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
}
