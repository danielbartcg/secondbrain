import { Capacitor } from "@capacitor/core";

/**
 * Plateforme d'exécution de l'application native :
 *  - "desktop" : coque Electron (pont window.secondBrain) ;
 *  - "ios"     : coque Capacitor (WebView iOS, requêtes natives via CapacitorHttp) ;
 *  - "web"     : navigateur (développement Vite) ou tests Node.
 */
export type Platform = "desktop" | "ios" | "web";

export function platform(): Platform {
  if (typeof window === "undefined") return "web";
  if (window.secondBrain) return "desktop";
  if (Capacitor.isNativePlatform()) return "ios";
  return "web";
}

/**
 * Sur iPhone, l'interface est servie depuis capacitor://localhost : une image
 * de note « /media/… » n'y existe pas. Les réponses de l'API locale reçoivent
 * donc des URL de médias absolues (serveur), et les écritures les remettent en
 * relatif avant enregistrement : la base (locale comme serveur) ne contient
 * jamais que des chemins /media/… — identique au site et au desktop.
 */
export function mediaRewriter(serverUrl: () => string) {
  const toAbsolute = <T>(value: T): T => {
    const base = serverUrl();
    if (!base || value === undefined || value === null) return value;
    const json = JSON.stringify(value);
    return json.includes('"/media/') ? (JSON.parse(json.split('"/media/').join(`"${base}/media/`)) as T) : value;
  };
  const toRelative = <T>(value: T): T => {
    const base = serverUrl();
    if (!base || value === undefined || value === null) return value;
    const json = JSON.stringify(value);
    const needle = `"${base}/media/`;
    return json.includes(needle) ? (JSON.parse(json.split(needle).join('"/media/')) as T) : value;
  };
  return { toAbsolute, toRelative };
}
