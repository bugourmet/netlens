using System.Text.Json;
using System.Text.Json.Serialization;

namespace NetLens.Core;

// Wire format sent as one JSON object per line. Mirrors src/data/types.ts and src/data/source.ts.

public sealed record AppDto(string Id, string Name, string Exe, string Path, string? Publisher, string[] Notes, bool Flagged);
public sealed record ProviderDto(string Id, string Name, string Asn, string Category);
public sealed record PlaceDto(string Id, string City, string Country, string Cc, double? Lat, double? Lng);
public sealed record FlowDto(int Index, string AppId, string ProviderId, string Domain, string Ip, int Port, string Proto, string PlaceId, bool Open);
public sealed record EventDto(long T, string Severity, string Title, string Detail, string AppId, string ProviderId);
public sealed record IdleDto(long Start, long End);
public sealed record HomeDto(double Lat, double Lng, string Label);

public sealed record SampleDto(long T, int[] Ids, float[] Down, float[] Up);

/// <summary>Trust notes shared by the capture side and the UI. The UI matches these exact strings.</summary>
public static class AppNotes
{
    public const string CheckingSignature = "Checking signature";
    public const string PathUnavailable = "Path unavailable";
}

public sealed record TickMessage(
    long T, int[] Ids, float[] Down, float[] Up,
    AppDto[] Apps, ProviderDto[] Providers, PlaceDto[] Places, FlowDto[] Flows, EventDto[] Events, IdleDto? Idle)
{
    public string Type => "tick";
}

public sealed record HelloMessage(
    string Mode, string[] Limits, HomeDto Home,
    AppDto[] Apps, ProviderDto[] Providers, PlaceDto[] Places, FlowDto[] Flows, EventDto[] Events, SampleDto[] History, IdleDto? Idle)
{
    public string Type => "hello";

    /// <summary>Bump when the message shapes change, so a mismatched UI and helper say so instead of misreading.</summary>
    public int Protocol => Wire.Version;
}

public static class Wire
{
    public const int Version = 1;

    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static string Encode<T>(T message) => JsonSerializer.Serialize(message, Options);
}
