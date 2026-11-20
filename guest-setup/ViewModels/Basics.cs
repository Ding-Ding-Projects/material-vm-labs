using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using System.Windows.Media;

namespace MaterialVmLabsSetup.ViewModels;

public abstract class ObservableBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }

    protected void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public sealed class RelayCommand : ICommand
{
    readonly Func<object?, Task>? _async;
    readonly Action<object?>? _sync;
    readonly Func<bool>? _can;
    bool _running;

    public RelayCommand(Action run, Func<bool>? can = null) { _sync = _ => run(); _can = can; }
    public RelayCommand(Func<Task> run, Func<bool>? can = null) { _async = _ => run(); _can = can; }

    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? parameter) => !_running && (_can?.Invoke() ?? true);

    public async void Execute(object? parameter)
    {
        if (!CanExecute(parameter)) return;
        if (_sync != null) { _sync(parameter); return; }
        _running = true; CanExecuteChanged?.Invoke(this, EventArgs.Empty);
        try { await _async!(parameter); }
        finally { _running = false; CanExecuteChanged?.Invoke(this, EventArgs.Empty); }
    }

    public void Refresh() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

public static class Palette
{
    static SolidColorBrush B(string hex)
    {
        var b = (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;
        b.Freeze();
        return b;
    }

    public static readonly SolidColorBrush Accent = B("#C6F432");
    public static readonly SolidColorBrush Info = B("#5FD4FF");
    public static readonly SolidColorBrush Warn = B("#FFB86B");
    public static readonly SolidColorBrush Idle = B("#5B6A70");
    public static readonly SolidColorBrush Muted = B("#8FA0A6");
    public static readonly SolidColorBrush Soft = B("#A9B6BA");
    public static readonly SolidColorBrush Body = B("#C9D3D6");
    public static readonly SolidColorBrush Text = B("#E8EEF0");
    public static readonly SolidColorBrush Dark = B("#0B0F11");
    public static readonly SolidColorBrush Raised = B("#1C2427");
    public static readonly SolidColorBrush DoneDot = B("#1E2A10");
    public static readonly SolidColorBrush Clear = B("#00000000");
    public static readonly SolidColorBrush Bad = B("#FF8A7A");
    public static readonly SolidColorBrush Faint = B("#6B7A80");
    public static readonly SolidColorBrush Cell = B("#3A474C");
    public static readonly SolidColorBrush Track = B("#1A2226");
    public static readonly SolidColorBrush RowRun = B("#11242B");
}

// Reduced motion follows Windows: when client-area animation is off, nothing moves.
public static class Motion
{
    public static bool On => System.Windows.SystemParameters.ClientAreaAnimation;
}

public sealed class StepItem : ObservableBase
{
    public StepItem(int index, Action<int> pick) { Index = index; Pick = new RelayCommand(() => pick(index)); }
    public int Index { get; }
    public RelayCommand Pick { get; }

    string _title = "", _sub = "", _mark = "";
    Brush _subBrush = Palette.Muted, _dotBg = Palette.Raised, _dotFg = Palette.Body, _rowBg = Palette.Clear, _bar = Palette.Track;

    public string Title { get => _title; set { if (Set(ref _title, value)) Raise(nameof(AutomationName)); } }
    public string Sub { get => _sub; set { if (Set(ref _sub, value)) Raise(nameof(AutomationName)); } }
    public string Mark { get => _mark; set => Set(ref _mark, value); }
    public Brush SubBrush { get => _subBrush; set => Set(ref _subBrush, value); }
    public Brush DotBg { get => _dotBg; set => Set(ref _dotBg, value); }
    public Brush DotFg { get => _dotFg; set => Set(ref _dotFg, value); }
    public Brush RowBg { get => _rowBg; set => Set(ref _rowBg, value); }
    public Brush BarBrush { get => _bar; set => Set(ref _bar, value); }
    public string AutomationName => $"Step {Index + 1}, {Title}, {Sub}";
}

public sealed record RowItem(string Label, string Value, Brush Dot, Brush ValueBrush, bool Pulse = false);

public sealed class ActionItem
{
    public ActionItem(string label, bool primary, RelayCommand command) { Label = label; IsPrimary = primary; Command = command; }
    public string Label { get; }
    public bool IsPrimary { get; }
    public RelayCommand Command { get; }
}

// One tool in the left charging list: a battery cell that fills to the tool's state.
public sealed class ToolCell : ObservableBase
{
    public ToolCell(string key, string name) { Key = key; Name = name; }
    public string Key { get; }
    public string Name { get; }

    string _state = "waiting";
    double _fill;
    Brush _color = Palette.Cell, _stateBrush = Palette.Faint, _rowBg = Palette.Clear;
    bool _pulse;

    public string State { get => _state; private set { if (Set(ref _state, value)) Raise(nameof(AutomationName)); } }
    public double Fill { get => _fill; private set => Set(ref _fill, value); }
    public Brush Color { get => _color; private set => Set(ref _color, value); }
    public Brush StateBrush { get => _stateBrush; private set => Set(ref _stateBrush, value); }
    public Brush RowBg { get => _rowBg; private set => Set(ref _rowBg, value); }
    public bool Pulse { get => _pulse; private set => Set(ref _pulse, value); }
    public string AutomationName => $"{Name}, {State}";

    // status: waiting (no state file yet) | pending | running | done | failed
    public void Apply(string status, string? version)
    {
        switch (status)
        {
            case "done":
                State = string.IsNullOrWhiteSpace(version) ? "installed" : version!;
                Fill = 1; Color = Palette.Accent; StateBrush = Palette.Accent; RowBg = Palette.Clear; Pulse = false;
                break;
            case "running":
                State = "installing";
                Fill = 0.5; Color = Palette.Info; StateBrush = Palette.Info; RowBg = Palette.RowRun; Pulse = Motion.On;
                break;
            case "failed":
                State = "failed";
                Fill = 0.4; Color = Palette.Bad; StateBrush = Palette.Bad; RowBg = Palette.Clear; Pulse = false;
                break;
            default:
                State = "waiting";
                Fill = 0; Color = Palette.Cell; StateBrush = Palette.Faint; RowBg = Palette.Clear; Pulse = false;
                break;
        }
    }
}

// A full-window takeover: install success or install failure ("problem").
public sealed class Takeover
{
    public Takeover(bool isSuccess, string key, string tool) { IsSuccess = isSuccess; Key = key; Tool = tool; }
    public bool IsSuccess { get; }
    public string Key { get; }
    public string Tool { get; }
    public string Headline { get; init; } = "";
    public string Version { get; init; } = "";
    public bool HasVersion => Version.Length > 0;
    public string Command { get; init; } = "";
    public string Summary { get; init; } = "";
    public string Detail { get; init; } = "";
    public string Log { get; init; } = "";
    public string Announcement { get; init; } = "";
}
