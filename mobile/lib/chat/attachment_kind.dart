/// The type a picked file should be uploaded as. A phone path, a Windows path, and a name with no system type all resolve here.
class AttachmentKind {
  const AttachmentKind({required this.mime, required this.image, required this.leaf});

  final String mime;
  final bool image;
  final String leaf;
}

const _images = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
};

const _files = {
  'opus': 'audio/opus',
  'ogg': 'audio/ogg',
  'oga': 'audio/ogg',
  'mp3': 'audio/mpeg',
  'm4a': 'audio/mp4',
  'aac': 'audio/aac',
  'wav': 'audio/wav',
  'flac': 'audio/flac',
  'webm': 'audio/webm',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'markdown': 'text/markdown',
  'csv': 'text/csv',
  'tsv': 'text/tab-separated-values',
  'json': 'application/json',
  'pdf': 'application/pdf',
  'rtf': 'application/rtf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'odt': 'application/vnd.oasis.opendocument.text',
  'ods': 'application/vnd.oasis.opendocument.spreadsheet',
  'odp': 'application/vnd.oasis.opendocument.presentation',
};

String attachmentLeaf(String name) {
  final parts = name.trim().split(RegExp(r'[\\/]'));
  final leaf = parts.isEmpty ? name.trim() : parts.last.trim();
  return leaf.replaceAll(RegExp(r'[.\s]+$'), '');
}

String _extensionOf(String leaf) {
  final dot = leaf.lastIndexOf('.');
  if (dot <= 0 || dot == leaf.length - 1) return '';
  return leaf.substring(dot + 1).toLowerCase();
}

AttachmentKind? attachmentKind({String? name, String? path, String? extension}) {
  final source = (path != null && path.trim().isNotEmpty) ? path : (name ?? '');
  final leaf = attachmentLeaf(source.isEmpty ? (name ?? '') : source);
  final fromName = _extensionOf(leaf);
  final ext = (extension != null && extension.trim().isNotEmpty)
      ? extension.trim().toLowerCase().replaceAll(RegExp(r'^\.'), '')
      : fromName;
  if (ext.isEmpty || leaf.isEmpty) return null;
  final image = _images[ext];
  if (image != null) return AttachmentKind(mime: image, image: true, leaf: leaf);
  final file = _files[ext];
  if (file != null) return AttachmentKind(mime: file, image: false, leaf: leaf);
  return null;
}
