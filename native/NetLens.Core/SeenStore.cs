using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;

namespace NetLens.Core;

/// <summary>
/// Remembers what has been seen across runs so "first seen" alerts mean something.
/// Lookups are in memory; writes go to disk in the background so the capture path never waits on I/O.
/// </summary>
public sealed class SeenStore : IDisposable
{
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(2);

    private readonly HashSet<string> _known = new();
    private readonly ConcurrentQueue<(string Key, long Seen)> _unsaved = new();
    private readonly object _dbGate = new();
    private readonly SqliteConnection? _db;
    private readonly Timer? _flushTimer;
    private readonly Action<string>? _log;
    private readonly long _learningUntil;

    /// <param name="path">Database file, or null to remember only until exit.</param>
    /// <param name="learning">After the first run, how long normal apps are recorded without alerting.</param>
    public SeenStore(string? path, TimeSpan learning, Action<string>? log = null)
    {
        _log = log;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (path is null)
        {
            _learningUntil = now + (long)learning.TotalSeconds;
            return;
        }

        _db = new SqliteConnection($"Data Source={path}");
        _db.Open();
        Execute("CREATE TABLE IF NOT EXISTS seen(key TEXT PRIMARY KEY, first_ts INTEGER NOT NULL)");
        Execute("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL)");

        using (var read = _db.CreateCommand())
        {
            read.CommandText = "SELECT key FROM seen";
            using var r = read.ExecuteReader();
            while (r.Read()) _known.Add(r.GetString(0));
        }

        using (var insert = _db.CreateCommand())
        {
            insert.CommandText = "INSERT OR IGNORE INTO meta VALUES('first_run', $now)";
            insert.Parameters.AddWithValue("$now", now);
            insert.ExecuteNonQuery();
        }
        using var get = _db.CreateCommand();
        get.CommandText = "SELECT value FROM meta WHERE key='first_run'";
        _learningUntil = (long)get.ExecuteScalar()! + (long)learning.TotalSeconds;

        _flushTimer = new Timer(_ => Flush(), null, FlushInterval, FlushInterval);
    }

    /// <summary>During the first period after install, normal apps are recorded without alerting.</summary>
    public bool Learning => DateTimeOffset.UtcNow.ToUnixTimeSeconds() < _learningUntil;

    /// <summary>Records the key. Returns true if it had never been seen before.</summary>
    public bool Add(string key)
    {
        lock (_known)
        {
            if (!_known.Add(key)) return false;
        }
        if (_db is not null) _unsaved.Enqueue((key, DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        return true;
    }

    /// <summary>Writes pending keys in one transaction. Safe to call from any thread.</summary>
    public void Flush()
    {
        if (_db is null || _unsaved.IsEmpty) return;
        lock (_dbGate)
        {
            try
            {
                using var tx = _db.BeginTransaction();
                using var cmd = _db.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = "INSERT OR IGNORE INTO seen VALUES($key, $ts)";
                var key = cmd.Parameters.Add("$key", SqliteType.Text);
                var ts = cmd.Parameters.Add("$ts", SqliteType.Integer);
                while (_unsaved.TryDequeue(out var item))
                {
                    key.Value = item.Key;
                    ts.Value = item.Seen;
                    cmd.ExecuteNonQuery();
                }
                tx.Commit();
            }
            catch (SqliteException e)
            {
                // Still known in memory for this run; only persistence is lost.
                _log?.Invoke($"seen store write failed: {e.Message}");
            }
        }
    }

    private void Execute(string sql)
    {
        using var cmd = _db!.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    public void Dispose()
    {
        _flushTimer?.Dispose();
        Flush();
        _db?.Dispose();
    }
}
