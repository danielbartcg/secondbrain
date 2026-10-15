/** Libellés des types de notification (administration, e-mails). Module pur, partagé client / serveur. */
export const NOTIFICATION_TYPE_INFO = {
  ASSIGNED: { label: "Affectation", description: "Une tâche vous est assignée (responsable, superviseur ou contributeur)." },
  TASK_UPDATED: { label: "Tâche modifiée", description: "Une tâche qui vous est assignée a été modifiée par quelqu'un d'autre." },
  REPLY: { label: "Réponse", description: "Quelqu'un a répondu à votre commentaire." },
  MENTION: { label: "Mention", description: "Vous avez été mentionné (@) dans un commentaire." },
  MESSAGE: { label: "Message", description: "Nouveau message dans une de vos conversations (messagerie)." },
} as const;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPE_INFO;
