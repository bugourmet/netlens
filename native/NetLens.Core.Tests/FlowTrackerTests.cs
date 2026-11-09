using System.Net;
using NetLens.Core;

namespace NetLens.Core.Tests;

public sealed class FlowTrackerTests : IDisposable
{
    private readonly ProviderResolver _resolver = new(geoDir: null);
    private readonly SeenStore _seen = new(path: null, learning: TimeSpan.Zero);
    private readonly FlowTracker _tracker;

    public FlowTrackerTests()
    {
        _tracker = new FlowTracker(_resolver, _seen);
    }

    public void Dispose()
    {
        _seen.Dispose();
        _resolver.Dispose();
    }

    private static AppDto Signed(string id) => new(id, id, $"{id}.exe", $@"C:\Program Files\{id}.exe", "Publisher", [], false);
    private static AppDto Unsigned(string id) => new(id, id, $"{id}.exe", $@"C:\Tools\{id}.exe", null, [], false);
    private static AppDto Flagged(string id) => new(id, id, $"{id}.exe", $@"C:\Users\u\AppData\Local\Temp\{id}.exe", null, ["Runs from a Temp folder"], true);

    [Fact]
    public void Tick_reports_bytes_per_flow_and_new_flow_definitions()
    {
        _tracker.UpsertApp(Signed("chrome"), final: true);
        _tracker.Observe("chrome", IPAddress.Parse("8.8.8.8"), 443, "TCP", down: 1000, up: 50);
        _tracker.Observe("chrome", IPAddress.Parse("8.8.8.8"), 443, "TCP", down: 500, up: 0);

        var tick = _tracker.Tick(100);

        var flow = Assert.Single(tick.Flows);
        Assert.Equal(new[] { flow.Index }, tick.Ids);
        Assert.Equal(1500, tick.Down[0]);
        Assert.Equal(50, tick.Up[0]);
        Assert.Empty(_tracker.Tick(101).Flows); // only changes are resent
    }

    [Fact]
    public void Ignores_loopback_and_multicast_but_keeps_local_network()
    {
        _tracker.Observe("a", IPAddress.Loopback, 80, "TCP", 10, 0);
        _tracker.Observe("a", IPAddress.Parse("239.1.1.1"), 5353, "UDP", 10, 0);
        _tracker.Observe("a", IPAddress.Parse("192.168.1.1"), 53, "UDP", 10, 0);

        var flow = Assert.Single(_tracker.Tick(100).Flows);
        Assert.Equal("local", flow.PlaceId);
    }

    [Fact]
    public void Treats_ipv4_mapped_ipv6_as_the_same_address()
    {
        _tracker.Observe("a", IPAddress.Parse("::ffff:8.8.8.8"), 443, "TCP", 10, 0);
        _tracker.Observe("a", IPAddress.Parse("8.8.8.8"), 443, "TCP", 10, 0);
        Assert.Single(_tracker.Tick(100).Flows);
    }

    [Fact]
    public void A_later_dns_answer_names_an_existing_flow_and_finds_its_provider()
    {
        _tracker.Observe("chrome", IPAddress.Parse("142.250.1.1"), 443, "TCP", 10, 0);
        Assert.Equal("142.250.1.1", Assert.Single(_tracker.Tick(100).Flows).Domain);

        _tracker.ObserveDns("rr1.googlevideo.com.", [IPAddress.Parse("142.250.1.1")]);

        var renamed = Assert.Single(_tracker.Tick(101).Flows);
        Assert.Equal("rr1.googlevideo.com", renamed.Domain);
        Assert.Equal("google", renamed.ProviderId);
    }

    [Fact]
    public void Flagged_app_raises_a_critical_event_even_while_learning()
    {
        using var learningStore = new SeenStore(null, TimeSpan.FromHours(1));
        var tracker = new FlowTracker(_resolver, learningStore);
        tracker.UpsertApp(Signed("chrome"), final: true);
        tracker.UpsertApp(Flagged("updater"), final: true);

        var e = Assert.Single(tracker.Tick(100).Events);
        Assert.Equal("critical", e.Severity);
        Assert.Equal("updater", e.AppId);
    }

    [Fact]
    public void First_use_alerts_once_per_app_and_rates_signed_apps_as_info()
    {
        _tracker.UpsertApp(Signed("chrome"), final: true);
        _tracker.UpsertApp(Unsigned("tool"), final: true);
        _tracker.UpsertApp(Signed("chrome"), final: true);

        var events = _tracker.Tick(100).Events;
        Assert.Equal(["info", "warning"], events.Select(e => e.Severity));
    }

    [Fact]
    public void Apps_with_unknown_path_are_not_called_unsigned()
    {
        _tracker.UpsertApp(new AppDto("name:x", "x", "x.exe", "", null, [AppNotes.PathUnavailable], false), final: true);
        Assert.Equal("info", Assert.Single(_tracker.Tick(100).Events).Severity);
    }

    [Fact]
    public void Event_history_is_capped()
    {
        for (var i = 0; i < FlowTracker.MaxEvents + 20; i++) _tracker.UpsertApp(Signed($"app{i}"), final: true);
        _tracker.Tick(100);
        Assert.Equal(FlowTracker.MaxEvents, _tracker.Hello("full", []).Events.Length);
    }

    [Fact]
    public void Quiet_flows_are_forgotten_after_the_history_window_unless_open()
    {
        _tracker.Tick(99); // the tracker's clock comes from ticks
        _tracker.Observe("a", IPAddress.Parse("1.1.1.1"), 443, "TCP", 10, 0);
        _tracker.Observe("a", IPAddress.Parse("2.2.2.2"), 443, "TCP", 10, 0);
        _tracker.Tick(100);
        _tracker.SetOpen([("a", IPAddress.Parse("2.2.2.2"), 443)]);

        _tracker.Tick(100 + FlowTracker.HistorySeconds + 61);

        var kept = Assert.Single(_tracker.Hello("full", []).Flows);
        Assert.Equal("2.2.2.2", kept.Ip);
    }

    [Fact]
    public void A_forgotten_destination_comes_back_as_a_new_flow_with_a_new_index()
    {
        _tracker.Tick(99);
        _tracker.Observe("a", IPAddress.Parse("1.1.1.1"), 443, "TCP", 10, 0);
        var first = Assert.Single(_tracker.Tick(100).Flows).Index;
        _tracker.Tick(100 + FlowTracker.HistorySeconds + 61);

        _tracker.Observe("a", IPAddress.Parse("1.1.1.1"), 443, "TCP", 10, 0);
        var second = Assert.Single(_tracker.Tick(100 + FlowTracker.HistorySeconds + 62).Flows).Index;
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void Hello_contains_history_registries_and_protocol_version()
    {
        _tracker.UpsertApp(Signed("chrome"), final: true);
        _tracker.Observe("chrome", IPAddress.Parse("8.8.8.8"), 443, "TCP", 10, 0);
        _tracker.Tick(100);
        _tracker.Tick(101);

        var hello = _tracker.Hello("full", ["no-geo"]);
        Assert.Equal(2, hello.History.Length);
        Assert.Single(hello.Flows);
        Assert.Contains(hello.Apps, a => a.Id == "chrome");

        var json = Wire.Encode(hello);
        Assert.Contains("\"type\":\"hello\"", json);
        Assert.Contains($"\"protocol\":{Wire.Version}", json);
    }
}
