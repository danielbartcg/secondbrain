/**
 * Robustesse d'un mot de passe (jauge faible / moyenne / élevée) : longueur,
 * variété des caractères, pénalités pour les mots de passe courants, les
 * répétitions, les suites et la reprise de l'e-mail ou du nom. Indicatif :
 * le serveur n'impose que la longueur (8 à 72 caractères). Module pur.
 */

export type PasswordStrength = { level: "empty" | "short" | "weak" | "medium" | "strong"; score: number; label: string; hint: string };

const COMMON = [
  "password", "motdepasse", "azerty", "qwerty", "123456", "12345678", "123456789", "1234567890", "admin", "bonjour",
  "soleil", "iloveyou", "welcome", "secret", "letmein", "football", "doudou", "loulou", "marseille", "chouchou",
];

const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "azertyuiopqsdfghjklmwxcvbn", "qwertyuiopasdfghjklzxcvbnm", "01234567890"];

function hasSequence(pw: string): boolean {
  const s = pw.toLowerCase();
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 4 <= seq.length; i++) {
      const chunk = seq.slice(i, i + 4);
      if (s.includes(chunk) || s.includes([...chunk].reverse().join(""))) return true;
    }
  }
  return false;
}

export function passwordStrength(pw: string, personal: string[] = []): PasswordStrength {
  if (!pw) return { level: "empty", score: 0, label: "", hint: "" };
  if (pw.length < 8) return { level: "short", score: 0, label: "Trop court", hint: "8 caractères minimum." };

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  let score = 1;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  if (classes >= 4) score++;

  const lower = pw.toLowerCase();
  const hints: string[] = [];
  if (COMMON.some((c) => lower.includes(c))) {
    score -= 3;
    hints.push("évitez les mots de passe courants");
  }
  if (/(.)\1{2,}/.test(pw)) {
    score -= 1;
    hints.push("évitez les caractères répétés");
  }
  if (hasSequence(pw)) {
    score -= 1;
    hints.push("évitez les suites (abcd, 1234, azer…)");
  }
  const words = personal.flatMap((p) => p.toLowerCase().split(/[@.\s_-]+/)).filter((w) => w.length >= 3);
  if (words.some((w) => lower.includes(w))) {
    score -= 2;
    hints.push("n'utilisez pas votre nom ou votre e-mail");
  }
  if (!hints.length) {
    if (pw.length < 12) hints.push("12 caractères ou plus le rendraient plus sûr");
    else if (classes < 3) hints.push("mélangez majuscules, chiffres et symboles");
  }

  const level = score >= 5 ? "strong" : score >= 3 ? "medium" : "weak";
  const label = level === "strong" ? "Élevée" : level === "medium" ? "Moyenne" : "Faible";
  const hint = hints.length ? hints[0].charAt(0).toUpperCase() + hints[0].slice(1) + "." : "Très bon mot de passe.";
  return { level, score, label, hint };
}
