using System.IO.Pipes;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;

// Development only: relays the capture pipe to the Vite UI. Loopback-bound, and every
// connection needs the random token printed at start, so other local users and other
// web pages can't read your traffic through it.

var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:5184");
builder.Logging.ClearProviders();
var app = builder.Build();
app.UseWebSockets();

app.Map("/", async (HttpContext ctx) =>
{
    var given = Encoding.UTF8.GetBytes(ctx.Request.Query["token"].ToString());
    if (!ctx.WebSockets.IsWebSocketRequest || !CryptographicOperations.FixedTimeEquals(given, Encoding.UTF8.GetBytes(token)))
    {
        ctx.Response.StatusCode = 403;
        return;
    }
    using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
    try
    {
        await using var pipe = new NamedPipeClientStream(".", "netlens-capture", PipeDirection.In, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(5000, ctx.RequestAborted);
        using var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 64 * 1024);
        while (await reader.ReadLineAsync(ctx.RequestAborted) is { } line)
            await socket.SendAsync(Encoding.UTF8.GetBytes(line), WebSocketMessageType.Text, true, ctx.RequestAborted);
    }
    catch (Exception e) when (e is TimeoutException or IOException or OperationCanceledException or WebSocketException or UnauthorizedAccessException)
    {
        Console.WriteLine(e.Message);
    }
    if (socket.State == WebSocketState.Open)
        await socket.CloseAsync(WebSocketCloseStatus.EndpointUnavailable, "capture unavailable", CancellationToken.None);
});

Console.WriteLine($"Dev bridge ready. Open http://localhost:5183/?live={token}");
app.Run();
