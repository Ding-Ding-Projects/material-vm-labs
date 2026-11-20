using System.ComponentModel;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using MaterialVmLabsSetup.ViewModels;

namespace MaterialVmLabsSetup;

public partial class MainWindow : Window
{
    readonly MainViewModel _vm = new();
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
        _vm.CloseRequested += () => Close();
        _vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MainViewModel.CurrentIndex)) PlayStepTransition();
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

    // Under 900 px the side panel folds into a compact top app bar above the content.
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

    // ---- step change: Material 3 shared-axis motion (fade in, up 16 px, emphasized decelerate, 350 ms) ----

    // Material 3 emphasized decelerate easing, cubic-bezier(0.05, 0.7, 0.1, 1.0).
    static DoubleAnimationUsingKeyFrames Emphasized(double from, double to, double ms)
    {
        var a = new DoubleAnimationUsingKeyFrames();
        a.KeyFrames.Add(new DiscreteDoubleKeyFrame(from, KeyTime.FromTimeSpan(TimeSpan.Zero)));
        a.KeyFrames.Add(new SplineDoubleKeyFrame(to, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms)),
            new KeySpline(0.05, 0.7, 0.1, 1.0)));
        return a;
    }

    void PlayStepTransition()
    {
        if (!Motion.On) return;
        PageShift.BeginAnimation(TranslateTransform.YProperty, Emphasized(16, 0, 350));
        PageHost.BeginAnimation(OpacityProperty, Emphasized(0, 1, 350));
    }

    // ---- takeovers ----

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

    static void Reset(UIElement card, ScaleTransform scale)
    {
        card.BeginAnimation(OpacityProperty, null); card.Opacity = 1;
        scale.BeginAnimation(ScaleTransform.ScaleXProperty, null);
        scale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
        scale.ScaleX = scale.ScaleY = 1;
    }

    void StopTakeoverMotion()
    {
        Reset(SuccessCard, SuccessCardScale);
        Reset(FailureCard, FailureCardScale);
    }

    // The surface fades in and grows from 92 % with emphasized decelerate easing.
    // With reduced motion the takeover appears exactly the same but nothing moves.
    void PlayTakeoverMotion(bool success)
    {
        if (!Motion.On) return;
        UIElement card = success ? SuccessCard : FailureCard;
        var scale = success ? SuccessCardScale : FailureCardScale;
        card.BeginAnimation(OpacityProperty, Emphasized(0, 1, 300));
        scale.BeginAnimation(ScaleTransform.ScaleXProperty, Emphasized(0.92, 1, 400));
        scale.BeginAnimation(ScaleTransform.ScaleYProperty, Emphasized(0.92, 1, 400));
    }
}
