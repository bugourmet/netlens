using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using MaxMind.Db;

namespace NetLens.Core;

/// <summary>Maps an IP and optional domain to a provider and an approximate country. Offline only.</summary>
public sealed class ProviderResolver : IDisposable
{
    public static readonly PlaceDto LocalPlace = new("local", "", "Local network", "--", null, null);
    public static readonly PlaceDto UnknownPlace = new("unknown", "", "Unknown", "??", null, null);
    private static readonly ProviderDto LocalProvider = new("local", "Local network", "", "This network");
    private static readonly ProviderDto UnknownProvider = new("unknown", "Unknown", "", "No ownership data");

    // Longest suffix wins. Name and category shown to the user.
    private static readonly Dictionary<string, (string Name, string Category)> Rules = new(StringComparer.OrdinalIgnoreCase)
    {
        ["google.com"] = ("Google", "Search & video"), ["googleapis.com"] = ("Google", "Search & video"),
        ["gstatic.com"] = ("Google", "Search & video"), ["googlevideo.com"] = ("Google", "Search & video"),
        ["googleusercontent.com"] = ("Google", "Search & video"), ["youtube.com"] = ("Google", "Search & video"),
        ["ytimg.com"] = ("Google", "Search & video"), ["doubleclick.net"] = ("Google", "Ads"),
        ["googlesyndication.com"] = ("Google", "Ads"), ["google-analytics.com"] = ("Google", "Analytics"),
        ["googletagmanager.com"] = ("Google", "Analytics"), ["gvt1.com"] = ("Google", "Search & video"), ["gvt2.com"] = ("Google", "Search & video"),
        ["microsoft.com"] = ("Microsoft", "Cloud & OS"), ["windows.com"] = ("Microsoft", "Cloud & OS"),
        ["windowsupdate.com"] = ("Microsoft", "Cloud & OS"), ["live.com"] = ("Microsoft", "Cloud & OS"),
        ["office.com"] = ("Microsoft", "Cloud & OS"), ["office.net"] = ("Microsoft", "Cloud & OS"),
        ["office365.com"] = ("Microsoft", "Cloud & OS"), ["microsoftonline.com"] = ("Microsoft", "Cloud & OS"),
        ["msn.com"] = ("Microsoft", "Cloud & OS"), ["bing.com"] = ("Microsoft", "Cloud & OS"),
        ["sharepoint.com"] = ("Microsoft", "Cloud & OS"), ["onedrive.com"] = ("Microsoft", "Cloud & OS"),
        ["azure.com"] = ("Microsoft", "Cloud & OS"), ["azureedge.net"] = ("Microsoft", "Cloud & OS"),
        ["visualstudio.com"] = ("Microsoft", "Developer"), ["vsassets.io"] = ("Microsoft", "Developer"),
        ["skype.com"] = ("Microsoft", "Chat"), ["xboxlive.com"] = ("Microsoft", "Games"),
        ["github.com"] = ("GitHub", "Developer"), ["githubusercontent.com"] = ("GitHub", "Developer"), ["githubassets.com"] = ("GitHub", "Developer"),
        ["facebook.com"] = ("Meta", "Social & ads"), ["facebook.net"] = ("Meta", "Social & ads"), ["fbcdn.net"] = ("Meta", "Social & ads"),
        ["instagram.com"] = ("Meta", "Social & ads"), ["cdninstagram.com"] = ("Meta", "Social & ads"), ["whatsapp.net"] = ("Meta", "Chat"), ["whatsapp.com"] = ("Meta", "Chat"),
        ["discord.com"] = ("Discord", "Chat"), ["discord.gg"] = ("Discord", "Chat"), ["discordapp.com"] = ("Discord", "Chat"),
        ["discordapp.net"] = ("Discord", "Chat"), ["discord.media"] = ("Discord", "Chat"),
        ["spotify.com"] = ("Spotify", "Music"), ["spotifycdn.com"] = ("Spotify", "Music"), ["scdn.co"] = ("Spotify", "Music"),
        ["steampowered.com"] = ("Valve", "Games"), ["steamcommunity.com"] = ("Valve", "Games"), ["steamcontent.com"] = ("Valve", "Games"),
        ["steamstatic.com"] = ("Valve", "Games"), ["steamserver.net"] = ("Valve", "Games"),
        ["anthropic.com"] = ("Anthropic", "AI"), ["claude.ai"] = ("Anthropic", "AI"), ["openai.com"] = ("OpenAI", "AI"), ["chatgpt.com"] = ("OpenAI", "AI"),
        ["apple.com"] = ("Apple", "Cloud & OS"), ["icloud.com"] = ("Apple", "Cloud & OS"),
        ["amazon.com"] = ("Amazon", "Shopping"), ["amazonaws.com"] = ("Amazon AWS", "Cloud"), ["cloudfront.net"] = ("Amazon AWS", "CDN"),
        ["cloudflare.com"] = ("Cloudflare", "CDN"), ["cloudflare-dns.com"] = ("Cloudflare", "CDN"),
        ["akamaized.net"] = ("Akamai", "CDN"), ["akamaihd.net"] = ("Akamai", "CDN"), ["akamai.net"] = ("Akamai", "CDN"), ["edgekey.net"] = ("Akamai", "CDN"),
        ["fastly.net"] = ("Fastly", "CDN"), ["fastly.com"] = ("Fastly", "CDN"),
        ["reddit.com"] = ("Reddit", "Social & ads"), ["redd.it"] = ("Reddit", "Social & ads"), ["redditmedia.com"] = ("Reddit", "Social & ads"),
        ["x.com"] = ("X", "Social & ads"), ["twitter.com"] = ("X", "Social & ads"), ["twimg.com"] = ("X", "Social & ads"),
        ["tiktok.com"] = ("TikTok", "Social & ads"), ["netflix.com"] = ("Netflix", "Video"), ["nflxvideo.net"] = ("Netflix", "Video"),
        ["twitch.tv"] = ("Twitch", "Video"), ["ttvnw.net"] = ("Twitch", "Video"), ["slack.com"] = ("Slack", "Chat"), ["slack-edge.com"] = ("Slack", "Chat"),
        ["mullvad.net"] = ("Mullvad", "VPN"), ["npmjs.org"] = ("npm", "Developer"), ["nuget.org"] = ("NuGet", "Developer"),
    };

