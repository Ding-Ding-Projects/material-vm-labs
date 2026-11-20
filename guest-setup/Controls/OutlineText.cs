using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace MaterialVmLabsSetup.Controls;

// Large text drawn as an outline only (stroke, no fill), used for the step number.
public sealed class OutlineText : FrameworkElement
{
    public static readonly DependencyProperty TextProperty = DependencyProperty.Register(
        nameof(Text), typeof(string), typeof(OutlineText),
        new FrameworkPropertyMetadata("", FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty FontSizeProperty = DependencyProperty.Register(
        nameof(FontSize), typeof(double), typeof(OutlineText),
        new FrameworkPropertyMetadata(110.0, FrameworkPropertyMetadataOptions.AffectsMeasure | FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty StrokeProperty = DependencyProperty.Register(
        nameof(Stroke), typeof(Brush), typeof(OutlineText),
        new FrameworkPropertyMetadata(Brushes.White, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty StrokeThicknessProperty = DependencyProperty.Register(
        nameof(StrokeThickness), typeof(double), typeof(OutlineText),
        new FrameworkPropertyMetadata(2.0, FrameworkPropertyMetadataOptions.AffectsRender));

    public string Text { get => (string)GetValue(TextProperty); set => SetValue(TextProperty, value); }
    public double FontSize { get => (double)GetValue(FontSizeProperty); set => SetValue(FontSizeProperty, value); }
    public Brush Stroke { get => (Brush)GetValue(StrokeProperty); set => SetValue(StrokeProperty, value); }
    public double StrokeThickness { get => (double)GetValue(StrokeThicknessProperty); set => SetValue(StrokeThicknessProperty, value); }

    static readonly Typeface Face = new(new FontFamily("Segoe UI Variable Display, Segoe UI"),
        FontStyles.Normal, FontWeights.ExtraBold, FontStretches.Normal);

    FormattedText Make() => new(Text ?? "", CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, Face, FontSize,
        Brushes.Black, VisualTreeHelper.GetDpi(this).PixelsPerDip);

    protected override Size MeasureOverride(Size availableSize)
    {
        var ft = Make();
        return new Size(ft.WidthIncludingTrailingWhitespace + StrokeThickness, ft.Height * 0.84);
    }

    protected override void OnRender(DrawingContext dc)
    {
        var ft = Make();
        var geo = ft.BuildGeometry(new Point(StrokeThickness / 2, -ft.Height * 0.08));
        dc.DrawGeometry(null, new Pen(Stroke, StrokeThickness) { LineJoin = PenLineJoin.Round }, geo);
    }
}
