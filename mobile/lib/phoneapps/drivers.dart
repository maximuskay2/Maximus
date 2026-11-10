import 'package:device_calendar/device_calendar.dart' as cal;
import 'package:flutter_contacts/flutter_contacts.dart' as contacts;
import 'package:geocoding/geocoding.dart' as geo;
import 'package:geolocator/geolocator.dart' as geo;
import 'package:timezone/timezone.dart' as tz;
import 'package:url_launcher/url_launcher.dart' as launcher;

import 'executor.dart';

/// Zone-aware stamp for device_calendar. UTC instants round-trip exactly;
/// calendar apps render them in the phone's zone.
tz.TZDateTime _zoned(DateTime when) =>
    tz.TZDateTime.fromMillisecondsSinceEpoch(tz.UTC, when.millisecondsSinceEpoch);

/// OS permission state for one phone capability, without prompting.
enum CapPermission { granted, denied, notAsked }

/// Production calendar driver (EventKit / Calendar Provider).
class SystemCalendarDriver implements CalendarDriver {
  SystemCalendarDriver({cal.DeviceCalendarPlugin? plugin})
    : _plugin = plugin ?? cal.DeviceCalendarPlugin();

  final cal.DeviceCalendarPlugin _plugin;

  Future<CapPermission> permission() async {
    try {
      final result = await _plugin.hasPermissions();
      if (result.isSuccess && (result.data ?? false)) {
        return CapPermission.granted;
      }
      return CapPermission.notAsked;
    } catch (_) {
      return CapPermission.denied;
    }
  }

  Future<bool> requestPermission() async {
    try {
      final result = await _plugin.requestPermissions();
      return result.isSuccess && (result.data ?? false);
    } catch (_) {
      return false;
    }
  }

  Future<String?> _calendarId(String? name) async {
    final calendars = await _plugin.retrieveCalendars();
    if (!calendars.isSuccess || calendars.data == null) {
      throw const PhoneDriverError('Calendars are not reachable.');
    }
    final list = calendars.data!;
    if (name == null || name.isEmpty) {
      for (final c in list) {
        if (c.isDefault == true) return c.id;
      }
      return list.isEmpty ? null : list.first.id;
    }
    final want = name.toLowerCase();
    for (final c in list) {
      if ((c.name ?? '').toLowerCase() == want) return c.id;
    }
    return null;
  }

  Map<String, Object?> _eventJson(cal.Event event, String? calendarName) => {
    'id': event.eventId,
    'title': event.title,
    'start': event.start?.toIso8601String(),
    'end': event.end?.toIso8601String(),
    'allDay': event.allDay,
    'location': event.location,
    'notes': event.description,
    'calendar': ?calendarName,
  };

  @override
  Future<List<Map<String, Object?>>> listEvents({
    required DateTime from,
    required DateTime to,
    String? calendar,
  }) async {
    if (await permission() != CapPermission.granted) {
      throw const PhoneDriverError(
        'Calendar access is off.',
        code: 'denied',
      );
    }
    final calendars = await _plugin.retrieveCalendars();
    final all = calendars.data ?? [];
    final wanted = calendar?.toLowerCase();
    final out = <Map<String, Object?>>[];
    for (final c in all) {
      if (wanted != null &&
          wanted.isNotEmpty &&
          (c.name ?? '').toLowerCase() != wanted) {
        continue;
      }
      if (c.id == null) continue;
      final events = await _plugin.retrieveEvents(
        c.id,
        cal.RetrieveEventsParams(startDate: from, endDate: to),
      );
      if (!events.isSuccess || events.data == null) continue;
      out.addAll([
        for (final e in events.data!) _eventJson(e, c.name),
      ]);
      if (out.length > 200) break;
    }
    out.sort((a, b) => '${a['start']}'.compareTo('${b['start']}'));
    return out.take(200).toList();
  }

  @override
  Future<Map<String, Object?>?> getEvent(String id) async {
    if (await permission() != CapPermission.granted) {
      throw const PhoneDriverError(
        'Calendar access is off.',
        code: 'denied',
      );
    }
    final calendars = await _plugin.retrieveCalendars();
    for (final c in calendars.data ?? []) {
      if (c.id == null) continue;
      final events = await _plugin.retrieveEvents(
        c.id,
        cal.RetrieveEventsParams(eventIds: [id]),
      );
      if (events.isSuccess && events.data != null) {
        for (final e in events.data!) {
          if (e.eventId == id) return _eventJson(e, c.name);
        }
      }
    }
    return null;
  }

