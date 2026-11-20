using System.Collections.ObjectModel;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Windows.Media;
using System.Windows.Threading;
using MaterialVmLabsSetup.Models;
using MaterialVmLabsSetup.Services;

namespace MaterialVmLabsSetup.ViewModels;

enum Kind { Waiting, Pending, Running, Done, Failed }

public sealed class MainViewModel : ObservableBase
{
    const int StepCount = 6;

    static readonly string[] Titles = { "Tools", "Codex desktop", "Codex CLI", "Sign in", "Shared folder", "Ready" };
    static readonly string[] Bodies =
    {
        "Setup puts the dependencies every lab machine needs on this machine: Git, Chocolatey, Node.js and the GitHub CLI. They install in their own task, so closing Setup does not stop them.",
        "The desktop app comes from the Microsoft Store through winget, the route OpenAI documents. Setup checks it is installed and starts.",
        "The command-line Codex installs with npm as @openai/codex, with Node.js as its dependency. It runs in its own task, so closing Setup does not stop it.",
        "Sign in with your own accounts, one for Codex and one for GitHub. Each opens its official sign-in; you type your password there. Setup never sees, stores, copies or sends a password or a token.",
        "One folder is shared with the PC hosting this machine. Drop files in on either side.",
        "Close Setup, or open Codex and start working. Anything still waiting is listed here.",
    };

    readonly StateService _state = new();
    readonly SignInService _sign = new();
    readonly DispatcherTimer _signTimer = new() { Interval = TimeSpan.FromSeconds(5) };
    readonly UiProgress _ui;
    readonly Queue<Takeover> _queue = new();
    readonly DispatcherTimer _auto = new() { Interval = TimeSpan.FromSeconds(6) };
    Dictionary<string, string>? _prev;
    Takeover? _takeover;

    sealed record ToolDef(string Key, string Name, string Command, string[] Tokens);

    // Order is the order of the left charging list. Commands are the fixed ones guest-tools.ps1 runs.
    static readonly ToolDef[] ToolDefs =
    {
        new("git", "Git", "choco install git", new[] { "git" }),
        new("choco", "Chocolatey", "Chocolatey install script", new[] { "choco" }),
        new("node", "Node.js", "choco install nodejs-lts", new[] { "node" }),
        new("gh", "GitHub CLI", "choco install gh", new[] { "gh ", "github", "choco install gh" }),
        new("cli", "Codex CLI", "npm install -g @openai/codex", new[] { "codex", "npm" }),
        new("desktop", "Codex desktop", "winget install --id 9PLM9XGG6VKS -s msstore", new[] { "desktop", "9PLM9XGG6VKS", "winget", "store" }),
    };

    SignInStatus _codex = SignInStatus.Checking, _gh = SignInStatus.Checking;
    bool _checkingSign, _completed;
    int _index;
    string _signature = "";

    public MainViewModel()
    {
        _ui = StateService.LoadUi();
        _completed = _ui.Completed;
        _index = Math.Clamp(_ui.Step - 1, 0, StepCount - 1);

        Steps = new ObservableCollection<StepItem>(Enumerable.Range(0, StepCount).Select(i => new StepItem(i, GoTo)));
        Tools = new ObservableCollection<ToolCell>(ToolDefs.Select(d => new ToolCell(d.Key, d.Name)));
        BackCommand = new RelayCommand(() => GoTo(_index - 1), () => _index > 0);
        NextCommand = new RelayCommand(Next);
        SkipCommand = new RelayCommand(() => GoTo(_index + 1));
        DismissCommand = new RelayCommand(() => BannerVisible = false);
        DismissTakeoverCommand = new RelayCommand(DismissTakeover);
        OpenLogCommand = new RelayCommand(OpenLog);
        RetryTakeoverCommand = new RelayCommand(async () =>
        {
            DismissTakeover();
            Message = "Starting the tools task...";
            var ok = await _sign.RunGuestToolsTaskAsync();
            Message = ok ? "The tools task is running. Progress shows here." : "Could not start the tools task. See the install log.";
        });
        _auto.Tick += (_, _) => { if (_takeover?.IsSuccess == true) DismissTakeover(); };

        var first = _state.ReadNow();
        _prev = Snapshot(first);   // transitions are only judged against states seen while Setup is open
        MaybeShowBanner(first);
        if (_ui.ClosedWhileRunning) { _ui.ClosedWhileRunning = false; SaveUi(); }

        RefreshAll();
        _state.Changed += () => { DetectTransitions(); RefreshAll(); };
        _state.Start();
        _signTimer.Tick += async (_, _) => { if (_index == 3) await RefreshSignInAsync(); };
        _signTimer.Start();
        _ = RefreshSignInAsync();
    }

