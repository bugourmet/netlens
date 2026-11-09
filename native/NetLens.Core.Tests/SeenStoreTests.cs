using NetLens.Core;

namespace NetLens.Core.Tests;

public sealed class SeenStoreTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("netlens-test-").FullName;
    private string DbPath => Path.Combine(_dir, "seen.db");

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public void Add_is_true_only_the_first_time()
    {
        using var store = new SeenStore(null, TimeSpan.Zero);
        Assert.True(store.Add("app|a"));
        Assert.False(store.Add("app|a"));
    }

    [Fact]
    public void Keys_survive_a_restart()
    {
        using (var store = new SeenStore(DbPath, TimeSpan.Zero))
        {
            store.Add("app|a");
        } // dispose flushes

        using var reopened = new SeenStore(DbPath, TimeSpan.Zero);
        Assert.False(reopened.Add("app|a"));
        Assert.True(reopened.Add("app|b"));
    }

    [Fact]
    public void Learning_lasts_from_the_first_run_not_each_start()
    {
        using (new SeenStore(DbPath, TimeSpan.FromHours(1))) { }
        using var later = new SeenStore(DbPath, TimeSpan.FromHours(1));
        Assert.True(later.Learning);

        using var noLearning = new SeenStore(null, TimeSpan.Zero);
        Assert.False(noLearning.Learning);
    }
}
