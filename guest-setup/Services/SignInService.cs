namespace MaterialVmLabsSetup.Services;

public enum SignInStatus { Checking, SignedIn, NotSignedIn, NotInstalled }

// Sign-in checks and launchers. Status comes only from exit codes of the official status commands;
// no token or credential file is ever read, and no password passes through this app.
public sealed class SignInService
{
    static string? CodexPath()
    {
        var npm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "codex.cmd");
        if (File.Exists(npm)) return npm;
        var p = ProcessRunner.FindOnPath("codex.cmd", "codex.exe");
        return p;
    }

    static string? GhPath()
    {
        var p = ProcessRunner.FindOnPath("gh.exe");
        if (p != null) return p;
        foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
        {
            var c = Path.Combine(root, "GitHub CLI", "gh.exe");
            if (File.Exists(c)) return c;
        }
        return null;
    }

    public async Task<SignInStatus> CheckCodexAsync()
    {
        var path = CodexPath();
        if (path == null) return SignInStatus.NotInstalled;
        var r = await ProcessRunner.RunCmdAsync("\"" + path + "\" login status");
        return r.Started && !r.TimedOut && r.ExitCode == 0 ? SignInStatus.SignedIn : SignInStatus.NotSignedIn;
    }

    public async Task<SignInStatus> CheckGhAsync()
    {
        var path = GhPath();
        if (path == null) return SignInStatus.NotInstalled;
        var r = await ProcessRunner.RunAsync(path, "auth status");
        return r.Started && !r.TimedOut && r.ExitCode == 0 ? SignInStatus.SignedIn : SignInStatus.NotSignedIn;
    }

    // Official browser sign-in for the CLI, in its own visible console.
    public bool StartCodexLogin() => ProcessRunner.LaunchVisibleConsole("codex login");

    // Device flow: gh shows a one-time code and opens the browser.
    public bool StartGhLogin() =>
        ProcessRunner.LaunchVisibleConsole("gh auth login --hostname github.com --git-protocol https --web");

    // Starts the Codex desktop app; the owner signs in inside it.
    public async Task<bool> LaunchDesktopAppAsync()
    {
        var r = await ProcessRunner.RunAsync("powershell.exe",
            "-NoProfile -Command \"(Get-StartApps | Where-Object Name -like '*Codex*' | Select-Object -First 1).AppID\"");
        var id = r.Output.Trim();
        if (!r.Started || r.TimedOut || string.IsNullOrWhiteSpace(id)) return false;
        return ProcessRunner.Launch("explorer.exe", "shell:AppsFolder\\" + id);
    }

    // Starts installs and retries through the scheduled task; installs never run inside this app.
    public async Task<bool> RunGuestToolsTaskAsync()
    {
        var r = await ProcessRunner.RunAsync("schtasks.exe", "/Run /TN \"\\MaterialVmLabs\\Guest Tools\"");
        return r.Started && !r.TimedOut && r.ExitCode == 0;
    }
}