  @override
  Future<List<Map<String, Object?>>> findFreeTime({
    required DateTime from,
    required DateTime to,
    required int minutes,
  }) async {
    final events = await listEvents(from: from, to: to);
    final busy = <({DateTime start, DateTime end})>[];
    for (final e in events) {
      final start = DateTime.tryParse('${e['start']}');
      final end = DateTime.tryParse('${e['end']}');
      if (start != null && end != null && end.isAfter(from)) {
        busy.add((start: start, end: end));
      }
    }
    busy.sort((a, b) => a.start.compareTo(b.start));
    final gaps = <Map<String, Object?>>[];
    var cursor = from;
    for (final block in busy) {
      if (block.start.isAfter(cursor) &&
          block.start.difference(cursor).inMinutes >= minutes) {
        gaps.add({
          'start': cursor.toIso8601String(),
          'end': block.start.toIso8601String(),
        });
      }
      if (block.end.isAfter(cursor)) cursor = block.end;
      if (!cursor.isBefore(to)) break;
    }
    if (to.difference(cursor).inMinutes >= minutes && cursor.isBefore(to)) {
      gaps.add({
        'start': cursor.toIso8601String(),
        'end': to.toIso8601String(),
      });
    }
    return gaps;
  }

  @override
  Future<String?> createEvent(Map<String, Object?> fields) async {
    if (await permission() != CapPermission.granted) {
      throw const PhoneDriverError(
        'Calendar access is off.',
        code: 'denied',
      );
    }
    final calendarId = await _calendarId(fields['calendar'] as String?);
    if (calendarId == null) {
      throw const PhoneDriverError('No writable calendar.', code: 'not_found');
    }
    final start = DateTime.tryParse('${fields['start']}');
    final end = DateTime.tryParse('${fields['end']}');
    if (start == null || end == null) {
      throw const PhoneDriverError('Bad start or end.', code: 'not_found');
    }
    final event = cal.Event(
      calendarId,
      title: '${fields['title'] ?? 'Event'}',
      start: _zoned(start),
      end: _zoned(end),
      location: fields['location'] as String?,
      description: fields['notes'] as String?,
      allDay: (fields['allDay'] as bool?) ?? false,
    );
    final result = await _plugin.createOrUpdateEvent(event);
    if (result?.isSuccess != true) {
      throw PhoneDriverError(
        result?.errors.map((e) => e.errorMessage).join('; ') ??
            'The event was not created.',
      );
    }
    return result?.data;
  }

  @override
  Future<bool> updateEvent(String id, Map<String, Object?> fields) async {
    if (await permission() != CapPermission.granted) {
      throw const PhoneDriverError(
        'Calendar access is off.',
        code: 'denied',
      );
    }
    final current = await getEvent(id);
    if (current == null) return false;
    final calendarId = await _calendarId(fields['calendar'] as String?);
    if (calendarId == null) return false;
    final start =
        DateTime.tryParse('${fields['start']}') ??
        DateTime.tryParse('${current['start']}');
    final end =
        DateTime.tryParse('${fields['end']}') ??
        DateTime.tryParse('${current['end']}');
    final event = cal.Event(
      calendarId,
      eventId: id,
      title: (fields['title'] as String?) ?? '${current['title']}',
      start: start == null ? null : _zoned(start),
      end: end == null ? null : _zoned(end),
      location: (fields['location'] as String?) ?? current['location'] as String?,
      description: (fields['notes'] as String?) ?? current['notes'] as String?,
      allDay: (fields['allDay'] as bool?) ?? current['allDay'] == true,
    );
    final result = await _plugin.createOrUpdateEvent(event);
    return result?.isSuccess == true;
  }

  @override
  Future<bool> deleteEvent(String id) async {
    if (await permission() != CapPermission.granted) {
      throw const PhoneDriverError(
        'Calendar access is off.',
        code: 'denied',
      );
    }
    final calendars = await _plugin.retrieveCalendars();
    for (final c in calendars.data ?? []) {
      if (c.id == null) continue;
      final result = await _plugin.deleteEvent(c.id, id);
      if (result.isSuccess && (result.data ?? false)) return true;
    }
    return false;
  }

  @override
  Future<bool> respondToInvite(String id, String response) async {
    // device_calendar has no invite-response API; the invite still opens
    // in the calendar app from the event list.
    throw const PhoneDriverError(
      'Answer invites in the calendar app.',
      code: 'unsupported',
    );
  }
}

/// Production contacts driver (flutter_contacts v2: immutable models).
class SystemContactsDriver implements ContactsDriver {
  static const _props = {
    contacts.ContactProperty.name,
    contacts.ContactProperty.phone,
    contacts.ContactProperty.email,
    contacts.ContactProperty.organization,
    contacts.ContactProperty.note,
  };

  Map<String, Object?> _contactJson(contacts.Contact contact) => {
    'id': contact.id,
    'displayName': contact.displayName,
    'givenName': contact.name?.first,
    'familyName': contact.name?.last,
    'phones': [for (final p in contact.phones) p.number],
    'emails': [for (final e in contact.emails) e.address],
    'company': contact.organizations.isEmpty
        ? null
        : contact.organizations.first.name,
    'notes': contact.notes.isEmpty ? null : contact.notes.first.note,
  };

  bool _matches(contacts.Contact contact, String query) {
    final haystack = [
      contact.displayName ?? '',
      contact.name?.first,
      contact.name?.last,
      contact.organizations.isEmpty
          ? ''
          : contact.organizations.first.name ?? '',
      for (final p in contact.phones) p.number,
      for (final e in contact.emails) e.address,
    ].join(' ').toLowerCase();
    return query
        .toLowerCase()
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .every(haystack.contains);
  }

