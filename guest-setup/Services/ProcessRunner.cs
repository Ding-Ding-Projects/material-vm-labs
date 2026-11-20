using System.Diagnostics;

namespace MaterialVmLabsSetup.Services;

public sealed record RunResult(bool Started, int ExitCode, string Output, string Error, bool TimedOut);

// Async process calls with a timeout; nothing here ever blocks the UI thread.
public static class ProcessRunner
{
    public const int DefaultTimeoutMs = 15000;

    // The app may have started at logon before installs finished, so its own PATH can be stale.
    // Rebuild it from the machine and user values plus the npm global folder.
    public static string FreshPath()
    {
        var parts = new List<string>();
        foreach (var target in new[] { EnvironmentVariableTarget.Machine, EnvironmentVariableTarget.User })
        {
            var v = Environment.GetEnvironmentVariable("PATH", target);
            if (!string.IsNullOrWhiteSpace(v)) parts.Add(Environment.ExpandEnvironmentVariables(v));
        }
        parts.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm"));
        var cur = Environment.GetEnvironmentVariable("PATH");
        if (!string.IsNullOrWhiteSpace(cur)) parts.Add(cur);
        return string.Join(';', parts);
    }

    public static string? FindOnPath(params string[] names)
    {
        foreach (var dir in FreshPath().Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var n in names)
            {
                try
                {
                    var p = Path.Combine(dir.Trim('"'), n);
                    if (File.Exists(p)) return p;
                }
                catch { /* bad path entry */ }
            }
        }
        return null;
    }

    public static async Task<RunResult> RunAsync(string file, string args, int timeoutMs = DefaultTimeoutMs)
    {
        var psi = new ProcessStartInfo(file, args)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.Environment["PATH"] = FreshPath();
        try
        {
            using var p = Process.Start(psi);
            if (p == null) return new RunResult(false, -1, "", "", false);
            var outT = p.StandardOutput.ReadToEndAsync();
            var errT = p.StandardError.ReadToEndAsync();
            using var cts = new CancellationTokenSource(timeoutMs);
            try
            {
                await p.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                try { p.Kill(true); } catch { /* already gone */ }
                return new RunResult(true, -1, "", "", true);
            }
            return new RunResult(true, p.ExitCode, await outT, await errT, false);
        }
        catch (Exception ex)
        {
            return new RunResult(false, -1, "", ex.Message, false);
        }
    }

    // Runs a command line through cmd.exe (needed for .cmd shims such as codex.cmd).
    public static Task<RunResult> RunCmdAsync(string commandLine, int timeoutMs = DefaultTimeoutMs) =>
        RunAsync("cmd.exe", "/d /s /c \"" + commandLine + "\"", timeoutMs);

    // Opens a new visible console window running the command and leaving it open (cmd /k).
    public static bool LaunchVisibleConsole(string commandLine)
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/d /k " + commandLine)
            {
                UseShellExecute = false,
                CreateNoWindow = false,
            };
            psi.Environment["PATH"] = FreshPath();
            Process.Start(psi)?.Dispose();
            return true;
        }
        catch { return false; }
    }

    public static bool Launch(string file, string args = "")
    {
        try
        {
            Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = true })?.Dispose();
            return true;
        }
        catch { return false; }
    }
}
