// Response transport (spec §15.6). The respondent flow ends by handing an
// encrypted envelope to a transport, and the dashboard reads envelopes from
// one, so the survey screens do not depend on how a response travels.
// v1 has one implementation: the respondent returns an encrypted file or text
// block by their own means. CLAUDE.md, "Server transport", describes how a
// server implementation would plug in (submit, acknowledge, status polling).

import { armour, readArmoured, receiptCode, responseFileName, type Envelope } from './response';

export type SubmitResult =
  | {
      /** The respondent carries the response: offer a file and a text block. */
      kind: 'manual';
      receipt: string;
      text: string;
      fileName: string;
    }
  | {
      /** Reserved for a server transport: stored and acknowledged. */
      kind: 'acknowledged';
      receipt: string;
      receivedAt: string;
    };

export interface IncomingText {
  /** File name, or a label such as "Pasted text 1". */
  source: string;
  text: string;
}

export interface CollectedEnvelope {
  source: string;
  envelope: Envelope;
}

export interface CollectResult {
  envelopes: CollectedEnvelope[];
  /** Sources that held no readable response. */
  unreadable: string[];
}

export interface ResponseTransport {
  readonly kind: 'file' | 'server';
  submit(envelope: Envelope): Promise<SubmitResult>;
  /** Envelopes from what the analyst supplied (file transport) or fetched (server). */
  collect(items: readonly IncomingText[]): CollectResult;
}

export const fileTransport: ResponseTransport = {
  kind: 'file',
  async submit(envelope) {
    const receipt = await receiptCode(envelope);
    return { kind: 'manual', receipt, text: armour(envelope), fileName: responseFileName(receipt) };
  },
  collect(items) {
    const envelopes: CollectedEnvelope[] = [];
    const unreadable: string[] = [];
    for (const item of items) {
      const { envelopes: found, unreadable: bad } = readArmoured(item.text);
      for (const envelope of found) envelopes.push({ source: item.source, envelope });
      if (found.length === 0 || bad > 0) unreadable.push(item.source);
    }
    return { envelopes, unreadable };
  },
};
