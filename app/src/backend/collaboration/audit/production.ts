import { AuditJournal } from "./journal.js";
const journals = new Map<string, AuditJournal>();
export function journalFor(userId: string): AuditJournal {
  let journal = journals.get(userId);
  if (!journal) {
    journal = new AuditJournal(process.env.DATA_DIR || "./db/data", userId);
    journals.set(userId, journal);
  }
  return journal;
}
