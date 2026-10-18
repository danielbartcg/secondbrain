/**
 * Génération iCalendar (RFC 5545) pure et sans dépendance : évènements d'une
 * journée entière (`allDay` AAAA-MM-JJ) ou horodatés (`start` / `end`, en
 * UTC). Lignes terminées par CRLF, repliées à 75 octets, textes échappés.
 */

export type CalendarEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  /** Journée entière : AAAA-MM-JJ. */
  allDay?: string;
  start?: Date;
  end?: Date;
  updatedAt?: Date;
  /** N'occupe pas l'agenda (affiché « disponible »). */
  transparent?: boolean;
};

/** Échappement des valeurs TEXT : \ ; , et sauts de ligne. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Repli des lignes à 75 octets UTF-8 (sans couper un caractère). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // les lignes de continuation commencent par une espace
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** Horodatage UTC iCalendar : AAAAMMJJTHHMMSSZ. */
export function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const dateValue = (ymd: string) => ymd.replace(/-/g, "");

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildCalendar(name: string, events: CalendarEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Second Brain//Calendrier//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const stamp = utcStamp(now);
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${escapeText(e.uid)}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.allDay)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(e.allDay))}`);
    } else if (e.start) {
      lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end ?? new Date(e.start.getTime() + 3_600_000))}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.updatedAt) lines.push(`LAST-MODIFIED:${utcStamp(e.updatedAt)}`);
    if (e.transparent) lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
