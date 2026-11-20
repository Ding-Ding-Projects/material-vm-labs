namespace MaterialVmLabsSetup.Models;

// Mirrors C:\ProgramData\MaterialVmLabs\setup-state.json (schema 1), written by guest-tools.ps1.
public sealed class SetupState
{
    public int Schema { get; set; }
    public string? Name { get; set; }
    public string? Hypervisor { get; set; }
    public string? Owner { get; set; }
    public string? UpdatedUtc { get; set; }
    public bool Running { get; set; }
    public Dictionary<string, ItemState>? Items { get; set; }
    public SharedInfo? Shared { get; set; }
    public string? Log { get; set; }

    public ItemState? Item(string key)
    {
        if (Items == null) return null;
        foreach (var kv in Items)
            if (string.Equals(kv.Key, key, StringComparison.OrdinalIgnoreCase)) return kv.Value;
        return null;
    }

    public DateTime? UpdatedLocal =>
        DateTimeOffset.TryParse(UpdatedUtc, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal, out var t) ? t.LocalDateTime : null;
}

public sealed class ItemState
{
    public string? Status { get; set; }   // pending | running | done | failed
    public string? Detail { get; set; }
    public string? Version { get; set; }
}

public sealed class SharedInfo
{
    public string? GuestPath { get; set; }
    public string? HostPath { get; set; }
    public bool Shortcut { get; set; }
}

// Setup's own progress file: C:\ProgramData\MaterialVmLabs\setup-ui.json
public sealed class UiProgress
{
    public int Step { get; set; } = 1;
    public bool Completed { get; set; }
    public bool ClosedWhileRunning { get; set; }
}