    private readonly Reader? _asn;
    private readonly Reader? _country;
    private readonly Dictionary<string, CountryRow> _countries;

    public bool HasGeoData => _asn is not null && _country is not null;

    public ProviderResolver(string? geoDir)
    {
        _countries = LoadCountries();
        if (geoDir is null) return;
        _asn = Open(Path.Combine(geoDir, "dbip-asn-lite.mmdb"));
        _country = Open(Path.Combine(geoDir, "dbip-country-lite.mmdb"));
    }

    private static Reader? Open(string path) => File.Exists(path) ? new Reader(path, FileAccessMode.MemoryMapped) : null;

    private sealed record CountryRow(string Cc, string Name, double Lat, double Lng);

    private static Dictionary<string, CountryRow> LoadCountries()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("countries.json")!;
        var rows = JsonSerializer.Deserialize<CountryRow[]>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        return rows.ToDictionary(r => r.Cc, StringComparer.OrdinalIgnoreCase);
    }

    public HomeDto Home()
    {
        try
        {
            var region = RegionInfo.CurrentRegion;
            if (_countries.TryGetValue(region.TwoLetterISORegionName, out var row)) return new HomeDto(row.Lat, row.Lng, row.Name);
        }
        catch (ArgumentException) { }
        return new HomeDto(48, 14, "Unknown");
    }

    public static bool IsIgnored(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast)) return true;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6LinkLocal || ip.IsIPv6Multicast;
        var b = ip.GetAddressBytes();
        return b[0] >= 224 || (b[0] == 169 && b[1] == 254);
    }

    public static bool IsPrivate(IPAddress ip)
    {
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal;
        var b = ip.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and < 32) || (b[0] == 192 && b[1] == 168) || (b[0] == 100 && b[1] is >= 64 and < 128);
    }

    public (ProviderDto Provider, PlaceDto Place) Resolve(IPAddress ip, string? domain)
    {
        if (IsPrivate(ip)) return (LocalProvider, LocalPlace);
        var place = LookupPlace(ip);
        var (asnNumber, asnOrg) = LookupAsn(ip);
        var asn = asnNumber > 0 ? $"AS{asnNumber}" : "";

        if (domain is not null && MatchRule(domain) is { } rule)
            return (new ProviderDto(Slug(rule.Name), rule.Name, asn, rule.Category), place);
        if (asnOrg is not null)
        {
            var org = CleanOrg(asnOrg);
            return (new ProviderDto(Slug(org), org, asn, "Network owner"), place);
        }
        if (domain is not null)
        {
            var baseDomain = BaseDomain(domain);
            return (new ProviderDto(Slug(baseDomain), baseDomain, "", "From domain"), place);
        }
        return (UnknownProvider, place);
    }

    private static (string Name, string Category)? MatchRule(string domain)
    {
        var d = domain.TrimEnd('.');
        while (true)
        {
            if (Rules.TryGetValue(d, out var rule)) return rule;
            var dot = d.IndexOf('.');
            if (dot < 0) return null;
            d = d[(dot + 1)..];
        }
    }

    private static string BaseDomain(string domain)
    {
        var parts = domain.TrimEnd('.').Split('.');
        if (parts.Length <= 2) return domain.TrimEnd('.');
        var secondLevel = parts[^2] is "co" or "com" or "org" or "net" or "ac" or "gov" && parts[^1].Length == 2;
        return string.Join('.', parts[^(secondLevel ? 3 : 2)..]);
    }

    private static string Slug(string s) => s.ToLowerInvariant().Replace(' ', '-');

    // Strips legal suffixes so the database's "GitHub, Inc." merges with the "GitHub" domain rule.
    private static string CleanOrg(string org)
    {
        foreach (var suffix in new[] { ", Inc.", ", LLC", ", PBC", " LLC", " Inc.", " Inc", " Ltd.", " Ltd", " GmbH", " B.V.", " Limited", " Corporation", " Corp.", " d.o.o.", " d.d.", " AG", " S.A." })
            if (org.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) { org = org[..^suffix.Length]; break; }
        if (org.StartsWith("Akamai", StringComparison.OrdinalIgnoreCase)) return "Akamai";
        return org.Equals("Amazon.com", StringComparison.OrdinalIgnoreCase) ? "Amazon AWS" : org;
    }

    private PlaceDto LookupPlace(IPAddress ip)
    {
        if (_country?.Find<Dictionary<string, object>>(ip) is not { } row) return UnknownPlace;
        if (row.GetValueOrDefault("country") is not Dictionary<string, object> c || c.GetValueOrDefault("iso_code") is not string cc) return UnknownPlace;
        return _countries.TryGetValue(cc, out var known)
            ? new PlaceDto(cc, "", known.Name, cc, known.Lat, known.Lng)
            : new PlaceDto(cc, "", cc, cc, null, null);
    }

    private (long Number, string? Org) LookupAsn(IPAddress ip)
    {
        if (_asn?.Find<Dictionary<string, object>>(ip) is not { } row) return (0, null);
        var number = row.GetValueOrDefault("autonomous_system_number") is { } n ? Convert.ToInt64(n, CultureInfo.InvariantCulture) : 0;
        return (number, row.GetValueOrDefault("autonomous_system_organization") as string);
    }

    public void Dispose()
    {
        _asn?.Dispose();
        _country?.Dispose();
    }
}
