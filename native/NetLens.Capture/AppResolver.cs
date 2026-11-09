using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using NetLens.Core;

namespace NetLens.Capture;

/// <summary>PID to app. Fast on the ETW thread; signature and description load in the background.</summary>
internal sealed class AppResolver
{
    private const uint ProcessQueryLimitedInformation = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

    private readonly FlowTracker _tracker;
    private readonly ConcurrentDictionary<int, string> _byPid = new();
    private readonly ConcurrentDictionary<int, string> _names = new();
    private readonly ConcurrentDictionary<int, string> _paths = new();
    private readonly ConcurrentDictionary<string, byte> _known = new(StringComparer.OrdinalIgnoreCase);

    public AppResolver(FlowTracker tracker)
    {
        _tracker = tracker;
    }

    public string Resolve(int pid) => _byPid.GetOrAdd(pid, Lookup);

    /// <summary>
    /// Notes the path while the process is alive, so short-lived ones can still be named
    /// if they use the network. Starting a process doesn't register it as an app.
    /// </summary>
    public void Started(int pid, string imageName)
    {
        _byPid.TryRemove(pid, out _);
        _names[pid] = imageName;
        if (PathOf(pid) is { } path) _paths[pid] = path;
    }

    /// <summary>Network events can trail the exit event, so keep the mapping for a while.</summary>
    public void Forget(int pid)
    {
        var mapped = _byPid.GetValueOrDefault(pid);
        var name = _names.GetValueOrDefault(pid);
        var path = _paths.GetValueOrDefault(pid);
        Task.Delay(TimeSpan.FromSeconds(30)).ContinueWith(_ =>
        {
            // Compare values: the PID may already belong to a new process.
            if (mapped is not null) _byPid.TryRemove(new KeyValuePair<int, string>(pid, mapped));
            if (name is not null) _names.TryRemove(new KeyValuePair<int, string>(pid, name));
            if (path is not null) _paths.TryRemove(new KeyValuePair<int, string>(pid, path));
        });
    }

    private string Lookup(int pid)
    {
        if (pid == 4) return Register("system", "System", "System", path: "", SignatureChecker.CatalogPublisher);
        if (pid <= 0) return Register("unattributed", "Unattributed", "(no process)", "", null);

        var path = PathOf(pid) ?? _paths.GetValueOrDefault(pid);
        if (path is null)
        {
            var name = _names.GetValueOrDefault(pid) ?? TryProcessName(pid) ?? "Exited process";
            return Register($"name:{name.ToLowerInvariant()}", name, name, "", null);
        }
        var id = path.ToLowerInvariant();
        if (_known.TryAdd(id, 0))
        {
            var exe = Path.GetFileName(path);
            _tracker.UpsertApp(new AppDto(id, Path.GetFileNameWithoutExtension(path), exe, path, null, [AppNotes.CheckingSignature], false), final: false);
            Task.Run(() => Inspect(id, path, exe));
        }
        return id;
    }

    private string Register(string id, string name, string exe, string path, string? publisher)
    {
        if (_known.TryAdd(id, 0))
            _tracker.UpsertApp(new AppDto(id, name, exe, path, publisher, publisher is null ? [AppNotes.PathUnavailable] : [], false), final: true);
        return id;
    }

    private void Inspect(string id, string path, string exe)
    {
        string name = Path.GetFileNameWithoutExtension(path);
        try
        {
            var description = FileVersionInfo.GetVersionInfo(path).FileDescription?.Trim();
            if (!string.IsNullOrEmpty(description) && description.Length <= 40) name = description;
        }
        catch (Exception e) when (e is IOException or Win32Exception or UnauthorizedAccessException) { }

        var publisher = SignatureChecker.Publisher(path);
        var notes = new List<string>();
        var flagged = false;
        if (publisher is null)
        {
            var risky = RiskyLocation(path);
            if (risky is not null)
            {
                notes.Add($"Runs from {risky}");
                flagged = true;
            }
        }
        _tracker.UpsertApp(new AppDto(id, name, exe, path, publisher, notes.ToArray(), flagged), final: true);
    }

    private static string? RiskyLocation(string path)
    {
        if (path.Contains(@"\Temp\", StringComparison.OrdinalIgnoreCase)) return "a Temp folder";
        if (path.Contains(@"\Downloads\", StringComparison.OrdinalIgnoreCase)) return "Downloads";
        if (path.Contains(@"\Users\Public\", StringComparison.OrdinalIgnoreCase)) return "the Public folder";
        return null;
    }

    private static string? PathOf(int pid)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (handle == IntPtr.Zero) return null;
        try
        {
            var size = 1024;
            var sb = new StringBuilder(size);
            return QueryFullProcessImageName(handle, 0, sb, ref size) ? sb.ToString() : null;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static string? TryProcessName(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return p.ProcessName;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }
}