    public event Action? CloseRequested;

    public ObservableCollection<StepItem> Steps { get; }
    public RelayCommand BackCommand { get; }
    public RelayCommand NextCommand { get; }
    public RelayCommand SkipCommand { get; }
    public RelayCommand DismissCommand { get; }
    public RelayCommand DismissTakeoverCommand { get; }
    public RelayCommand OpenLogCommand { get; }
    public RelayCommand RetryTakeoverCommand { get; }
    public ObservableCollection<ToolCell> Tools { get; }

    int _overall;
    public int Overall { get => _overall; private set { if (Set(ref _overall, value)) Raise(nameof(OverallLabel)); } }
    public string OverallLabel => $"Overall {_overall} percent charged";
    public int StepNumber => _index + 1;
    public string StepLabelUpper => $"STEP {_index + 1} OF {StepCount}";

    public Takeover? Takeover
    {
        get => _takeover;
        private set
        {
            if (!Set(ref _takeover, value)) return;
            Raise(nameof(TakeoverVisible)); Raise(nameof(IsTakeoverSuccess)); Raise(nameof(IsTakeoverAlarm));
        }
    }
    public bool TakeoverVisible => _takeover != null;
    public bool IsTakeoverSuccess => _takeover?.IsSuccess == true;
    public bool IsTakeoverAlarm => _takeover != null && !_takeover.IsSuccess;

    public int CurrentIndex => _index;
    public string StepLabel => $"Step {_index + 1} of {StepCount}";
    public string NextLabel => _index == StepCount - 1 ? "Finish" : "Next";
    public bool CanSkip => _index < StepCount - 1;

    string _plate = "MATERIAL VM LABS", _parked = "", _title = "", _body = "", _note = "", _message = "", _bannerText = "";
    bool _bannerVisible, _showProgress;
    double _progress;
    IReadOnlyList<RowItem> _rows = Array.Empty<RowItem>();
    IReadOnlyList<ActionItem> _actions = Array.Empty<ActionItem>();

    public string Plate { get => _plate; private set => Set(ref _plate, value); }
    public string Created { get => _parked; private set => Set(ref _parked, value); }
    public string PageTitle { get => _title; private set => Set(ref _title, value); }
    public string PageBody { get => _body; private set => Set(ref _body, value); }
    public string Note { get => _note; private set { if (Set(ref _note, value)) Raise(nameof(HasNote)); } }
    public bool HasNote => _note.Length > 0;
    public string Message { get => _message; private set { if (Set(ref _message, value)) Raise(nameof(HasMessage)); } }
    public bool HasMessage => _message.Length > 0;
    public bool ShowProgress { get => _showProgress; private set => Set(ref _showProgress, value); }
    bool _sweep;
    public bool Sweep { get => _sweep; private set => Set(ref _sweep, value); }
    public double Progress { get => _progress; private set => Set(ref _progress, value); }
    public IReadOnlyList<RowItem> Rows { get => _rows; private set => Set(ref _rows, value); }
    public IReadOnlyList<ActionItem> Actions { get => _actions; private set => Set(ref _actions, value); }
    public bool BannerVisible { get => _bannerVisible; set => Set(ref _bannerVisible, value); }
    public string BannerText { get => _bannerText; private set => Set(ref _bannerText, value); }

    // ---- navigation ----

