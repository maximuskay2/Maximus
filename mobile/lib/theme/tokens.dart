import 'package:flutter/material.dart';

/// Ember & Paper design tokens. Single source of truth for color, type,
/// shape, elevation, and motion across light/dark/dynamic-type layouts.
abstract final class MaxTokens {
  // Brand.
  static const Color ink = Color(0xFF14110B);
  static const Color paper = Color(0xFFF5F1E8);
  static const Color ember = Color(0xFFC2410C);
  static const Color emberDim = Color(0xFF9A3412);
  static const Color emberBright = Color(0xFFEA580C);

  // Dark surfaces.
  static const Color darkSurface = Color(0xFF1C1810);
  static const Color darkSurfaceHigh = Color(0xFF262117);
  static const Color darkInkText = Color(0xFFF5F1E8);
  static const Color darkMutedText = Color(0xFFB8AE99);

  // Light surfaces. Pages are white; wells use the same soft gray as home.
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightSurfaceHigh = Color(0xFFF2F2F7);
  static const Color lightInkText = ink;
  static const Color lightMutedText = Color(0xFF8E8E93);
  static const Color lightLine = Color(0xFFE5E5EA);

  // Shape: each surface owns its radius — never one radius everywhere.
  static const double radiusBubble = 20;
  static const double radiusCard = 14;
  static const double radiusSheet = 24;
  static const double radiusChip = 999;
  static const double radiusInput = 12;

  // Motion (all gated on reduced-motion by the widgets that use them).
  static const Duration motionFast = Duration(milliseconds: 150);
  static const Duration motionMedium = Duration(milliseconds: 250);

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: ember,
      brightness: Brightness.light,
    ).copyWith(
      primary: ember,
      onPrimary: Colors.white,
      surface: lightSurface,
      surfaceDim: lightSurface,
      surfaceBright: lightSurface,
      surfaceContainerLowest: lightSurface,
      surfaceContainerLow: lightSurface,
      surfaceContainer: lightSurface,
      surfaceContainerHigh: lightSurface,
      surfaceContainerHighest: lightSurfaceHigh,
      surfaceTint: Colors.transparent,
      onSurface: lightInkText,
      onSurfaceVariant: lightMutedText,
    );
    return _theme(scheme, light: true);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: ember,
      brightness: Brightness.dark,
    ).copyWith(
      primary: ember,
      onPrimary: Colors.white,
      surface: darkSurface,
      surfaceContainerHighest: darkSurfaceHigh,
      onSurface: darkInkText,
      onSurfaceVariant: darkMutedText,
    );
    return _theme(scheme, light: false);
  }

  static ThemeData _theme(ColorScheme scheme, {required bool light}) {
    final page = light ? lightSurface : scheme.surface;
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: page,
      canvasColor: page,
      appBarTheme: AppBarTheme(
        backgroundColor: page,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        foregroundColor: scheme.onSurface,
      ),
      cardTheme: CardThemeData(
        color: page,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusCard),
          side: BorderSide(color: light ? lightLine : Colors.transparent),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: page,
        surfaceTintColor: Colors.transparent,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: page,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ember,
          foregroundColor: Colors.white,
          disabledBackgroundColor: light
              ? const Color(0xFFE5E5EA)
              : scheme.surfaceContainerHighest,
          disabledForegroundColor: light
              ? const Color(0xFF8E8E93)
              : scheme.onSurfaceVariant,
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ember,
          side: const BorderSide(color: ember),
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: ember,
          shape: const StadiumBorder(),
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: ember,
        foregroundColor: Colors.white,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: const WidgetStatePropertyAll(Colors.white),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return ember;
          return light ? const Color(0xFFE5E5EA) : scheme.surfaceContainerHighest;
        }),
        trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return ember;
          return Colors.transparent;
        }),
        checkColor: const WidgetStatePropertyAll(Colors.white),
        side: const BorderSide(color: ember, width: 1.5),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return ember;
          return light ? lightMutedText : scheme.onSurfaceVariant;
        }),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: ember),
      sliderTheme: const SliderThemeData(
        activeTrackColor: ember,
        thumbColor: ember,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: page,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusInput),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusInput),
          borderSide: const BorderSide(color: ember, width: 1.5),
        ),
      ),
    );
  }
}
