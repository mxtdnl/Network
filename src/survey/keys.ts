// Analyst keys for a survey (spec §15.2): creation, the passphrase-protected
// backup file, and the check that the analyst holds a working backup
// (CLAUDE.md D87: a browser cannot confirm a download was saved, so the
// analyst opens the saved file and Graticule decrypts it).

import type { SurveyKey } from '../data/schema';
import {
  exportPublicKey,
  generateAnalystKeyPair,
  keyFingerprint,
  PassphraseError,
  PBKDF2_ITERATIONS,
  unwrapPrivateKey,
  wrapPrivateKey,
} from './crypto';

export const BACKUP_FORMAT = 'graticule-key-backup';

export async function createSurveyKey(
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ key: SurveyKey; privateKey: CryptoKey }> {
  const pair = await generateAnalystKeyPair();
  const public_key = await exportPublicKey(pair.publicKey);
  const key: SurveyKey = {
    public_key,
    fingerprint: await keyFingerprint(public_key),
    wrapped: await wrapPrivateKey(pair.privateKey, passphrase, iterations),
  };
  // Re-import through the wrapped copy, so the key in use is not extractable
  // and is the one the backup holds.
  return { key, privateKey: await unwrapPrivateKey(key.wrapped, passphrase) };
}

export function backupText(surveyId: string, title: string, key: SurveyKey, now: string): string {
  return `${JSON.stringify(
    { format: BACKUP_FORMAT, v: 1, survey_id: surveyId, survey_title: title, created_at: now, key },
    null,
    2,
  )}\n`;
}

export const backupFileName = (surveyId: string) => `graticule-key-${surveyId}.json`;

export class BackupError extends Error {
  constructor(readonly reason: 'notBackup' | 'otherSurvey' | 'passphrase') {
    super(reason);
  }
}

/** Opens a backup and checks it belongs to `key`; returns the private key. */
export async function verifyBackup(
  text: string,
  passphrase: string,
  expected: SurveyKey,
): Promise<CryptoKey> {
  let file: { format?: unknown; key?: SurveyKey };
  try {
    file = JSON.parse(text) as typeof file;
  } catch {
    throw new BackupError('notBackup');
  }
  if (file.format !== BACKUP_FORMAT || typeof file.key !== 'object')
    throw new BackupError('notBackup');
  if (file.key.fingerprint !== expected.fingerprint) throw new BackupError('otherSurvey');
  try {
    return await unwrapPrivateKey(file.key.wrapped, passphrase);
  } catch (e) {
    if (e instanceof PassphraseError) throw new BackupError('passphrase');
    throw e;
  }
}