  Future<void> _ensure(contacts.PermissionType type) async {
    final status = await contacts.FlutterContacts.permissions.request(type);
    if (status != contacts.PermissionStatus.granted &&
        status != contacts.PermissionStatus.limited) {
      throw const PhoneDriverError(
        'Contacts access is off.',
        code: 'denied',
      );
    }
  }

  @override
  Future<List<Map<String, Object?>>> search(String query) async {
    await _ensure(contacts.PermissionType.read);
    final all = await contacts.FlutterContacts.getAll(properties: _props);
    final hits = query.trim().isEmpty
        ? all.take(50)
        : all.where((c) => _matches(c, query)).take(50);
    return [for (final c in hits) _contactJson(c)];
  }

  @override
  Future<Map<String, Object?>?> get(String id) async {
    await _ensure(contacts.PermissionType.read);
    final contact = await contacts.FlutterContacts.get(
      id,
      properties: _props,
    );
    return contact == null ? null : _contactJson(contact);
  }

  @override
  Future<String?> create(Map<String, Object?> fields) async {
    await _ensure(contacts.PermissionType.write);
    final org = fields['organization'] as String?;
    final notes = fields['notes'] as String?;
    final contact = contacts.Contact(
      name: contacts.Name(
        first: '${fields['givenName'] ?? ''}',
        last: '${fields['familyName'] ?? ''}',
      ),
      phones: [
        for (final p in (fields['phones'] as List? ?? const []))
          contacts.Phone(number: '$p'),
      ],
      emails: [
        for (final e in (fields['emails'] as List? ?? const []))
          contacts.Email(address: '$e'),
      ],
      organizations: [
        if (org != null && org.isNotEmpty) contacts.Organization(name: org),
      ],
      notes: [
        if (notes != null && notes.isNotEmpty) contacts.Note(note: notes),
      ],
    );
    return contacts.FlutterContacts.create(contact);
  }

  @override
  Future<bool> update(String id, Map<String, Object?> fields) async {
    await _ensure(contacts.PermissionType.write);
    final contact = await contacts.FlutterContacts.get(
      id,
      properties: _props,
    );
    if (contact == null) return false;
    final given = fields['givenName'] as String?;
    final family = fields['familyName'] as String?;
    final phones = fields['phones'] as List?;
    final emails = fields['emails'] as List?;
    final next = contact.copyWith(
      name: given == null && family == null
          ? null
          : contacts.Name(
              first: given ?? contact.name?.first,
              last: family ?? contact.name?.last,
            ),
      phones: phones == null
          ? null
          : [for (final p in phones) contacts.Phone(number: '$p')],
      emails: emails == null
          ? null
          : [for (final e in emails) contacts.Email(address: '$e')],
    );
    await contacts.FlutterContacts.update(next);
    return true;
  }
}

/// Production location driver (foreground only).
class SystemLocationDriver implements LocationDriver {
  @override
  Future<Map<String, Object?>> current() async {
    var permission = await geo.Geolocator.checkPermission();
    if (permission == geo.LocationPermission.denied) {
      permission = await geo.Geolocator.requestPermission();
    }
    if (permission == geo.LocationPermission.denied ||
        permission == geo.LocationPermission.deniedForever) {
      throw const PhoneDriverError(
        'Location access is off.',
        code: 'denied',
      );
    }
    final position = await geo.Geolocator.getCurrentPosition();
    String? place;
    try {
      final marks = await geo.Geocoding().placemarkFromCoordinates(
        position.latitude,
        position.longitude,
      );
      final first = marks.firstOrNull;
      if (first != null) {
        place = [
          first.name,
          first.locality,
          first.administrativeArea,
        ].whereType<String>().where((p) => p.isNotEmpty).join(', ');
      }
    } catch (_) {}
    return {
      'latitude': position.latitude,
      'longitude': position.longitude,
      if (place != null && place.isNotEmpty) 'placeName': place,
    };
  }
}

/// Production message driver: hands the text to the OS composer.
class SystemMessageDriver implements MessageDriver {
  @override
  Future<bool> sendSms(String to, String text) async {
    final uri = Uri(
      scheme: 'sms',
      path: to,
      queryParameters: {'body': text},
    );
    try {
      return await launcher.launchUrl(uri);
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> sendWhatsapp(String to, String text) async {
    final digits = to.replaceAll(RegExp(r'[^0-9]'), '');
    final chat = Uri.parse(
      'https://wa.me/$digits?text=${Uri.encodeComponent(text)}',
    );
    try {
      if (await launcher.canLaunchUrl(chat)) {
        return await launcher.launchUrl(chat);
      }
      // WhatsApp missing: offer the store page instead.
      return await launcher.launchUrl(
        Uri.parse('https://www.whatsapp.com/download'),
      );
    } catch (_) {
      return false;
    }
  }
}
