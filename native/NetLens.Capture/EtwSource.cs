using System.Net;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Session;
using NetLens.Core;

namespace NetLens.Capture;

/// <summary>Per-process bytes and DNS names from ETW. Needs admin, no driver.</summary>
internal sealed class EtwSource : IDisposable
{
    private const string SessionName = "NetLens-Capture";
    private static readonly Guid DnsClient = new("1C95126E-7EEA-49A9-A3FE-A378B03DDB4D");

    private readonly FlowTracker _tracker;
    private readonly AppResolver _apps;
    private readonly TraceEventSession _session;
    private readonly Thread _thread;

    public long NetworkEvents;
    public long DnsEvents;

    public EtwSource(FlowTracker tracker, AppResolver apps)
    {
        _tracker = tracker;
        _apps = apps;
        // Kernel sessions outlive the process, so a failed setup must stop the one it created.
        _session = new TraceEventSession(SessionName) { StopOnDispose = true };
        try
        {
            _session.EnableKernelProvider(KernelTraceEventParser.Keywords.NetworkTCPIP | KernelTraceEventParser.Keywords.Process);
            _session.EnableProvider(DnsClient, TraceEventLevel.Informational);
            Subscribe();
        }
        catch
        {
            _session.Dispose();
            throw;
        }
        _thread = new Thread(() => _session.Source.Process()) { IsBackground = true, Name = "etw" };
        _thread.Start();
    }

    private void Subscribe()
    {
        var k = _session.Source.Kernel;
        k.TcpIpSend += d => Net(d.ProcessID, d.daddr, d.dport, "TCP", 0, d.size);
        k.TcpIpRecv += d => Net(d.ProcessID, d.daddr, d.dport, "TCP", d.size, 0);
        k.TcpIpSendIPV6 += d => Net(d.ProcessID, d.daddr, d.dport, "TCP", 0, d.size);
        k.TcpIpRecvIPV6 += d => Net(d.ProcessID, d.daddr, d.dport, "TCP", d.size, 0);
        k.UdpIpSend += d => Net(d.ProcessID, d.daddr, d.dport, Udp(d.dport), 0, d.size);
        // Unlike TCP, UDP receive events give the packet's addresses: the remote end is the source.
        k.UdpIpRecv += d => Net(d.ProcessID, d.saddr, d.sport, Udp(d.sport), d.size, 0);
        k.UdpIpSendIPV6 += d => Net(d.ProcessID, d.daddr, d.dport, Udp(d.dport), 0, d.size);
        k.UdpIpRecvIPV6 += d => Net(d.ProcessID, d.saddr, d.sport, Udp(d.sport), d.size, 0);
        k.ProcessStart += d => _apps.Started(d.ProcessID, d.ImageFileName);
        k.ProcessStop += d => _apps.Forget(d.ProcessID);

        _session.Source.Dynamic.All += OnUserEvent;
    }

    private static string Udp(int port) => port == 443 ? "QUIC" : "UDP";

    private void Net(int pid, IPAddress remote, int port, string proto, long down, long up)
    {
        Interlocked.Increment(ref NetworkEvents);
        _tracker.Observe(_apps.Resolve(pid), remote, port, proto, down, up);
    }

    private void OnUserEvent(TraceEvent e)
    {
        if (e.ProviderGuid != DnsClient || (int)e.ID != 3008) return;
        Interlocked.Increment(ref DnsEvents);
        if (e.PayloadByName("QueryName") is not string name || e.PayloadByName("QueryResults") is not string results) return;
        var addresses = new List<IPAddress>();
        foreach (var part in results.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (IPAddress.TryParse(part, out var ip)) addresses.Add(ip);
        if (addresses.Count > 0) _tracker.ObserveDns(name, addresses);
    }

    public void Dispose()
    {
        _session.Dispose();
    }
}
