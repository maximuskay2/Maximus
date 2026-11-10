import '../api/models.dart';

/// Tool → capability, mirroring TOOL_CAPABILITY in shared/phone-apps.ts.
const phoneToolCapability = <String, String>{
  'PHONE_LIST_EVENTS': 'calendar',
  'PHONE_GET_EVENT': 'calendar',
  'PHONE_FIND_FREE_TIME': 'calendar',
  'PHONE_CREATE_EVENT': 'calendar',
  'PHONE_UPDATE_EVENT': 'calendar',
  'PHONE_DELETE_EVENT': 'calendar',
  'PHONE_RESPOND_TO_INVITE': 'calendar',
  'PHONE_LIST_REMINDERS': 'reminders',
  'PHONE_CREATE_REMINDER': 'reminders',
  'PHONE_UPDATE_REMINDER': 'reminders',
  'PHONE_COMPLETE_REMINDER': 'reminders',
  'PHONE_DELETE_REMINDER': 'reminders',
  'PHONE_SEARCH_CONTACTS': 'contacts',
  'PHONE_GET_CONTACT': 'contacts',
  'PHONE_CREATE_CONTACT': 'contacts',
  'PHONE_UPDATE_CONTACT': 'contacts',
  'PHONE_GET_LOCATION': 'location',
  'PHONE_FIND_PLACES_NEARBY': 'location',
  'PHONE_LIST_HOME': 'home',
  'PHONE_SET_ACCESSORY': 'home',
  'PHONE_RUN_SCENE': 'home',
  'PHONE_SEND_MESSAGE': 'messages',
  'PHONE_SEND_WHATSAPP': 'messages',
};

/// True for tools that change something (permission cards default to ask).
bool isPhoneWrite(String tool) =>
    !(tool.startsWith('PHONE_LIST_') ||
        tool.startsWith('PHONE_GET_') ||
        tool.startsWith('PHONE_SEARCH_') ||
        tool.startsWith('PHONE_FIND_'));

/// One executed job's outcome for POST .../jobs/:id/result.
class PhoneOutcome {
  const PhoneOutcome.ok(this.result)
    : ok = true,
      error = null,
      code = null;
  const PhoneOutcome.fail(this.error, {this.code})
    : ok = false,
      result = null;

  final bool ok;
  final Object? result;
  final String? error;

  /// denied | foreground_required | not_found | too_large | unsupported |
  /// offline | timeout | turn_ended.
  final String? code;
}

/// What the executor needs from the OS calendar.
abstract class CalendarDriver {
  Future<List<Map<String, Object?>>> listEvents({
    required DateTime from,
    required DateTime to,
    String? calendar,
  });
  Future<Map<String, Object?>?> getEvent(String id);
  Future<List<Map<String, Object?>>> findFreeTime({
    required DateTime from,
    required DateTime to,
    required int minutes,
  });
  Future<String?> createEvent(Map<String, Object?> fields);
  Future<bool> updateEvent(String id, Map<String, Object?> fields);
  Future<bool> deleteEvent(String id);
  Future<bool> respondToInvite(String id, String response);
}

/// What the executor needs from the OS reminders store.
abstract class RemindersDriver {
  Future<List<Map<String, Object?>>> list({
    String? list,
    DateTime? from,
    DateTime? to,
    bool completed = false,
  });
  Future<String?> create(Map<String, Object?> fields);
  Future<bool> update(String id, Map<String, Object?> fields);
  Future<bool> complete(String id);
  Future<bool> delete(String id);
}

/// What the executor needs from the OS address book.
abstract class ContactsDriver {
  Future<List<Map<String, Object?>>> search(String query);
  Future<Map<String, Object?>?> get(String id);
  Future<String?> create(Map<String, Object?> fields);
  Future<bool> update(String id, Map<String, Object?> fields);
}

/// What the executor needs from OS location.
abstract class LocationDriver {
  /// {latitude, longitude, placeName?}.
  Future<Map<String, Object?>> current();
}

/// What the executor needs to hand a message to the OS composer.
abstract class MessageDriver {
  /// Opens the SMS composer; true when it opened (the person taps Send).
  Future<bool> sendSms(String to, String text);

