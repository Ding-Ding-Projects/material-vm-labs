using System.Text.Json;
using System.Windows.Threading;
using MaterialVmLabsSetup.Models;

namespace MaterialVmLabsSetup.Services;

// Reads setup-state.json on start and keeps it fresh: FileSystemWatcher plus a 2 s polling fallback.
// A missing file or a half-written file never throws; the last good state stays.
public sealed class StateService : IDisposable
{
    // MVL_SETUP_STATE_DIR points Setup at a practice state folder (used to test the takeovers);
    // without it Setup reads the real one the guest tools task writes.
    public static readonly string Dir =
        Environment.GetEnvironmentVariable("MVL_SETUP_STATE_DIR") is { Length: > 0 } test && Directory.Exists(test)
            ? test
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "MaterialVmLabs");
    public static readonly string StatePath = Path.Combine(Dir, "setup-state.json");
    public static readonly string UiPath = Path.Combine(Dir, "setup-ui.json");

    static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString,
    };

    readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(2) };
    FileSystemWatcher? _watcher;
    string? _lastRaw;
    bool _busy;

    public SetupState? Current { get; private set; }
    public event Action? Changed;

    public void Start()
    {
        TryWatch();
        _timer.Tick += async (_, _) => { TryWatch(); await PollAsync(); };
        _timer.Start();
        _ = PollAsync();
    }

    void TryWatch()
    {
        if (_watcher != null || !Directory.Exists(Dir)) return;
        try
        {
            _watcher = new FileSystemWatcher(Dir, "setup-state.json")
            {
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName,
                EnableRaisingEvents = true,
            };
            void hit(object? s, EventArgs e) =>
                System.Windows.Application.Current?.Dispatcher.BeginInvoke(new Action(async () => await PollAsync()));
            _watcher.Changed += hit; _watcher.Created += hit; _watcher.Renamed += hit;
        }
        catch { _watcher = null; }
    }

    // Synchronous first read used before the window exists.
    public SetupState? ReadNow()
    {
        var raw = ReadRaw();
        if (raw == null) return Current;
        return Parse(raw);
    }

    static string? ReadRaw()
    {
        try
        {
            if (!File.Exists(StatePath)) return null;
            using var fs = new FileStream(StatePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs, System.Text.Encoding.UTF8);
            return sr.ReadToEnd();
        }
        catch { return null; }
    }

    SetupState? Parse(string raw)
    {
        try
        {
            var s = JsonSerializer.Deserialize<SetupState>(raw.TrimStart('﻿'), Json);
            if (s == null) return Current;
            Current = s;
            _lastRaw = raw;
            return s;
        }
        catch (JsonException) { return Current; }   // mid-write: keep the last good state, retry next tick
    }

    public async Task PollAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            var raw = await Task.Run(ReadRaw);
            if (raw == null || raw == _lastRaw) return;
            var before = Current;
            var s = Parse(raw);
            if (!ReferenceEquals(before, s)) Changed?.Invoke();
        }
        finally { _busy = false; }
    }

    public static UiProgress LoadUi()
    {
        try
        {
            if (File.Exists(UiPath))
            {
                var p = JsonSerializer.Deserialize<UiProgress>(File.ReadAllText(UiPath), Json);
                if (p != null) return p;
            }
        }
        catch { /* fall through */ }
        return new UiProgress();
    }

    public static void SaveUi(UiProgress p)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var opt = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
            File.WriteAllText(UiPath, JsonSerializer.Serialize(p, opt));
        }
        catch { /* progress is a convenience, never fatal */ }
    }

    public void Dispose()
    {
        _timer.Stop();
        _watcher?.Dispose();
    }
}