    void GoTo(int i)
    {
        i = Math.Clamp(i, 0, StepCount - 1);
        if (i == _index) return;
        _index = i;
        Message = "";
        Raise(nameof(CurrentIndex)); Raise(nameof(StepNumber)); Raise(nameof(StepLabelUpper)); Raise(nameof(StepLabel)); Raise(nameof(NextLabel)); Raise(nameof(CanSkip));
        BackCommand.Refresh();
        SaveUi();
        RefreshAll(force: true);
        if (i == 3) _ = RefreshSignInAsync();
    }

    void Next()
    {
        if (_index < StepCount - 1) { GoTo(_index + 1); return; }
        _completed = true;
        SaveUi();
        CloseRequested?.Invoke();
    }

    void SaveUi()
    {
        _ui.Step = _index + 1;
        _ui.Completed = _completed;
        StateService.SaveUi(_ui);
    }

    // Called when the window closes. Closing is always allowed; installs keep running in their own task.
    public void OnClosing()
    {
        _ui.Step = _index + 1;
        _ui.Completed = _completed;
        _ui.ClosedWhileRunning = !_completed && _state.Current?.Running == true;
        StateService.SaveUi(_ui);
        _state.Dispose();
        _signTimer.Stop();
        _auto.Stop();
    }

    public async void OnActivated() => await RefreshSignInAsync();

    // ---- resume banner ----

    void MaybeShowBanner(SetupState? s)
    {
        if (!_ui.ClosedWhileRunning || s == null) return;
        var items = s.Items?.Values.ToList() ?? new List<ItemState>();
        int done = items.Count(x => Is(x, "done")), failed = items.Count(x => Is(x, "failed"));
        if (!s.Running && done == 0 && failed == 0) return;
        var at = s.UpdatedLocal?.ToString("HH:mm") ?? DateTime.Now.ToString("HH:mm");
        BannerText = s.Running
            ? $"Setup was closed while installs were running. They kept going on their own and are still running; picked up here at {at}."
            : $"Setup was closed while installs were running. They kept going on their own: {done} finished" +
              (failed > 0 ? $", {failed} need attention" : "") + $"; picked up here at {at}.";
        BannerVisible = true;
    }

    static bool Is(ItemState? i, string status) => string.Equals(i?.Status, status, StringComparison.OrdinalIgnoreCase);

    // ---- install takeovers ----

