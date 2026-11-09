using System.Net;
using System.Runtime.InteropServices;
using NetLens.Core;

namespace NetLens.Capture;

/// <summary>
/// Lists open TCP connections from the OS table. No admin needed and no byte counts.
/// Shows quiet connections in full mode and is the only source in limited mode.
/// </summary>
internal sealed class TablePoller : IDisposable
{
    private const int AfInet = 2;
    private const int AfInet6 = 23;
    private const int TcpTableOwnerPidAll = 5;
    private const int StateEstablished = 5;

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, uint reserved);

    [StructLayout(LayoutKind.Sequential)]
    private struct Row4
    {
        public uint State, LocalAddr, LocalPort, RemoteAddr, RemotePort;
        public int Pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private unsafe struct Row6
    {
        public fixed byte LocalAddr[16];
        public uint LocalScope, LocalPort;
        public fixed byte RemoteAddr[16];
        public uint RemoteScope, RemotePort, State;
        public int Pid;
    }

    private readonly FlowTracker _tracker;
    private readonly AppResolver _apps;
    private readonly Action<string> _log;
    private readonly Timer _timer;

    public TablePoller(FlowTracker tracker, AppResolver apps, Action<string> log)
    {
        _tracker = tracker;
        _apps = apps;
        _log = log;
        _timer = new Timer(_ => SafePoll(), null, TimeSpan.Zero, TimeSpan.FromSeconds(5));
    }

    // An exception on a timer thread would end the process, and with it all capture.
    private void SafePoll()
    {
        try
        {
            Poll();
        }
        catch (Exception e)
        {
            _log($"connection table poll failed: {e.Message}");
        }
    }

    private void Poll()
    {
        var open = new List<(string, IPAddress, int)>();
        foreach (var (pid, ip, port) in Read4().Concat(Read6()))
        {
            if (ProviderResolver.IsIgnored(ip)) continue;
            var app = _apps.Resolve(pid);
            _tracker.Observe(app, ip, port, "TCP", 0, 0);
            open.Add((app, ip, port));
        }
        _tracker.SetOpen(open);
    }

    private static int Port(uint networkOrder) => (int)(((networkOrder & 0xFF) << 8) | ((networkOrder >> 8) & 0xFF));

    private static IEnumerable<(int, IPAddress, int)> Read4()
    {
        var size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, AfInet, TcpTableOwnerPidAll, 0);
        var buffer = Marshal.AllocHGlobal(size);
        var rows = new List<(int, IPAddress, int)>();
        try
        {
            if (GetExtendedTcpTable(buffer, ref size, false, AfInet, TcpTableOwnerPidAll, 0) != 0) return rows;
            var count = Marshal.ReadInt32(buffer);
            var rowSize = Marshal.SizeOf<Row4>();
            for (var i = 0; i < count; i++)
            {
                var row = Marshal.PtrToStructure<Row4>(buffer + 4 + i * rowSize);
                if (row.State == StateEstablished) rows.Add((row.Pid, new IPAddress(row.RemoteAddr), Port(row.RemotePort)));
            }
            return rows;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static unsafe IEnumerable<(int, IPAddress, int)> Read6()
    {
        var size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, AfInet6, TcpTableOwnerPidAll, 0);
        var buffer = Marshal.AllocHGlobal(size);
        var rows = new List<(int, IPAddress, int)>();
        try
        {
            if (GetExtendedTcpTable(buffer, ref size, false, AfInet6, TcpTableOwnerPidAll, 0) != 0) return rows;
            var count = Marshal.ReadInt32(buffer);
            var p = (Row6*)(buffer + 4);
            for (var i = 0; i < count; i++)
            {
                if (p[i].State != StateEstablished) continue;
                var bytes = new byte[16];
                for (var b = 0; b < 16; b++) bytes[b] = p[i].RemoteAddr[b];
                rows.Add((p[i].Pid, new IPAddress(bytes), Port(p[i].RemotePort)));
            }
            return rows;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public void Dispose() => _timer.Dispose();
}
