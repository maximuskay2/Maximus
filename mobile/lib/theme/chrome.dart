import 'package:flutter/material.dart';

import 'tokens.dart';

/// Sliding choice used for appearance, autonomy, and the same kind of
/// short list. The white pill moves to the selected label.
class MaxSegment<T> extends StatelessWidget {
  const MaxSegment({
    super.key,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: const Color(0xFFE5E5EA),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          for (final option in options)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(option.$1),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOutCubic,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: value == option.$1 ? MaxTokens.ember : Colors.transparent,
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: value == option.$1
                        ? [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.08),
                              blurRadius: 3,
                              offset: const Offset(0, 1),
                            ),
                          ]
                        : null,
                  ),
                  child: Text(
                    option.$2,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: value == option.$1
                          ? FontWeight.w600
                          : FontWeight.w500,
                      color: value == option.$1
                          ? Colors.white
                          : const Color(0xFF8E8E93),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
