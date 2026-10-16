/**
 * Libellé lisible d'un type de fichier (« Classeur Excel », « Document PDF »…)
 * à partir du type MIME, à défaut de l'extension. Pur : serveur, interface,
 * exports.
 */

const BY_MIME: Record<string, string> = {
  "application/pdf": "Document PDF",
  "application/msword": "Document Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Document Word",
  "application/vnd.oasis.opendocument.text": "Document texte (ODT)",
  "application/rtf": "Document RTF",
  "application/vnd.ms-excel": "Classeur Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Classeur Excel",
  "application/vnd.oasis.opendocument.spreadsheet": "Classeur (ODS)",
  "text/csv": "Fichier CSV",
  "application/vnd.ms-powerpoint": "Présentation PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "Présentation PowerPoint",
  "application/vnd.oasis.opendocument.presentation": "Présentation (ODP)",
  "text/plain": "Fichier texte",
  "text/markdown": "Fichier Markdown",
  "text/html": "Page HTML",
  "application/json": "Fichier JSON",
  "application/xml": "Fichier XML",
  "text/xml": "Fichier XML",
  "application/zip": "Archive ZIP",
  "application/x-zip-compressed": "Archive ZIP",
  "application/x-7z-compressed": "Archive 7z",
  "application/x-rar-compressed": "Archive RAR",
  "application/vnd.ms-outlook": "Message Outlook",
  "message/rfc822": "Message e-mail",
  "image/png": "Image PNG",
  "image/jpeg": "Image JPEG",
  "image/gif": "Image GIF",
  "image/webp": "Image WebP",
  "audio/mpeg": "Audio MP3",
  "video/mp4": "Vidéo MP4",
};

const BY_EXT: Record<string, string> = {
  pdf: "Document PDF",
  doc: "Document Word",
  docx: "Document Word",
  odt: "Document texte (ODT)",
  xls: "Classeur Excel",
  xlsx: "Classeur Excel",
  xlsm: "Classeur Excel",
  ods: "Classeur (ODS)",
  csv: "Fichier CSV",
  ppt: "Présentation PowerPoint",
  pptx: "Présentation PowerPoint",
  odp: "Présentation (ODP)",
  txt: "Fichier texte",
  md: "Fichier Markdown",
  json: "Fichier JSON",
  xml: "Fichier XML",
  zip: "Archive ZIP",
  msg: "Message Outlook",
  eml: "Message e-mail",
  png: "Image PNG",
  jpg: "Image JPEG",
  jpeg: "Image JPEG",
  gif: "Image GIF",
  webp: "Image WebP",
  mp3: "Audio MP3",
  mp4: "Vidéo MP4",
};

export function fileTypeLabel(mimeType: string | null | undefined, filename?: string | null): string {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (BY_MIME[mime]) return BY_MIME[mime];
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Vidéo";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.startsWith("text/")) return "Fichier texte";
  return ext ? `Fichier ${ext.toUpperCase()}` : "Fichier";
}
