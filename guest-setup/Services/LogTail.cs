using System.Text;

namespace MaterialVmLabsSetup.Services;

// Read-only tail of the guest tools log, filtered to the lines that mention one tool.
public static class LogTail
{
    public static string DefaultPath => Path.Combine(StateService.Dir, "guest-tools.log");

    public static string Relevant(string? path, string[] tokens, int count)
    {
        try
        {
            var p = string.IsNullOrWhiteSpace(path) ? DefaultPath : path!;
            if (!File.Exists(p)) return "No install log yet.";
            string text;
            using (var fs = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                const long max = 256 * 1024;
                if (fs.Length > max) fs.Seek(-max, SeekOrigin.End);
                using var sr = new StreamReader(fs, Encoding.UTF8);
                text = sr.ReadToEnd();
            }
            var hits = text.Split('\n').Select(l => l.TrimEnd('\r'))
                .Where(l => l.Length > 0 && tokens.Any(t => l.Contains(t, StringComparison.OrdinalIgnoreCase)))
                .TakeLast(count).ToList();
            return hits.Count == 0 ? "No log lines mention this tool yet." : string.Join(Environment.NewLine, hits);
        }
        catch { return "The install log could not be read."; }
    }
}
