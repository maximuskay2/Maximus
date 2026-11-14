import 'dart:io';

import 'package:flutter/services.dart';

import 'executor.dart';

/// MethodChannel maximus/phone_apps (iOS EventKit / HomeKit / alarms).
class NativePhoneApps {
  NativePhoneApps({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel('maximus/phone_apps');

  final MethodChannel _channel;

  bool get supported => Platform.isIOS;

  Future<String> _status(String method, [Map<String, Object?>? args]) async {
    if (!supported) return 'denied';
    final value = await _channel.invokeMethod<Object?>(method, args);
    return value is String ? value : 'denied';
  }

  Future<String> remindersPermission() => _status('reminders.permission');
  Future<String> requestRemindersPermission() =>
      _status('reminders.requestPermission');
  Future<String> alarmsPermission() => _status('alarms.permission');
  Future<String> requestAlarmsPermission() =>
      _status('alarms.requestPermission');
  Future<String> homePermission() => _status('home.permission');
  Future<String> requestHomePermission() => _status('home.requestPermission');

  Future<List<Map<String, Object?>>> remindersList({
    String? list,
    DateTime? from,
    DateTime? to,
    bool completed = false,
  }) async {
    final raw = await _channel.invokeMethod<List<Object?>>('reminders.list', {
      if (list != null) 'list': list,
      if (from != null) 'from': from.toUtc().toIso8601String(),
      if (to != null) 'to': to.toUtc().toIso8601String(),
      'completed': completed,
    });
    return [
      for (final row in raw ?? const [])
        if (row is Map) Map<String, Object?>.from(row),
    ];
  }

  Future<String?> remindersCreate(Map<String, Object?> fields) async {
    final id = await _channel.invokeMethod<Object?>('reminders.create', fields);
    return id?.toString();
  }

  Future<bool> remindersUpdate(String id, Map<String, Object?> fields) async {
    final ok = await _channel.invokeMethod<Object?>('reminders.update', {
      ...fields,
      'id': id,
    });
    return ok == true;
  }

  Future<bool> remindersComplete(String id) async {
    final ok = await _channel.invokeMethod<Object?>('reminders.complete', {
      'id': id,
    });
    return ok == true;
  }

  Future<bool> remindersDelete(String id) async {
    final ok = await _channel.invokeMethod<Object?>('reminders.delete', {
      'id': id,
    });
    return ok == true;
  }

  Future<String?> alarmsCreate(Map<String, Object?> fields) async {
    final id = await _channel.invokeMethod<Object?>('alarms.create', fields);
    return id?.toString();
  }

  Future<List<Map<String, Object?>>> alarmsList() async {
    final raw = await _channel.invokeMethod<List<Object?>>('alarms.list');
    return [
      for (final row in raw ?? const [])
        if (row is Map) Map<String, Object?>.from(row),
    ];
  }

  Future<bool> alarmsDelete(String id) async {
    final ok = await _channel.invokeMethod<Object?>('alarms.delete', {
      'id': id,
    });
    return ok == true;
  }

  Future<Map<String, Object?>> homeList() async {
    final raw = await _channel.invokeMethod<Object?>('home.list');
    if (raw is Map) return Map<String, Object?>.from(raw);
    return const {'homes': <Object?>[]};
  }

  Future<bool> homeSetAccessory(Map<String, Object?> fields) async {
    final ok = await _channel.invokeMethod<Object?>('home.setAccessory', fields);
    return ok == true;
  }

  Future<bool> homeRunScene(Map<String, Object?> fields) async {
    final ok = await _channel.invokeMethod<Object?>('home.runScene', fields);
    return ok == true;
  }
}

class SystemRemindersDriver implements RemindersDriver {
  SystemRemindersDriver([NativePhoneApps? native])
    : _native = native ?? NativePhoneApps();

  final NativePhoneApps _native;

  Future<CapPermissionLike> permission() async {
    switch (await _native.remindersPermission()) {
      case 'granted':
        return CapPermissionLike.granted;
      case 'denied':
        return CapPermissionLike.denied;
      default:
        return CapPermissionLike.notAsked;
    }
  }

  Future<bool> requestPermission() async =>
      (await _native.requestRemindersPermission()) == 'granted';

  @override
  Future<List<Map<String, Object?>>> list({
    String? list,
    DateTime? from,
    DateTime? to,
    bool completed = false,
  }) =>
      _native.remindersList(
        list: list,
        from: from,
        to: to,
        completed: completed,
      );

  @override
  Future<String?> create(Map<String, Object?> fields) =>
      _native.remindersCreate(fields);

  @override
  Future<bool> update(String id, Map<String, Object?> fields) =>
      _native.remindersUpdate(id, fields);

  @override
  Future<bool> complete(String id) => _native.remindersComplete(id);

  @override
  Future<bool> delete(String id) => _native.remindersDelete(id);
}

enum CapPermissionLike { granted, denied, notAsked }

class SystemAlarmsDriver implements AlarmsDriver {
  SystemAlarmsDriver([NativePhoneApps? native])
    : _native = native ?? NativePhoneApps();

  final NativePhoneApps _native;
  final _channel = const MethodChannel('maximus/phone_apps');

  Future<bool> requestPermission() async {
    if (Platform.isIOS) {
      return (await _native.requestAlarmsPermission()) == 'granted';
    }
    return true;
  }

  @override
  Future<List<Map<String, Object?>>> list() async {
    if (Platform.isIOS) return _native.alarmsList();
    return const [];
  }

  @override
  Future<String?> create(Map<String, Object?> fields) async {
    if (Platform.isIOS) return _native.alarmsCreate(fields);
    final at = fields['at'] ?? fields['due'];
    final title = fields['title'];
    if (at is! String || title is! String) {
      throw const PhoneDriverError('Alarm needs title and at.', code: 'not_found');
    }
    final opened = await _channel.invokeMethod<Object?>('alarms.create', {
      'title': title,
      'at': at,
      if (fields['notes'] != null) 'notes': fields['notes'],
    });
    return opened?.toString() ?? 'android-alarm';
  }

  @override
  Future<bool> delete(String id) async {
    if (Platform.isIOS) return _native.alarmsDelete(id);
    return false;
  }
}

class SystemHomeDriver implements HomeDriver {
  SystemHomeDriver([NativePhoneApps? native])
    : _native = native ?? NativePhoneApps();

  final NativePhoneApps _native;

  Future<bool> requestPermission() async =>
      (await _native.requestHomePermission()) == 'granted';

  @override
  Future<Map<String, Object?>> list() => _native.homeList();

  @override
  Future<bool> setAccessory(Map<String, Object?> fields) =>
      _native.homeSetAccessory(fields);

  @override
  Future<bool> runScene(Map<String, Object?> fields) =>
      _native.homeRunScene(fields);
}
