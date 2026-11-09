using System.Net;
using NetLens.Core;

namespace NetLens.Core.Tests;

public sealed class ProviderResolverTests : IDisposable
{
    // No geo databases: exercises the domain rules and fallbacks only.
    private readonly ProviderResolver _resolver = new(geoDir: null);

    public void Dispose() => _resolver.Dispose();

    [Theory]
    [InlineData("10.0.0.1", true)]
    [InlineData("172.16.5.5", true)]
    [InlineData("172.32.0.1", false)]
    [InlineData("192.168.1.1", true)]
    [InlineData("100.64.0.1", true)] // carrier-grade NAT, also used by VPN tunnels
    [InlineData("8.8.8.8", false)]
    [InlineData("fd00::1", true)]
    public void Detects_private_addresses(string ip, bool expected) =>
        Assert.Equal(expected, ProviderResolver.IsPrivate(IPAddress.Parse(ip)));

    [Theory]
    [InlineData("127.0.0.1", true)]
    [InlineData("::1", true)]
    [InlineData("224.0.0.251", true)]
    [InlineData("255.255.255.255", true)]
    [InlineData("169.254.1.1", true)]
    [InlineData("fe80::1", true)]
    [InlineData("1.1.1.1", false)]
    public void Ignores_addresses_that_are_not_real_destinations(string ip, bool expected) =>
        Assert.Equal(expected, ProviderResolver.IsIgnored(IPAddress.Parse(ip)));

    [Theory]
    [InlineData("rr3---sn-abc.googlevideo.com", "Google")]
    [InlineData("www.youtube.com.", "Google")]
    [InlineData("api.github.com", "GitHub")]
    [InlineData("cdn.discordapp.com", "Discord")]
    public void Domain_rules_name_the_provider(string domain, string provider) =>
        Assert.Equal(provider, _resolver.Resolve(IPAddress.Parse("203.0.113.5"), domain).Provider.Name);

    [Theory]
    [InlineData("static.example.co.uk", "example.co.uk")]
    [InlineData("a.b.example.com", "example.com")]
    public void Unknown_domains_fall_back_to_their_base_domain(string domain, string expected) =>
        Assert.Equal(expected, _resolver.Resolve(IPAddress.Parse("203.0.113.5"), domain).Provider.Name);

    [Fact]
    public void Private_addresses_are_the_local_network()
    {
        var (provider, place) = _resolver.Resolve(IPAddress.Parse("192.168.0.10"), "router.lan");
        Assert.Equal("local", provider.Id);
        Assert.Null(place.Lat);
    }

    [Fact]
    public void Without_geo_data_the_place_is_unknown()
    {
        Assert.False(_resolver.HasGeoData);
        Assert.Equal("unknown", _resolver.Resolve(IPAddress.Parse("8.8.8.8"), null).Place.Id);
    }

    [Fact]
    public void Home_always_has_coordinates()
    {
        var home = _resolver.Home();
        Assert.InRange(home.Lat, -90, 90);
        Assert.InRange(home.Lng, -180, 180);
    }
}