  /// Opens WhatsApp (or its store page when missing).
  Future<bool> sendWhatsapp(String to, String text);
}

/// Runs PHONE_* jobs against the OS apps. Drivers throw
/// [PhoneDriverError] for expected failures (denied, missing, too big);
/// anything else becomes a generic failure.
class PhoneDriverError implements Exception {
  const PhoneDriverError(this.message, {this.code = 'unsupported'});
  final String message;
  final String code;
}

class PhoneToolExecutor {
  PhoneToolExecutor({
    required this.capabilities,
    this._calendar,
    this._reminders,
    this._contacts,
    this._location,
    this._messages,
  });

  /// Capabilities this phone registered (calendar, reminders, ...).
  final Set<String> capabilities;
  final CalendarDriver? _calendar;
  final RemindersDriver? _reminders;
  final ContactsDriver? _contacts;
  final LocationDriver? _location;
  final MessageDriver? _messages;

  Future<PhoneOutcome> execute(PhoneJob job) async {
    final capability = phoneToolCapability[job.tool];
    if (capability == null) {
      return const PhoneOutcome.fail(
        'Unknown phone tool.',
        code: 'unsupported',
      );
    }
    if (!capabilities.contains(capability)) {
      return PhoneOutcome.fail(
        'The $capability app is not shared on this phone.',
        code: 'denied',
      );
    }
    try {
      return await _run(job);
    } on PhoneDriverError catch (error) {
      return PhoneOutcome.fail(error.message, code: error.code);
    } catch (error) {
      return PhoneOutcome.fail('The phone could not run that: $error');
    }
  }

  DateTime _date(Object? value, String field) {
    final parsed = value is String ? DateTime.tryParse(value) : null;
    if (parsed == null) throw PhoneDriverError('Bad $field.', code: 'not_found');
    return parsed;
  }