    static Dictionary<string, string>? Snapshot(SetupState? s)
    {
        if (s?.Items == null) return null;
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in s.Items) d[kv.Key] = kv.Value?.Status?.ToLowerInvariant() ?? "pending";
        return d;
    }

    // Only a real change while Setup is open counts: pending/running -> done is a success,
    // pending/running -> failed is a problem. What was already done or failed at start never fires.
    void DetectTransitions()
    {
        var snap = Snapshot(_state.Current);
        if (snap == null) return;
        var was = _prev;
        _prev = snap;
        if (was == null) return;
        foreach (var d in ToolDefs)
        {
            var before = was.TryGetValue(d.Key, out var b) ? b : "pending";
            var now = snap.TryGetValue(d.Key, out var n) ? n : "pending";
            if (before is not ("pending" or "running")) continue;
            if (now == "done") Enqueue(BuildSuccess(d, _state.Current?.Item(d.Key), snap));
            else if (now == "failed") Enqueue(BuildAlarm(d, _state.Current?.Item(d.Key)));
        }
    }

    static bool DoneIn(Dictionary<string, string> snap, string key) => snap.TryGetValue(key, out var v) && v == "done";

    Takeover BuildSuccess(ToolDef d, ItemState? it, Dictionary<string, string> snap)
    {
        int charged = ToolDefs.Count(x => DoneIn(snap, x.Key));
        var next = ToolDefs.FirstOrDefault(x => x.Key != d.Key && !DoneIn(snap, x.Key));
        var summary = $"{charged} of {ToolDefs.Length} charged. Next: {next?.Name ?? "Sign in"}.";
        return new Takeover(true, d.Key, d.Name)
        {
            Headline = d.Name,
            Version = it?.Version?.Trim() ?? "",
            Command = d.Command,
            Summary = summary,
            Announcement = $"Installed. {d.Name}. {summary}",
        };
    }

    Takeover BuildAlarm(ToolDef d, ItemState? it)
    {
        var detail = string.IsNullOrWhiteSpace(it?.Detail) ? "Setup recorded no detail for this step." : it!.Detail!.Trim();
        var log = LogTail.Relevant(_state.Current?.Log, d.Tokens, 6);
        return new Takeover(false, d.Key, d.Name)
        {
            Headline = d.Name + " did not install",
            Command = d.Command,
            Detail = detail,
            Log = log,
            Announcement = $"Problem. Install stopped. {d.Name} did not install. {detail}",
        };
    }

    void Enqueue(Takeover t)
    {
        if (_takeover == null) Present(t); else _queue.Enqueue(t);
    }

    void Present(Takeover t)
    {
        _auto.Stop();
        Takeover = t;
        if (t.IsSuccess) _auto.Start();   // the failure stays until the person chooses
    }

    void DismissTakeover()
    {
        _auto.Stop();
        if (_queue.Count > 0) Present(_queue.Dequeue()); else Takeover = null;
    }

    void OpenLog()
    {
        var path = _state.Current?.Log;
        if (string.IsNullOrWhiteSpace(path)) path = LogTail.DefaultPath;
        if (File.Exists(path)) ProcessRunner.Launch("notepad.exe", "\"" + path + "\"");
        else Message = "No install log yet.";
    }

    // ---- sign-in ----

    async Task RefreshSignInAsync()
    {
        if (_checkingSign) return;
        _checkingSign = true;
        try
        {
            var c = _sign.CheckCodexAsync();
            var g = _sign.CheckGhAsync();
            var codex = await c; var gh = await g;
            if (codex != _codex || gh != _gh) { _codex = codex; _gh = gh; RefreshAll(); }
        }
        finally { _checkingSign = false; }
    }

    // ---- model ----

    (Kind kind, int pct) Eval(params string[] keys)
    {
        var s = _state.Current;
        if (s == null) return (Kind.Waiting, 0);
        var sts = keys.Select(k => s.Item(k)?.Status?.ToLowerInvariant() ?? "pending").ToList();
        double pts = sts.Sum(x => x == "done" ? 1.0 : x == "running" ? 0.5 : 0);
        int pct = (int)Math.Round(pts / keys.Length * 100);
        if (sts.Any(x => x == "failed")) return (Kind.Failed, pct);
        if (sts.Any(x => x == "running")) return (Kind.Running, pct);
        if (sts.All(x => x == "done")) return (Kind.Done, 100);
        return (Kind.Pending, pct);
    }

    static readonly string[][] StepKeys =
    {
        new[] { "git", "choco", "node", "gh" },
        new[] { "desktop" },
        new[] { "node", "cli" },
    };

    (string sub, Brush brush, bool done, int pct) StepSummary(int i)
    {
        var s = _state.Current;
        switch (i)
        {
            case 0: case 1: case 2:
            {
                var (k, pct) = Eval(StepKeys[i]);
                return k switch
                {
                    Kind.Done => ("Installed", Palette.Accent, true, 100),
                    Kind.Running => ($"Installing · {pct}%", Palette.Info, false, pct),
                    Kind.Failed => ("Needs attention", Palette.Warn, false, pct),
                    Kind.Pending => (s?.Running == true ? "Queued" : "Waiting to start", Palette.Muted, false, pct),
                    _ => ("Waiting for the tools task", Palette.Muted, false, 0),
                };
            }
            case 3:
                if (_codex == SignInStatus.SignedIn && _gh == SignInStatus.SignedIn) return ("Signed in", Palette.Accent, true, 0);
                if (_codex == SignInStatus.Checking || _gh == SignInStatus.Checking) return ("Checking", Palette.Muted, false, 0);
                return ("Waiting for you", Palette.Muted, false, 0);
            case 4:
                if (s == null) return ("Waiting for the tools task", Palette.Muted, false, 0);
                return s.Shared != null ? ("Connected", Palette.Accent, true, 0) : ("None on this machine", Palette.Muted, false, 0);
            default:
                var allDone = Enumerable.Range(0, 4).All(n => StepSummary(n).done);
                return _completed ? ("Finished", Palette.Accent, true, 0) : (allDone ? ("Ready", Palette.Accent, false, 0) : ("Almost", Palette.Muted, false, 0));
        }
    }

    RowItem ItemRow(string label, string key, bool showVersion = true)
    {
        var s = _state.Current;
        var it = s?.Item(key);
        var st = it?.Status?.ToLowerInvariant() ?? "pending";
        if (s == null) return new RowItem(label, "waiting", Palette.Idle, Palette.Soft);
        return st switch
        {
            "done" => new RowItem(label, showVersion && !string.IsNullOrWhiteSpace(it?.Version) ? it!.Version! : "installed", Palette.Accent, Palette.Accent),
            "running" => new RowItem(label, "running", Palette.Info, Palette.Info, Motion.On),
            "failed" => new RowItem(label, Trim("failed" + (string.IsNullOrWhiteSpace(it?.Detail) ? "" : " · " + it!.Detail), 60), Palette.Warn, Palette.Warn),
            _ => new RowItem(label, "waiting", Palette.Idle, Palette.Soft),
        };
    }

    static string Trim(string t, int n) => t.Length <= n ? t : t[..(n - 1)] + "…";

    static RowItem SignRow(string label, SignInStatus st) => st switch
    {
        SignInStatus.SignedIn => new RowItem(label, "Signed in", Palette.Accent, Palette.Accent),
        SignInStatus.Checking => new RowItem(label, "Checking", Palette.Info, Palette.Info),
        SignInStatus.NotInstalled => new RowItem(label, "not installed yet", Palette.Idle, Palette.Soft),
        _ => new RowItem(label, "Not signed in", Palette.Idle, Palette.Soft),
    };

    ActionItem Act(string label, bool primary, Func<Task> run) => new(label, primary, new RelayCommand(run));
    ActionItem Act(string label, bool primary, Action run) => new(label, primary, new RelayCommand(run));

    ActionItem InstallAction(Kind k) => Act(
        k == Kind.Failed ? "Retry the install" : "Start the install", k != Kind.Done,
        async () =>
        {
            Message = "Starting the tools task...";
            var ok = await _sign.RunGuestToolsTaskAsync();
            Message = ok ? "The tools task is running. Progress shows here." : "Could not start the tools task. See the install log.";
        });

    ActionItem LogAction() => Act("Show the install log", false, OpenLog);

    ActionItem OpenDesktopAction(bool primary, string label = "Open Codex") => Act(label, primary, async () =>
    {
        Message = "Starting Codex...";
        Message = await _sign.LaunchDesktopAppAsync() ? "Codex is starting." : "Could not find the Codex desktop app yet.";
    });

    void RefreshAll(bool force = false)
    {
        var s = _state.Current;
        string name = string.IsNullOrWhiteSpace(s?.Name) ? "MATERIAL VM LABS" : s!.Name!.ToUpperInvariant();
        string hv = (s?.Hypervisor ?? "").ToLowerInvariant() switch
        {
            "vmware" => "VMware", "virtualbox" => "VirtualBox", "" => "", var o => o,
        };
        var ip = LocalIp();
        var parts = new List<string> { $"Created by {(string.IsNullOrWhiteSpace(s?.Owner) ? "you" : s!.Owner)}" };
        if (hv.Length > 0) parts.Add(hv);
        if (ip != null) parts.Add(ip);
        Plate = name;
        Created = string.Join(" · ", parts);

        for (int n = 0; n < StepCount; n++)
        {
            var st = Steps[n];
            var (sub, brush, done, _) = StepSummary(n);
            bool cur = n == _index;
            st.Title = Titles[n];
            st.Sub = sub;
            st.Mark = done ? "✓" : (n + 1).ToString();
            st.RowBg = cur ? Palette.Raised : Palette.Clear;
            st.DotBg = done ? Palette.DoneDot : (cur ? Palette.Accent : Palette.Raised);
            st.DotFg = done ? Palette.Accent : (cur ? Palette.Dark : Palette.Body);
            st.BarBrush = cur ? Palette.Text : (done ? Palette.Accent : Palette.Track);
            st.SubBrush = done ? Palette.Accent : (brush == Palette.Info ? Palette.Info : (cur ? Palette.Body : Palette.Muted));
        }

        double pts = 0;
        foreach (var cell in Tools)
        {
            var it = s?.Item(cell.Key);
            var status = s == null ? "waiting" : (it?.Status?.ToLowerInvariant() ?? "pending");
            cell.Apply(status, it?.Version);
            pts += status == "done" ? 1.0 : status == "running" ? 0.5 : 0;
        }
        Overall = (int)Math.Round(pts / Tools.Count * 100);

        var (rows, actions, note, progress) = BuildPage(s);
        var sig = _index + "|" + string.Join(";", rows.Select(r => r.Label + "=" + r.Value)) + "|"
                  + string.Join(";", actions.Select(a => a.Label + a.IsPrimary)) + "|" + note + "|" + (progress ?? -1);
        if (!force && sig == _signature) return;
        _signature = sig;
        PageTitle = Titles[_index];
        PageBody = Bodies[_index];
        Rows = rows;
        Actions = actions;
        Note = note;
        ShowProgress = progress != null;
        Sweep = progress != null && Motion.On;
        Progress = progress ?? 0;
    }

    (List<RowItem>, List<ActionItem>, string, double?) BuildPage(SetupState? s)
    {
        var rows = new List<RowItem>();
        var actions = new List<ActionItem>();
        string note = "";
        double? progress = null;

        switch (_index)
        {
            case 0:
            case 1:
            case 2:
            {
                var (k, pct) = Eval(StepKeys[_index]);
                if (_index == 0)
                {
                    rows.Add(ItemRow("Git (Git for Windows)", "git"));
                    rows.Add(ItemRow("Chocolatey", "choco"));
                    rows.Add(ItemRow("Node.js", "node"));
                    rows.Add(ItemRow("GitHub CLI (gh)", "gh"));
                }
                else if (_index == 1)
                {
                    rows.Add(ItemRow("Store package 9PLM9XGG6VKS", "desktop", false));
                    rows.Add(ItemRow("Git for the review panel", "git"));
                }
                else
                {
                    rows.Add(ItemRow("Node.js", "node"));
                    rows.Add(ItemRow("npm install -g @openai/codex", "cli", false));
                    var cli = s?.Item("cli");
                    rows.Add(Is(cli, "done")
                        ? new RowItem("codex --version", string.IsNullOrWhiteSpace(cli?.Version) ? "checked" : cli!.Version!, Palette.Accent, Palette.Accent)
                        : new RowItem("codex --version", "waiting", Palette.Idle, Palette.Soft));
                }
                if (s == null) note = "Waiting for the tools task. It writes its progress to C:\\ProgramData\\MaterialVmLabs\\setup-state.json.";
                if (k == Kind.Running) progress = pct;
                if (k != Kind.Running) actions.Add(InstallAction(k));
                if (_index == 1 && Is(s?.Item("desktop"), "done")) actions.Add(OpenDesktopAction(false));
                // The Store can still be finishing, or refuse an unattended install: one click finishes it.
                if (_index == 1 && !Is(s?.Item("desktop"), "done") && k != Kind.Running)
                    actions.Add(Act("Open in the Microsoft Store", true, () =>
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-windows-store://pdp/?ProductId=9PLM9XGG6VKS") { UseShellExecute = true })?.Dispose();
                        Message = "The Microsoft Store is opening on Codex. Press Get or Install there; Setup notices when it is installed.";
                    }));
                actions.Add(LogAction());
                break;
            }
            case 3:
                rows.Add(SignRow("Codex (codex login status)", _codex));
                rows.Add(SignRow("GitHub (gh auth status)", _gh));
                actions.Add(Act("Sign in to the desktop app", _codex != SignInStatus.SignedIn, async () =>
                {
                    Message = "Starting the Codex desktop app. Sign in inside it.";
                    if (!await _sign.LaunchDesktopAppAsync()) Message = "Could not find the Codex desktop app yet.";
                }));
                actions.Add(Act("Sign in to the CLI", false, () =>
                {
                    Message = _sign.StartCodexLogin() ? "A sign-in console opened. Finish in the browser." : "Could not open the console.";
                }));
                actions.Add(Act("Sign in to GitHub", _gh != SignInStatus.SignedIn, () =>
                {
                    Message = _sign.StartGhLogin() ? "A console opened with a one-time code. Finish in the browser." : "Could not open the console.";
                }));
                note = "Only on machines you create. A lab machine that Claude parks skips this whole Setup and never gets a sign-in.";
                break;
            case 4:
            {
                var sh = s?.Shared;
                if (sh != null)
                {
                    rows.Add(new RowItem("In this machine", sh.GuestPath ?? "unknown", Palette.Accent, Palette.Body));
                    rows.Add(new RowItem("On the host PC", sh.HostPath ?? "unknown", Palette.Accent, Palette.Body));
                    rows.Add(new RowItem("Desktop shortcut", sh.Shortcut ? "Shared with host" : "not created", sh.Shortcut ? Palette.Accent : Palette.Idle, Palette.Body));
                    if (!string.IsNullOrWhiteSpace(sh.GuestPath))
                        actions.Add(Act("Open the shared folder", true, () =>
                        {
                            if (!ProcessRunner.Launch("explorer.exe", "\"" + sh.GuestPath + "\"")) Message = "Could not open the shared folder.";
                        }));
                }
                else
                {
                    rows.Add(new RowItem("Shared folder", s == null ? "waiting for the tools task" : "No shared folder on this machine", Palette.Idle, Palette.Soft));
                }
                break;
            }
            default:
            {
                var tools = Eval("git", "choco", "node", "gh").kind;
                var desk = Eval("desktop").kind;
                var cli = Eval("cli").kind;
                RowItem Sum(string label, Kind k, string runWord) => k switch
                {
                    Kind.Done => new RowItem(label, "installed", Palette.Accent, Palette.Accent),
                    Kind.Running => new RowItem(label, runWord, Palette.Info, Palette.Info, Motion.On),
                    Kind.Failed => new RowItem(label, "needs attention", Palette.Warn, Palette.Warn),
                    _ => new RowItem(label, "waiting", Palette.Idle, Palette.Soft),
                };
                rows.Add(Sum("Tools (Git, Chocolatey, Node.js, gh)", tools, "still installing"));
                rows.Add(Sum("Codex desktop", desk, "still installing"));
                rows.Add(Sum("Codex CLI", cli, "still installing"));
                bool both = _codex == SignInStatus.SignedIn && _gh == SignInStatus.SignedIn;
                rows.Add(both ? new RowItem("Sign in", "Codex and GitHub", Palette.Accent, Palette.Accent)
                              : new RowItem("Sign in", _codex == SignInStatus.SignedIn ? "GitHub waiting for you" : _gh == SignInStatus.SignedIn ? "Codex waiting for you" : "waiting for you", Palette.Idle, Palette.Soft));
                rows.Add(s?.Shared != null ? new RowItem("Shared folder", "connected", Palette.Accent, Palette.Accent)
                                           : new RowItem("Shared folder", s == null ? "waiting" : "none on this machine", Palette.Idle, Palette.Soft));
                actions.Add(OpenDesktopAction(true));
                actions.Add(Act("Close Setup", false, () => CloseRequested?.Invoke()));
                break;
            }
        }
        return (rows, actions, note, progress);
    }

    static string? LocalIp()
    {
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !ua.Address.ToString().StartsWith("169.254"))
                        return ua.Address.ToString();
            }
        }
        catch { /* the address is optional */ }
        return null;
    }
}
