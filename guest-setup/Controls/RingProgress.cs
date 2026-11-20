using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using MaterialVmLabsSetup.ViewModels;

namespace MaterialVmLabsSetup.Controls;

// Material 3 circular progress indicator (0..100): a rounded indicator arc, then a small gap, then the
// remaining track. A new Value glides to its place over ~600 ms unless reduced motion is on.
public sealed class RingProgress : FrameworkElement
{
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(RingProgress), new PropertyMetadata(0.0, OnValueChanged));

    static readonly DependencyProperty DisplayProperty = DependencyProperty.Register(
        nameof(Display), typeof(double), typeof(RingProgress), new FrameworkPropertyMetadata(0.0, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty ProgressBrushProperty = DependencyProperty.Register(
        nameof(ProgressBrush), typeof(Brush), typeof(RingProgress), new FrameworkPropertyMetadata(Brushes.MediumPurple, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty TrackBrushProperty = DependencyProperty.Register(
        nameof(TrackBrush), typeof(Brush), typeof(RingProgress), new FrameworkPropertyMetadata(Brushes.DimGray, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty ThicknessProperty = DependencyProperty.Register(
        nameof(Thickness), typeof(double), typeof(RingProgress), new FrameworkPropertyMetadata(4.0, FrameworkPropertyMetadataOptions.AffectsRender));

    public double Value { get => (double)GetValue(ValueProperty); set => SetValue(ValueProperty, value); }
    double Display { get => (double)GetValue(DisplayProperty); set => SetValue(DisplayProperty, value); }
    public Brush ProgressBrush { get => (Brush)GetValue(ProgressBrushProperty); set => SetValue(ProgressBrushProperty, value); }
    public Brush TrackBrush { get => (Brush)GetValue(TrackBrushProperty); set => SetValue(TrackBrushProperty, value); }
    public double Thickness { get => (double)GetValue(ThicknessProperty); set => SetValue(ThicknessProperty, value); }

    static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var r = (RingProgress)d;
        double to = Math.Clamp((double)e.NewValue, 0, 100);
        if (!Motion.On || !r.IsLoaded)
        {
            r.BeginAnimation(DisplayProperty, null);
            r.Display = to;
            return;
        }
        var from = r.Display;
        r.BeginAnimation(DisplayProperty, new DoubleAnimation(from, to, TimeSpan.FromMilliseconds(600))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        });
    }

    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight, t = Thickness;
        var c = new Point(w / 2, h / 2);
        double r = (Math.Min(w, h) - t) / 2;
        if (r <= 0) return;
        var track = new Pen(TrackBrush, t) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        var pen = new Pen(ProgressBrush, t) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        double d = Math.Clamp(Display, 0, 100);
        if (d <= 0.05) { dc.DrawEllipse(null, track, c, r, r); return; }
        if (d >= 99.95) { dc.DrawEllipse(null, pen, c, r, r); return; }

        double sweep = 360.0 * d / 100.0;
        // Gap between indicator and track, wide enough to stay visible past the round caps.
        double gap = (t + 4) / r * 180.0 / Math.PI;
        double trackSweep = 360.0 - sweep - 2 * gap;
        if (trackSweep > 0.5) DrawArc(dc, track, c, r, -90 + sweep + gap, trackSweep);
        DrawArc(dc, pen, c, r, -90, sweep);
    }

    static void DrawArc(DrawingContext dc, Pen pen, Point c, double r, double startDeg, double sweepDeg)
    {
        double a0 = startDeg * Math.PI / 180.0, a1 = (startDeg + sweepDeg) * Math.PI / 180.0;
        var start = new Point(c.X + r * Math.Cos(a0), c.Y + r * Math.Sin(a0));
        var end = new Point(c.X + r * Math.Cos(a1), c.Y + r * Math.Sin(a1));
        var g = new StreamGeometry();
        using (var ctx = g.Open())
        {
            ctx.BeginFigure(start, false, false);
            ctx.ArcTo(end, new Size(r, r), 0, sweepDeg > 180, SweepDirection.Clockwise, true, false);
        }
        g.Freeze();
        dc.DrawGeometry(null, pen, g);
    }
}
