using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading.Channels;

namespace NetLens.Capture;

/// <summary>
/// Sends NDJSON to local clients. Write-only: clients can't send this elevated
/// process anything, and the ACL limits connections to the launching user.
/// </summary>
internal sealed class PipeServer
{
    public const string Name = "netlens-capture";
    private const int MaxClients = 4;

    private readonly Func<string> _hello;
    private readonly SecurityIdentifier _client;
    private readonly Action<string> _log;
    private readonly object _gate = new();
    private readonly List<Channel<string>> _clients = new();
    private readonly CancellationToken _stop;
    private readonly Task _acceptLoop;

    public DateTime LastClientSeen { get; private set; } = DateTime.UtcNow;

    /// <summary>Faults if the pipe can't be created, for example because another process already owns the name.</summary>
    public Task Completion => _acceptLoop;

    public int ClientCount
    {
        get { lock (_gate) return _clients.Count; }
    }

    public PipeServer(Func<string> hello, SecurityIdentifier client, Action<string> log, CancellationToken stop)
    {
        _hello = hello;
        _client = client;
        _log = log;
        _stop = stop;
        // Creating the first instance synchronously makes a name clash fail fast.
        var first = CreatePipe(first: true);
        _acceptLoop = AcceptLoop(first);
    }

    /// <summary>
    /// Builds a message and queues it for every client. Runs under the same lock as a new
    /// client's hello, so a sample is either in the hello or sent after it, never both.
    /// </summary>
    public void Publish(Func<string> build)
    {
        lock (_gate)
        {
            var line = build();
            if (_clients.Count > 0) LastClientSeen = DateTime.UtcNow;
            foreach (var c in _clients) c.Writer.TryWrite(line);
        }
    }

    private NamedPipeServerStream CreatePipe(bool first)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(_client, PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
        var options = PipeOptions.Asynchronous | (first ? PipeOptions.FirstPipeInstance : PipeOptions.None);
        return NamedPipeServerStreamAcl.Create(Name, PipeDirection.Out, MaxClients, PipeTransmissionMode.Byte, options, 0, 64 * 1024, security);
    }

    private async Task AcceptLoop(NamedPipeServerStream next)
    {
        while (!_stop.IsCancellationRequested)
        {
            try
            {
                await next.WaitForConnectionAsync(_stop);
            }
            catch (OperationCanceledException)
            {
                await next.DisposeAsync();
                return;
            }
            _ = Serve(next);

            // All instances busy is temporary; wait for a client to leave.
            while (true)
            {
                try
                {
                    next = CreatePipe(first: false);
                    break;
                }
                catch (IOException e)
                {
                    _log($"pipe instance unavailable: {e.Message}");
                    try { await Task.Delay(1000, _stop); }
                    catch (OperationCanceledException) { return; }
                }
            }
        }
    }

    private async Task Serve(NamedPipeServerStream pipe)
    {
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(120) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        var encoding = new UTF8Encoding(false);
        try
        {
            await using (pipe)
            {
                string hello;
                lock (_gate)
                {
                    hello = _hello();
                    _clients.Add(channel);
                }
                await Write(pipe, hello, encoding);
                await foreach (var line in channel.Reader.ReadAllAsync(_stop))
                    await Write(pipe, line, encoding);
            }
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException) { }
        finally
        {
            lock (_gate)
            {
                _clients.Remove(channel);
                LastClientSeen = DateTime.UtcNow;
            }
        }
    }

    private async Task Write(Stream pipe, string line, Encoding encoding)
    {
        var bytes = encoding.GetBytes(line + "\n");
        await pipe.WriteAsync(bytes, _stop);
        await pipe.FlushAsync(_stop);
    }
}