  Future<PhoneOutcome> _run(PhoneJob job) async {
    final args = job.arguments;
    switch (job.tool) {
      case 'PHONE_LIST_EVENTS':
        final calendar = _calendar;
        if (calendar == null) return _missing('calendar');
        return PhoneOutcome.ok({
          'events': await calendar.listEvents(
            from: _date(args['from'], 'from'),
            to: _date(args['to'], 'to'),
            calendar: args['calendar'] as String?,
          ),
        });
      case 'PHONE_GET_EVENT':
        final event = await _calendar?.getEvent('${args['id']}');
        if (event == null) {
          return const PhoneOutcome.fail('No such event.', code: 'not_found');
        }
        return PhoneOutcome.ok({'event': event});
      case 'PHONE_FIND_FREE_TIME':
        final calendar = _calendar;
        if (calendar == null) return _missing('calendar');
        return PhoneOutcome.ok({
          'gaps': await calendar.findFreeTime(
            from: _date(args['from'], 'from'),
            to: _date(args['to'], 'to'),
            minutes: (args['minutes'] as num?)?.toInt() ?? 30,
          ),
        });
      case 'PHONE_CREATE_EVENT':
        final id = await _calendar?.createEvent(args);
        if (id == null) {
          return const PhoneOutcome.fail('The event was not created.');
        }
        return PhoneOutcome.ok({'id': id});
      case 'PHONE_UPDATE_EVENT':
        final ok = await _calendar?.updateEvent('${args['id']}', args) ?? false;
        return ok
            ? const PhoneOutcome.ok({'updated': true})
            : const PhoneOutcome.fail('No such event.', code: 'not_found');
      case 'PHONE_DELETE_EVENT':
        final ok = await _calendar?.deleteEvent('${args['id']}') ?? false;
        return ok
            ? const PhoneOutcome.ok({'deleted': true})
            : const PhoneOutcome.fail('No such event.', code: 'not_found');
      case 'PHONE_RESPOND_TO_INVITE':
        final ok =
            await _calendar?.respondToInvite(
              '${args['id']}',
              '${args['response']}',
            ) ??
            false;
        return ok
            ? const PhoneOutcome.ok({'responded': true})
            : const PhoneOutcome.fail(
                'The invite was not answered.',
                code: 'not_found',
              );
      case 'PHONE_LIST_REMINDERS':
        final reminders = _reminders;
        if (reminders == null) return _missing('reminders');
        DateTime? optDate(Object? value) =>
            value is String ? DateTime.tryParse(value) : null;
        return PhoneOutcome.ok({
          'reminders': await reminders.list(
            list: args['list'] as String?,
            from: optDate(args['from']),
            to: optDate(args['to']),
            completed: (args['completed'] as bool?) ?? false,
          ),
        });
      case 'PHONE_CREATE_REMINDER':
        final id = await _reminders?.create(args);
        if (id == null) {
          return const PhoneOutcome.fail('The reminder was not created.');
        }
        return PhoneOutcome.ok({'id': id});
      case 'PHONE_UPDATE_REMINDER':
        final ok = await _reminders?.update('${args['id']}', args) ?? false;
        return ok
            ? const PhoneOutcome.ok({'updated': true})
            : const PhoneOutcome.fail('No such reminder.', code: 'not_found');
      case 'PHONE_COMPLETE_REMINDER':
        final ok = await _reminders?.complete('${args['id']}') ?? false;
        return ok
            ? const PhoneOutcome.ok({'completed': true})
            : const PhoneOutcome.fail('No such reminder.', code: 'not_found');
      case 'PHONE_DELETE_REMINDER':
        final ok = await _reminders?.delete('${args['id']}') ?? false;
        return ok
            ? const PhoneOutcome.ok({'deleted': true})
            : const PhoneOutcome.fail('No such reminder.', code: 'not_found');
      case 'PHONE_SEARCH_CONTACTS':
        final contacts = _contacts;
        if (contacts == null) return _missing('contacts');
        return PhoneOutcome.ok({
          'contacts': await contacts.search('${args['query'] ?? ''}'),
        });
      case 'PHONE_GET_CONTACT':
        final contact = await _contacts?.get('${args['id']}');
        if (contact == null) {
          return const PhoneOutcome.fail('No such contact.', code: 'not_found');
        }
        return PhoneOutcome.ok({'contact': contact});
      case 'PHONE_CREATE_CONTACT':
        final id = await _contacts?.create(args);
        if (id == null) {
          return const PhoneOutcome.fail('The contact was not created.');
        }
        return PhoneOutcome.ok({'id': id});
      case 'PHONE_UPDATE_CONTACT':
        final ok = await _contacts?.update('${args['id']}', args) ?? false;
        return ok
            ? const PhoneOutcome.ok({'updated': true})
            : const PhoneOutcome.fail('No such contact.', code: 'not_found');
      case 'PHONE_GET_LOCATION':
        final location = _location;
        if (location == null) return _missing('location');
        return PhoneOutcome.ok(await location.current());
      case 'PHONE_FIND_PLACES_NEARBY':
        // No on-device POI search exists; a Places API key would make this
        // a server tool instead. Answered honestly, not guessed.
        return const PhoneOutcome.fail(
          'Nearby-place search is not on this phone.',
          code: 'unsupported',
        );
      case 'PHONE_LIST_HOME':
      case 'PHONE_SET_ACCESSORY':
      case 'PHONE_RUN_SCENE':
        return const PhoneOutcome.fail(
          'Home accessories are not on this phone.',
          code: 'unsupported',
        );
      case 'PHONE_SEND_MESSAGE':
        final messages = _messages;
        if (messages == null) return _missing('messages');
        final opened = await messages.sendSms(
          '${args['to']}',
          '${args['text']}',
        );
        return opened
            ? const PhoneOutcome.ok({'opened': true})
            : const PhoneOutcome.fail(
                'The message composer did not open.',
                code: 'foreground_required',
              );
      case 'PHONE_SEND_WHATSAPP':
        final messages = _messages;
        if (messages == null) return _missing('messages');
        final opened = await messages.sendWhatsapp(
          '${args['to']}',
          '${args['text']}',
        );
        return opened
            ? const PhoneOutcome.ok({'opened': true})
            : const PhoneOutcome.fail(
                'WhatsApp did not open.',
                code: 'foreground_required',
              );
      default:
        return const PhoneOutcome.fail(
          'Unknown phone tool.',
          code: 'unsupported',
        );
    }
  }

  PhoneOutcome _missing(String capability) => PhoneOutcome.fail(
    'The $capability app is not available on this phone.',
    code: 'unsupported',
  );
}
