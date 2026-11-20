using System.Windows;
using MaterialVmLabsSetup.Services;

namespace MaterialVmLabsSetup;

public partial class App : Application
{
    Mutex? _single;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        // Never die silently: write the error where the tooling can read it and tell the person.
        DispatcherUnhandledException += (_, ex) =>
        {
            ex.Handled = true;
            ReportCrash(ex.Exception);
            Shutdown(1);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, ex) => ReportCrash(ex.ExceptionObject as Exception);

        bool firstRun = e.Args.Any(a => string.Equals(a, "--first-run", StringComparison.OrdinalIgnoreCase));

        // Registered to start at logon with --first-run: once finished, never open again.
        // Started from the Start menu (no argument) it always opens.
        if (firstRun && StateService.LoadUi().Completed)
        {
            Shutdown(0);
            return;
        }

        _single = new Mutex(true, @"Local\MaterialVmLabsSetup", out bool created);
        if (!created)
        {
            Shutdown(0);
            return;
        }

        // Always come up in front: a launcher can pass a minimized show state (vmrun -interactive does),
        // and Setup is meant to be the first thing seen after sign-in.
        var main = new MainWindow();
        main.Show();
        main.WindowState = WindowState.Normal;
        main.Activate();
    }

    static void ReportCrash(Exception? ex)
    {
        try
        {
            string dir = @"C:\ProgramData\MaterialVmLabs";
            System.IO.Directory.CreateDirectory(dir);
            System.IO.File.AppendAllText(System.IO.Path.Combine(dir, "setup-crash.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + ex + Environment.NewLine);
        }
        catch { /* nothing more to do */ }
        try
        {
            MessageBox.Show("Material VM Labs Setup hit a problem and has to close. The details are in C:\\ProgramData\\MaterialVmLabs\\setup-crash.log. The installs keep running on their own.",
                "Material VM Labs Setup", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        catch { }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { _single?.ReleaseMutex(); } catch { /* not owned */ }
        _single?.Dispose();
        base.OnExit(e);
    }
}
