# Adds the LiveActivities widget extension target to Runner.xcodeproj and
# registers the new Runner sources. Idempotent: skips anything present.
require 'xcodeproj'

project_path = File.expand_path('Runner.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

runner = project.targets.find { |t| t.name == 'Runner' }
abort 'Runner target missing' unless runner

def ensure_file(project, target, path, group_path)
  group = project.main_group.find_subpath(group_path, true)
  base = File.basename(path)
  # Basename match inside the group: find_file_by_path misses here, and
  # Runner-group children resolve against ios/Runner/, so a prefixed
  # path would double (Runner/Runner/…).
  ref = group.children.find do |c|
    c.is_a?(Xcodeproj::Project::Object::PBXFileReference) &&
      File.basename(c.path.to_s) == base
  end
  ref ||= group.new_file(base)
  unless target.source_build_phase.files.any? { |f| f.file_ref == ref }
    target.source_build_phase.add_file_reference(ref)
  end
  ref
end

# New Runner sources.
ensure_file(project, runner, 'Runner/MaximusIntents.swift', 'Runner')
ensure_file(project, runner, 'Runner/MaximusActivityAttributes.swift', 'Runner')
runner_group = project.main_group.find_subpath('Runner', true)
entitlements = runner_group.children.find do |c|
  c.is_a?(Xcodeproj::Project::Object::PBXFileReference) &&
    File.basename(c.path.to_s) == 'Runner.entitlements'
end
entitlements ||= runner_group.new_file('Runner.entitlements')
runner.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'Runner/Runner.entitlements'
end

# Widget extension target.
ext = project.targets.find { |t| t.name == 'LiveActivities' }
unless ext
  ext = project.new_target(:app_extension, 'LiveActivities', :ios, '18.0', nil, :swift)
  ext.build_configurations.each do |config|
    settings = config.build_settings
    settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
    settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.maximus.app.LiveActivities'
    settings['INFOPLIST_FILE'] = 'LiveActivities/Info.plist'
    settings['CODE_SIGN_ENTITLEMENTS'] = 'LiveActivities/LiveActivities.entitlements'
    settings['CODE_SIGN_STYLE'] = 'Automatic'
    settings['SWIFT_VERSION'] = '5.0'
    settings['TARGETED_DEVICE_FAMILY'] = '1,2'
    settings['IPHONEOS_DEPLOYMENT_TARGET'] = '18.0'
    settings['GENERATE_INFOPLIST_FILE'] = 'NO'
    settings['SKIP_INSTALL'] = 'YES'
  end
  # Extension sources: widget UI + shared attributes.
  group = project.main_group.find_subpath('LiveActivities', true)
  group.set_source_tree('SOURCE_ROOT')
  widget_ref = group.find_file_by_path('LiveActivities/LiveActivities.swift') ||
    group.new_file('LiveActivities/LiveActivities.swift')
  ext.source_build_phase.add_file_reference(widget_ref)
  shared_ref = project.main_group.find_file_by_path('Runner/MaximusActivityAttributes.swift')
  ext.source_build_phase.add_file_reference(shared_ref) if shared_ref
  %w[LiveActivities/Info.plist LiveActivities/LiveActivities.entitlements].each do |path|
    group.find_file_by_path(path) || group.new_file(path)
  end
  # Embed the extension in the app, right after Embed Frameworks (the
  # template position; last place forms a planning cycle with the pods
  # script phases).
  copy_phase = runner.build_phases.find { |phase| phase.is_a?(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase) && phase.dst_subfolder_spec == '13' }
  unless copy_phase
    copy_phase = project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
    copy_phase.name = 'Embed App Extensions'
    copy_phase.dst_path = ''
    copy_phase.dst_subfolder_spec = '13'
    fw = runner.build_phases.index { |phase| phase.is_a?(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase) && phase.dst_subfolder_spec == '10' }
    if fw
      runner.build_phases.insert(fw + 1, copy_phase)
    else
      runner.build_phases << copy_phase
    end
  end
  unless copy_phase.files.any? { |f| f.file_ref&.path == 'LiveActivities.appex' }
    copy_phase.add_file_reference(ext.product_reference)
  end
  unless runner.dependencies.any? { |d| d.target == ext }
    runner.add_dependency(ext)
  end
end

# The extension builds off Generated.xcconfig only (FLUTTER_BUILD_NAME /
# FLUTTER_BUILD_NUMBER for its Info.plist). Never the Runner Flutter
# xcconfigs: those chain in the Pods-Runner flags and the extension would
# link every pod framework.
live = project.targets.find { |t| t.name == 'LiveActivities' }
if live
  gen = nil
  ([project.main_group] + project.main_group.recursive_children_groups).each do |group|
    group.children.each do |c|
      gen ||= c if c.is_a?(Xcodeproj::Project::Object::PBXFileReference) &&
        c.path.to_s.end_with?('Generated.xcconfig')
    end
  end
  if gen
    live.build_configurations.each do |ec|
      ec.base_configuration_reference = gen
    end
  end
end

# Privacy manifests ship inside each bundle's resources. Matched by
# basename inside the group: find_file_by_path misses these groups.
# The Runner group resolves children against ios/Runner/; the extension
# group has no path, so its children carry the directory prefix.
{
  runner => ['Runner', 'PrivacyInfo.xcprivacy'],
  project.targets.find { |t| t.name == 'LiveActivities' } =>
    ['LiveActivities', 'LiveActivities/PrivacyInfo.xcprivacy'],
}.each do |target, (dir, ref_path)|
  next unless target
  group = project.main_group.find_subpath(dir, true)
  group.set_source_tree('SOURCE_ROOT') unless dir == 'Runner'
  ref = group.children.find do |c|
    c.is_a?(Xcodeproj::Project::Object::PBXFileReference) &&
      File.basename(c.path.to_s) == 'PrivacyInfo.xcprivacy'
  end
  ref ||= group.new_file(ref_path)
  resources = target.resources_build_phase
  unless resources.files.any? { |f| f.file_ref == ref }
    resources.add_file_reference(ref)
  end
end

project.save
puts 'xcodeproj wired'
