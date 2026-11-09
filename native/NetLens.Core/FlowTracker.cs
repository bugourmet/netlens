using System.Net;

namespace NetLens.Core;

/// <summary>
/// Platform-neutral aggregation. Capture adapters (ETW now, VpnService later) push
/// observations in; once a second Tick() returns what changed plus a rate sample.
/// Thread-safe: observations may arrive from several threads.
/// </summary>
public sealed class FlowTracker
{
    public const int HistorySeconds = 30 * 60;

    /// <summary>Live flows kept at once. Past this, new peers of an app share one "other" row.</summary>
    public const int MaxLiveFlows = 10_000;

    public const int MaxEvents = 500;
    private const int MaxDnsEntries = 50_000;
    private const int EvictEverySeconds = 60;

    private sealed class Flow
    {
        public required FlowDto Dto;
        public required IPAddress Ip;
        public required Key Key;
        public long LastSeen;
    }

    private readonly record struct Key(string AppId, string Ip, int Port, string Proto);

    private readonly object _gate = new();
    private readonly ProviderResolver _resolver;
    private readonly SeenStore _seen;

    private readonly Dictionary<Key, Flow> _flowsByKey = new();
    private readonly Dictionary<int, Flow> _flows = new();
    private readonly Dictionary<string, List<Flow>> _flowsByIp = new();
    private readonly Dictionary<string, string> _dns = new();
    private readonly Dictionary<string, AppDto> _apps = new();
    private readonly Dictionary<string, ProviderDto> _providers = new();
    private readonly Dictionary<string, PlaceDto> _places = new();
    private readonly Queue<EventDto> _events = new();
    private readonly Queue<SampleDto> _history = new();
    private readonly Dictionary<int, (long Down, long Up)> _pending = new();

    private readonly List<AppDto> _dirtyApps = new();
    private readonly List<ProviderDto> _dirtyProviders = new();
    private readonly List<PlaceDto> _dirtyPlaces = new();
    private readonly HashSet<int> _dirtyFlows = new();
    private readonly List<EventDto> _newEvents = new();
    private IdleDto? _idle;
    private int _nextIndex;
    private long _now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    private long _lastEviction;

    public FlowTracker(ProviderResolver resolver, SeenStore seen)
    {
        _resolver = resolver;
        _seen = seen;
    }

    /// <summary>Number of flows currently tracked. For diagnostics and tests.</summary>
    public int LiveFlowCount
    {
        get { lock (_gate) return _flows.Count; }
    }

    /// <summary>Registers or updates an app. Called again once signature data is ready.</summary>
    public void UpsertApp(AppDto app, bool final)
    {
        lock (_gate)
        {
            _apps[app.Id] = app;
            _dirtyApps.Add(app);
            if (!final) return;

            // Flows seen while the signature was being checked get their country check now.
            foreach (var f in _flows.Values)
                if (f.Dto.AppId == app.Id) CheckNewCountry(f.Dto);

            if (!_seen.Add($"app|{app.Id}")) return;
            if (app.Flagged)
                AddEvent("critical", "Unknown app connected", $"{app.Exe} is unsigned and runs from {app.Path}", app.Id, "");
            else if (!_seen.Learning && app.Id is not ("system" or "unattributed"))
                AddEvent(IsKnownUnsigned(app) ? "warning" : "info", "App connected for the first time", $"{app.Name} used the network for the first time", app.Id, "");
        }
    }

    public void ObserveDns(string domain, IEnumerable<IPAddress> addresses)
    {
        domain = domain.TrimEnd('.').ToLowerInvariant();
        if (domain.EndsWith(".localmachine", StringComparison.Ordinal)) return; // Windows asking about itself
        lock (_gate)
        {
            if (_dns.Count > MaxDnsEntries) _dns.Clear();
            foreach (var raw in addresses)
            {
                var text = Normalize(raw).ToString();
                _dns[text] = domain;
                if (_flowsByIp.TryGetValue(text, out var flows))
                    foreach (var f in flows)
                        if (f.Dto.Domain != domain) Assign(f, domain);
            }
        }
    }

    /// <summary>Counts traffic for a connection. Zero bytes just marks it as present.</summary>
    public void Observe(string appId, IPAddress remote, int port, string proto, long down, long up)
    {
        remote = Normalize(remote);
        if (ProviderResolver.IsIgnored(remote)) return;
        var key = new Key(appId, remote.ToString(), port, proto);
        lock (_gate)
        {
            if (!_flowsByKey.TryGetValue(key, out var flow))
            {
                // Runaway peer counts (P2P, games) fold into one row per app.
                if (_flows.Count >= MaxLiveFlows) key = new Key(appId, "other", 0, proto);
                if (!_flowsByKey.TryGetValue(key, out flow)) flow = Create(key, remote);
            }
            flow.LastSeen = _now;
            if (down + up > 0)
            {
                var p = _pending.GetValueOrDefault(flow.Dto.Index);
                _pending[flow.Dto.Index] = (p.Down + down, p.Up + up);
            }
        }
    }

    /// <summary>Marks which connections the OS table currently lists as open.</summary>
    public void SetOpen(IReadOnlyCollection<(string AppId, IPAddress Ip, int Port)> open)
    {
        lock (_gate)
        {
            var keys = open.Select(o => (o.AppId, Normalize(o.Ip).ToString(), o.Port)).ToHashSet();
            foreach (var f in _flows.Values)
            {
                if (f.Dto.Proto != "TCP") continue;
                var isOpen = keys.Contains((f.Dto.AppId, f.Dto.Ip, f.Dto.Port));
                if (isOpen == f.Dto.Open) continue;
                f.Dto = f.Dto with { Open = isOpen };
                _dirtyFlows.Add(f.Dto.Index);
            }
        }
    }

