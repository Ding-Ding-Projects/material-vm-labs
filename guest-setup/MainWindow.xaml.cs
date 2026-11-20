using System.ComponentModel;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using MaterialVmLabsSetup.ViewModels;

namespace MaterialVmLabsSetup;

public partial class MainWindow : Window
{
    readonly MainViewModel _vm = new();
    readonly List<(Border spark, TranslateTransform move)> _sparks = new();
    bool _compact;
    bool _overlayOpen;
    IInputElement? _restoreFocus;

    const string MaxGlyph = "M8,5 L16,5 Q19,5 19,8 L19,16 Q19,19 16,19 L8,19 Q5,19 5,16 L5,8 Q5,5 8,5 Z";
    const string RestoreGlyph = "M9,9 L9,7 Q9,5 11,5 L17,5 Q19,5 19,7 L19,13 Q19,15 17,15 L15,15 M5,11 Q5,9 7,9 L13,9 Q15,9 15,11 L15,17 Q15,19 13,19 L7,19 Q5,19 5,17 Z";

    public MainWindow()
    {
        InitializeComponent();
        // Fit small guest screens (a fresh VM is often 1024x768): never start larger than the work area.
        var wa = SystemParameters.WorkArea;
        Width = Math.Min(Width, Math.Max(MinWidth, wa.Width - 16));
        Height = Math.Min(Height, Math.Max(MinHeight, wa.Height - 16));
        DataContext = _vm;
        BuildSparks();
        _vm.CloseRequested += () => Close();
        _vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MainViewModel.CurrentIndex)) Rise();
            else if (e.PropertyName == nameof(MainViewModel.Takeover)) OnTakeoverChanged();
        };
        SizeChanged += (_, _) => ApplyLayout();
        StateChanged += (_, _) => OnStateChanged();
        Activated += (_, _) => _vm.OnActivated();
        Closing += (_, _) => _vm.OnClosing();
        PreviewKeyDown += OnPreviewKeyDown;
        Loaded += (_, _) => ApplyLayout();
    }

    // ---- window chrome ----

    void OnMinimize(object sender, RoutedEventArgs e) => SystemCommands.MinimizeWindow(this);

    void OnMaximize(object sender, RoutedEventArgs e)
    {
        if (WindowState == WindowState.Maximized) SystemCommands.RestoreWindow(this);
        else SystemCommands.MaximizeWindow(this);
    }

    void OnCloseWindow(object sender, RoutedEventArgs e) => SystemCommands.CloseWindow(this);

    // A window with no system frame overshoots the work area by its resize border when maximized.
    void OnStateChanged()
    {
        bool max = WindowState == WindowState.Maximized;
        RootGrid.Margin = max ? SystemParameters.WindowResizeBorderThickness : new Thickness(0);
        MaxIcon.Data = Geometry.Parse(max ? RestoreGlyph : MaxGlyph);
        System.Windows.Automation.AutomationProperties.SetName(MaxButton, max ? "Restore" : "Maximize");
    }

    // Under 900 px the charging bay folds into a compact strip above the content.
    void ApplyLayout()
    {
        bool compact = ActualWidth < 900;
        if (compact == _compact && IsLoaded && SideCol.Width.Value == (compact ? 0 : 300)) return;
        _compact = compact;
        SideCol.Width = new GridLength(compact ? 0 : 300);
        SidePanel.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        CompactBar.Visibility = compact ? Visibility.Visible : Visibility.Collapsed;
        ContentHost.Margin = compact ? new Thickness(22, 16, 22, 18) : new Thickness(44, 38, 44, 24);
    }

    void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && _vm.Takeover != null)
        {
            _vm.DismissTakeoverCommand.Execute(null);
            e.Handled = true;
        }
    }

    // ---- step change: content rises in (opacity 0 -> 1, up 18 px, ~350 ms, back ease) ----

    void Rise()
    {
        if (!Motion.On) return;
        var dur = TimeSpan.FromMilliseconds(350);
        PageShift.BeginAnimation(TranslateTransform.YProperty,
            new DoubleAnimation(18, 0, dur) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.5 } });
        PageHost.BeginAnimation(OpacityProperty,
            new DoubleAnimation(0, 1, dur) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
    }

    // ---- takeovers ----

    void BuildSparks()
    {
        var pts = new (double dx, double dy)[] { (-120, -60), (120, -70), (-90, 90), (100, 80), (0, -130), (0, 130), (-140, 10), (140, 0) };
        var cols = new Brush[] { Palette.Info, Palette.Accent, Palette.Warn };
        for (int n = 0; n < pts.Length; n++)
        {
            var move = new TranslateTransform();
            var b = new Border
            {
                Width = 10, Height = 10, CornerRadius = new CornerRadius(3), Background = cols[n % 3],
                Opacity = 0, RenderTransform = move, IsHitTestVisible = false,
            };
            SparkHost.Children.Add(b);
            _sparks.Add((b, move));
        }
        _sparkTargets = pts;
    }

    (double dx, double dy)[] _sparkTargets = Array.Empty<(double, double)>();

    void OnTakeoverChanged()
    {
        var t = _vm.Takeover;
        if (t == null)
        {
            _overlayOpen = false;
            StopTakeoverMotion();
            MainGrid.IsEnabled = true;
            var back = _restoreFocus;
            _restoreFocus = null;
            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (back is UIElement ui && ui.IsVisible && ui.IsEnabled && ui.Focusable) ui.Focus();
                else ContentHost.Focus();
            }), System.Windows.Threading.DispatcherPriority.Input);
            return;
        }

        if (!_overlayOpen)
        {
            _overlayOpen = true;
            _restoreFocus = Keyboard.FocusedElement;   // where focus goes back to when the takeover closes
        }
        MainGrid.IsEnabled = false;
        StopTakeoverMotion();
        bool success = t.IsSuccess;
        Dispatcher.BeginInvoke(new Action(() =>
        {
            if (_vm.Takeover != t) return;
            (success ? KeepGoingButton : RetryButton).Focus();
            PlayTakeoverMotion(success);
            // Tell screen readers right away (assertive live region).
            var peer = UIElementAutomationPeer.FromElement(OverlayLayer) ?? UIElementAutomationPeer.CreatePeerForElement(OverlayLayer);
            peer?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
        }), System.Windows.Threading.DispatcherPriority.Loaded);
    }

    static DoubleAnimation Anim(double from, double to, double seconds, double delay = 0, bool forever = false,
                                bool reverse = false, IEasingFunction? ease = null) =>
        new(from, to, TimeSpan.FromSeconds(seconds))
        {
            BeginTime = TimeSpan.FromSeconds(delay),
            RepeatBehavior = forever ? RepeatBehavior.Forever : new RepeatBehavior(1),
            AutoReverse = reverse,
            EasingFunction = ease,
        };

    void StopTakeoverMotion()
    {
        foreach (var s in new[] { Ring1Scale, Ring2Scale })
        {
            s.BeginAnimation(ScaleTransform.ScaleXProperty, null);
            s.BeginAnimation(ScaleTransform.ScaleYProperty, null);
            s.ScaleX = s.ScaleY = 0.4;
        }
        Ring1.BeginAnimation(OpacityProperty, null); Ring1.Opacity = 0;
        Ring2.BeginAnimation(OpacityProperty, null); Ring2.Opacity = 0;
        foreach (var (spark, move) in _sparks)
        {
            spark.BeginAnimation(OpacityProperty, null); spark.Opacity = 0;
            move.BeginAnimation(TranslateTransform.XProperty, null);
            move.BeginAnimation(TranslateTransform.YProperty, null);
        }
        TileScale.BeginAnimation(ScaleTransform.ScaleXProperty, null); TileScale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
        TileScale.ScaleX = TileScale.ScaleY = 1;
        Tile.BeginAnimation(OpacityProperty, null); Tile.Opacity = 1;
        ToolScale.BeginAnimation(ScaleTransform.ScaleXProperty, null); ToolScale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
        ToolScale.ScaleX = ToolScale.ScaleY = 1;
        ToolName.BeginAnimation(OpacityProperty, null); ToolName.Opacity = 1;
        BoltPath.BeginAnimation(Shape.StrokeDashOffsetProperty, null); BoltPath.StrokeDashOffset = 0;
        Beacon.BeginAnimation(OpacityProperty, null); Beacon.Opacity = 0.25;
        AlarmShake.BeginAnimation(TranslateTransform.XProperty, null); AlarmShake.X = 0;
        TapeShift.BeginAnimation(TranslateTransform.XProperty, null); TapeShift.X = 0;
    }

    // With reduced motion the overlay appears exactly the same but nothing moves.
    void PlayTakeoverMotion(bool success)
    {
        if (!Motion.On) return;
        if (success)
        {
            var ringEase = new CubicEase { EasingMode = EasingMode.EaseOut };
            void ring(ScaleTransform sc, UIElement el, double delay)
            {
                sc.BeginAnimation(ScaleTransform.ScaleXProperty, Anim(0.4, 2.6, 1.8, delay, true, false, ringEase));
                sc.BeginAnimation(ScaleTransform.ScaleYProperty, Anim(0.4, 2.6, 1.8, delay, true, false, ringEase));
                el.BeginAnimation(OpacityProperty, Anim(0.9, 0, 1.8, delay, true, false, ringEase));
            }
            ring(Ring1Scale, Ring1, 0);
            ring(Ring2Scale, Ring2, 0.6);

            for (int n = 0; n < _sparks.Count; n++)
            {
                var (spark, move) = _sparks[n];
                var (dx, dy) = _sparkTargets[n];
                double d = n * 0.12;
                var e = new CubicEase { EasingMode = EasingMode.EaseOut };
                move.BeginAnimation(TranslateTransform.XProperty, Anim(0, dx, 1.4, d, true, false, e));
                move.BeginAnimation(TranslateTransform.YProperty, Anim(0, dy, 1.4, d, true, false, e));
                spark.BeginAnimation(OpacityProperty, Anim(1, 0, 1.4, d, true, false, e));
            }

            var pop = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.7 };
            TileScale.BeginAnimation(ScaleTransform.ScaleXProperty, Anim(0.6, 1, 0.7, 0, false, false, pop));
            TileScale.BeginAnimation(ScaleTransform.ScaleYProperty, Anim(0.6, 1, 0.7, 0, false, false, pop));
            Tile.BeginAnimation(OpacityProperty, Anim(0, 1, 0.35));
            ToolScale.BeginAnimation(ScaleTransform.ScaleXProperty, Anim(0.6, 1, 0.7, 0, false, false, pop));
            ToolScale.BeginAnimation(ScaleTransform.ScaleYProperty, Anim(0.6, 1, 0.7, 0, false, false, pop));
            ToolName.BeginAnimation(OpacityProperty, Anim(0, 1, 0.35));
            BoltPath.BeginAnimation(Shape.StrokeDashOffsetProperty, Anim(46, 0, 0.8, 0.2, false, false, new CubicEase { EasingMode = EasingMode.EaseOut }));
        }
        else
        {
            Beacon.BeginAnimation(OpacityProperty, Anim(0.25, 0.7, 0.5, 0, true, true, new SineEase { EasingMode = EasingMode.EaseInOut }));
            var shake = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromSeconds(0.2) };
            double t = 0;
            foreach (var x in new double[] { -6, 6, -4, 4, 0 })
            {
                t += 0.1;
                shake.KeyFrames.Add(new LinearDoubleKeyFrame(x, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(t))));
            }
            AlarmShake.BeginAnimation(TranslateTransform.XProperty, shake);
            TapeShift.BeginAnimation(TranslateTransform.XProperty, Anim(0, 56, 1, 0, true));
        }
    }
}
