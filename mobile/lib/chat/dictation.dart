import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// Thin seam over on-device speech recognition so tests drive a fake.
abstract class SpeechDriver {
  /// Prepares recognition (initializes + permission). True when dictation
  /// can start. Call only from an explicit mic tap: first call shows the
  /// OS speech-recognition prompt.
  Future<bool> ensureReady();

  /// Starts listening; [onResult] fires for partial and final transcripts.
  Future<void> listen(void Function(String text, bool finalResult) onResult);

  /// Stops and keeps the final transcript.
  Future<void> stop();

  /// Stops and drops the transcript.
  Future<void> cancel();
}

/// Production driver backed by iOS/Android on-device speech recognition.
class SystemSpeechDriver implements SpeechDriver {
  SystemSpeechDriver({SpeechToText? speech}) : _speech = speech ?? SpeechToText();

  final SpeechToText _speech;
  bool _ready = false;

  @override
  Future<bool> ensureReady() async {
    if (_ready) return true;
    try {
      _ready = await _speech.initialize();
      return _ready;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> listen(
    void Function(String text, bool finalResult) onResult,
  ) async {
    await _speech.listen(
      onResult: (result) => onResult(result.recognizedWords, result.finalResult),
      listenOptions: SpeechListenOptions(
        partialResults: true,
        onDevice: true,
      ),
    );
  }

  @override
  Future<void> stop() => _speech.stop();

  @override
  Future<void> cancel() => _speech.cancel();
}

/// Dictation state for one composer: tap mic, speak, the transcript lands
/// in the text field live; tap again (or auto-final) to keep it.
class DictationController extends ChangeNotifier {
  DictationController({required SpeechDriver driver}) {
    _driver = driver;
  }

  late final SpeechDriver _driver;

  bool _listening = false;
  bool get listening => _listening;

  String? _error;
  String? get error => _error;

  /// Fires with the running transcript (base text + speech so far).
  void Function(String text)? onTranscript;

  Future<void> toggle({required String baseText}) async {
    if (_listening) {
      await stop();
      return;
    }
    _error = null;
    final ready = await _driver.ensureReady();
    if (!ready) {
      _error = 'Speech recognition is not available on this phone.';
      notifyListeners();
      return;
    }
    _listening = true;
    notifyListeners();
    final prefix = baseText.isEmpty
        ? ''
        : baseText.endsWith(' ')
            ? baseText
            : '$baseText ';
    try {
      await _driver.listen((text, finalResult) {
        onTranscript?.call('$prefix$text');
        if (finalResult) {
          _listening = false;
          notifyListeners();
        }
      });
    } catch (_) {
      _listening = false;
      _error = 'Dictation stopped — try again.';
      notifyListeners();
    }
  }

  Future<void> stop() async {
    if (!_listening) return;
    try {
      await _driver.stop();
    } catch (_) {}
    _listening = false;
    notifyListeners();
  }

  Future<void> cancel() async {
    if (!_listening) return;
    try {
      await _driver.cancel();
    } catch (_) {}
    _listening = false;
    notifyListeners();
  }
}