    public void SetIdle(long start, long end)
    {
        lock (_gate) _idle = new IdleDto(start, end);
    }

    public TickMessage Tick(long t)
    {
        lock (_gate)
        {
            _now = t;
            var ids = new int[_pending.Count];
            var down = new float[ids.Length];
            var up = new float[ids.Length];
            var i = 0;
            foreach (var (id, bytes) in _pending)
            {
                ids[i] = id;
                down[i] = bytes.Down;
                up[i] = bytes.Up;
                i++;
            }
            _pending.Clear();

            _history.Enqueue(new SampleDto(t, ids, down, up));
            while (_history.Count > HistorySeconds) _history.Dequeue();
            if (t - _lastEviction >= EvictEverySeconds) EvictStale(t);

            var message = new TickMessage(
                t, ids, down, up,
                _dirtyApps.ToArray(), _dirtyProviders.ToArray(), _dirtyPlaces.ToArray(),
                _dirtyFlows.Where(_flows.ContainsKey).Select(x => _flows[x].Dto).ToArray(), _newEvents.ToArray(), _idle);
            _dirtyApps.Clear();
            _dirtyProviders.Clear();
            _dirtyPlaces.Clear();
            _dirtyFlows.Clear();
            _newEvents.Clear();
            return message;
        }
    }

    public HelloMessage Hello(string mode, string[] limits)
    {
        lock (_gate)
        {
            return new HelloMessage(
                mode, limits, _resolver.Home(),
                _apps.Values.ToArray(), _providers.Values.ToArray(), _places.Values.ToArray(),
                _flows.Values.Select(f => f.Dto).ToArray(), _events.ToArray(), _history.ToArray(), _idle);
        }
    }

    /// <summary>
    /// Forgets flows with no traffic for the whole history window that the OS no longer lists as open.
    /// Their bytes have aged out of history anyway, and this keeps room for new destinations.
    /// Indices are never reused, so old samples can't be misattributed.
    /// </summary>
    private void EvictStale(long t)
    {
        _lastEviction = t;
        var cutoff = t - HistorySeconds;
        foreach (var flow in _flows.Values.Where(f => f.LastSeen < cutoff && !f.Dto.Open).ToList())
        {
            _flows.Remove(flow.Dto.Index);
            _flowsByKey.Remove(flow.Key);
            if (_flowsByIp.TryGetValue(flow.Dto.Ip, out var list) && list.Remove(flow) && list.Count == 0)
                _flowsByIp.Remove(flow.Dto.Ip);
        }
    }

    private Flow Create(Key key, IPAddress remote)
    {
        _dns.TryGetValue(key.Ip, out var domain);
        var (provider, place) = key.Ip == "other"
            ? (new ProviderDto("other", "Other", "", "Many peers"), ProviderResolver.UnknownPlace)
            : _resolver.Resolve(remote, domain);
        Register(provider);
        Register(place);
        var dto = new FlowDto(_nextIndex++, key.AppId, provider.Id, domain ?? key.Ip, key.Ip, key.Port, key.Proto, place.Id, false);
        var flow = new Flow { Dto = dto, Ip = remote, Key = key, LastSeen = _now };
        _flows.Add(dto.Index, flow);
        _flowsByKey[key] = flow;
        if (!_flowsByIp.TryGetValue(key.Ip, out var list)) _flowsByIp[key.Ip] = list = new List<Flow>(1);
        list.Add(flow);
        _dirtyFlows.Add(dto.Index);
        CheckNewCountry(dto);
        return flow;
    }

    private void Assign(Flow flow, string domain)
    {
        var (provider, place) = _resolver.Resolve(flow.Ip, domain);
        Register(provider);
        Register(place);
        flow.Dto = flow.Dto with { Domain = domain, ProviderId = provider.Id, PlaceId = place.Id };
        _dirtyFlows.Add(flow.Dto.Index);
    }

    // Signed apps reach new countries all the time (a browser, a CDN), so only unsigned ones alert.
    private void CheckNewCountry(FlowDto flow)
    {
        if (!_places.TryGetValue(flow.PlaceId, out var place) || place.Lat is null) return;
        if (!_apps.TryGetValue(flow.AppId, out var app) || app.Notes.Contains(AppNotes.CheckingSignature)) return;
        var firstVisit = _seen.Add($"country|{flow.AppId}|{place.Cc}");
        if (!firstVisit || _seen.Learning || !IsKnownUnsigned(app)) return;
        AddEvent("warning", "New country", $"{app.Name}, unsigned, contacted {place.Country} for the first time", flow.AppId, flow.ProviderId);
    }

    // A process that exited before its path could be read isn't known to be unsigned.
    private static bool IsKnownUnsigned(AppDto app) => app.Publisher is null && !app.Notes.Contains(AppNotes.PathUnavailable);

    private void Register(ProviderDto provider)
    {
        if (_providers.TryAdd(provider.Id, provider)) _dirtyProviders.Add(provider);
    }

    private void Register(PlaceDto place)
    {
        if (_places.TryAdd(place.Id, place)) _dirtyPlaces.Add(place);
    }

    private void AddEvent(string severity, string title, string detail, string appId, string providerId)
    {
        var e = new EventDto(DateTimeOffset.UtcNow.ToUnixTimeSeconds(), severity, title, detail, appId, providerId);
        _events.Enqueue(e);
        while (_events.Count > MaxEvents) _events.Dequeue();
        _newEvents.Add(e);
    }

    private static IPAddress Normalize(IPAddress ip) => ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip;
}
