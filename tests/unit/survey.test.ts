// Respondent mode core (spec §15): cryptography, key backup, links and
// packages, import decisions and the ties they produce.

import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../src/data/coverage';
import { parseProject, serialiseProject } from '../../src/data/projectFile';
import type { Project, Survey } from '../../src/data/schema';
import { fromBase64Url, toBase64Url } from '../../src/survey/bytes';
import { applyImport, planImport } from '../../src/survey/collect';
import {
  DecryptError,
  PassphraseError,
  PBKDF2_ITERATIONS,
  unwrapPrivateKey,
} from '../../src/survey/crypto';
import { BackupError, backupText, createSurveyKey, verifyBackup } from '../../src/survey/keys';
import {
  buildLinks,
  createSurvey,
  currentVersion,
  estimateMinutes,
  estimateSeconds,
  linksCsv,
  payloadFor,
  surveyStatus,
  updateSurvey,
} from '../../src/survey/model';
import {
  LINK_BUDGET,
  PackageMismatchError,
  parseRespondHash,
  readLink,
  readPackage,
} from '../../src/survey/payload';
import {
  armour,
  decryptResponse,
  encryptResponse,
  readArmoured,
  type Answer,
  type ResponseBody,
} from '../../src/survey/response';
import { fileTransport } from '../../src/survey/transport';
import { demoProject, draftFor, namedProject } from '../fixtures/surveyProject';

const BASE = 'https://username.github.io/network/';

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('Expected a value.');
  return v;
}
const NOW = '2026-09-27T09:00:00.000Z';
const FAST = 1000; // PBKDF2 iterations for tests that are not about the KDF
const PASS = 'correct horse battery';

async function setup(project: Project = demoProject(), patch = {}) {
  const { key, privateKey } = await createSurveyKey(PASS, FAST);
  const survey = createSurvey(draftFor(project, patch), project, key, NOW, 'SURVEYid001');
  return { project: { ...project, surveys: [survey] }, survey, privateKey };
}

/** A respondent's answers, as the respondent page builds them. */
function bodyFor(
  survey: Survey,
  memberId: string,
  fill: (layer: string, position: number) => Answer,
  opts: { version?: number; token?: string; nominated?: number[] | null; at?: string } = {},
): ResponseBody {
  const version =
    survey.versions.find((v) => v.version === (opts.version ?? 1)) ?? currentVersion(survey);
  const position = version.roster.indexOf(memberId);
  const answers: Record<string, Answer[]> = {};
  for (const l of version.layers)
    answers[l.key] = version.roster.map((_, j) => (j === position ? null : fill(l.key, j)));
  return {
    survey_id: survey.id,
    version: version.version,
    position,
    token: opts.token ?? survey.respondents.find((r) => r.member_id === memberId)?.token ?? '',
    submitted_at: opts.at ?? NOW,
    nominated: opts.nominated === undefined ? null : opts.nominated,
    answers,
  };
}

async function envelopeText(survey: Survey, body: ResponseBody) {
  const result = await fileTransport.submit(
    await encryptResponse(body, survey.key.public_key, survey.key.fingerprint),
  );
  if (result.kind !== 'manual') throw new Error('expected manual');
  return result;
}

async function importTexts(
  project: Project,
  survey: Survey,
  key: CryptoKey | null,
  texts: string[],
) {
  const collected = fileTransport.collect(
    texts.map((text, i) => ({ source: `file ${String(i + 1)}`, text })),
  );
  return planImport(project, survey, key, collected);
}

describe('encryption', () => {
  it('round-trips a response: ECDH P-256, HKDF-SHA-256, AES-256-GCM', async () => {
    const { survey, privateKey } = await setup();
    const body = bodyFor(survey, 'FIN02', () => 3);
    const env = await encryptResponse(body, survey.key.public_key, survey.key.fingerprint);
    expect(fromBase64Url(env.epk)).toHaveLength(65);
    expect(fromBase64Url(env.iv)).toHaveLength(12);
    expect(fromBase64Url(env.salt)).toHaveLength(32);
    expect(await decryptResponse(privateKey, env)).toStrictEqual(body);
    // A fresh ephemeral key each time: the same answers never encrypt alike.
    const again = await encryptResponse(body, survey.key.public_key, survey.key.fingerprint);
    expect(again.epk).not.toBe(env.epk);
    expect(again.ct).not.toBe(env.ct);
  });

  it('fails authentication with the wrong key', async () => {
    const { survey } = await setup();
    const other = await createSurveyKey('another passphrase', FAST);
    const env = await encryptResponse(
      bodyFor(survey, 'FIN02', () => 1),
      survey.key.public_key,
      survey.key.fingerprint,
    );
    await expect(decryptResponse(other.privateKey, env)).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails authentication when the ciphertext or the header is altered', async () => {
    const { survey, privateKey } = await setup();
    const env = await encryptResponse(
      bodyFor(survey, 'FIN02', () => 1),
      survey.key.public_key,
      survey.key.fingerprint,
    );
    const ct = fromBase64Url(env.ct);
    ct[10] = (ct[10] ?? 0) ^ 1;
    await expect(
      decryptResponse(privateKey, { ...env, ct: toBase64Url(ct) }),
    ).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptResponse(privateKey, { ...env, version: 2 })).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it('reads armoured blocks from files and from pasted, re-wrapped and quoted email text', async () => {
    const { survey } = await setup();
    const a = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', () => 1),
    );
    const b = await envelopeText(
      survey,
      bodyFor(survey, 'FIN03', () => 2),
    );
    const quoted = b.text
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\r\n');
    const pasted = `Hello,\n\nHere it is:\n${a.text}\nThanks\n\n${quoted}`;
    expect(readArmoured(pasted).envelopes).toHaveLength(2);
    expect(readArmoured(a.text.replace(/\n(?=[A-Za-z0-9_-])/g, ' \n ')).envelopes).toHaveLength(1);
    expect(readArmoured('no response here')).toStrictEqual({ envelopes: [], unreadable: 0 });
    expect(a.fileName).toMatch(/^graticule-response-[0-9A-HJKMNP-TV-Z]{8}\.txt$/);
    expect(a.receipt).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});

describe('key backup', () => {
  it('round-trips the private key through the passphrase-protected backup', async () => {
    const { survey, privateKey } = await setup();
    const text = backupText(survey.id, survey.title, survey.key, NOW);
    const restored = await verifyBackup(text, PASS, survey.key);
    const env = await encryptResponse(
      bodyFor(survey, 'FIN02', () => 4),
      survey.key.public_key,
      survey.key.fingerprint,
    );
    expect(await decryptResponse(restored, env)).toStrictEqual(
      await decryptResponse(privateKey, env),
    );
    expect(text).not.toContain(PASS);
  });

  it('refuses a wrong passphrase, another survey’s backup and a file that is not a backup', async () => {
    const { survey } = await setup();
    const text = backupText(survey.id, survey.title, survey.key, NOW);
    await expect(verifyBackup(text, 'wrong passphrase!', survey.key)).rejects.toStrictEqual(
      new BackupError('passphrase'),
    );
    const other = await createSurveyKey(PASS, FAST);
    await expect(verifyBackup(text, PASS, other.key)).rejects.toStrictEqual(
      new BackupError('otherSurvey'),
    );
    await expect(verifyBackup('{"a":1}', PASS, survey.key)).rejects.toStrictEqual(
      new BackupError('notBackup'),
    );
    await expect(unwrapPrivateKey(survey.key.wrapped, 'nope nope nope')).rejects.toBeInstanceOf(
      PassphraseError,
    );
  });

  it('uses PBKDF2 with 600,000 iterations by default and stores the key only wrapped', async () => {
    const { key } = await createSurveyKey(PASS);
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(key.wrapped.iterations).toBe(600_000);
    const project = demoProject();
    const survey = createSurvey(draftFor(project), project, key, NOW);
    const saved = serialiseProject({ ...project, surveys: [survey] });
    expect(saved).not.toContain(PASS);
    expect(parseProject(saved).surveys[0]).toStrictEqual(survey);
  });
});

describe('links and packages', () => {
  const lengths: Record<number, number> = {};

  it.each([40, 100, 250])('encodes and parses a link at %i members', async (n) => {
    const { project, survey } = await setup(namedProject(n), { entry: 'nominate' });
    const version = currentVersion(survey);
    const { links, longestFullLink } = await buildLinks(
      { ...survey, settings: { ...survey.settings, link_mode: 'auto' } },
      project,
      BASE,
    );
    lengths[n] = longestFullLink;
    const payload = payloadFor(survey, version, project);
    // Parse the first member's link (a package link when over budget).
    const link = links[0];
    expect(link).toBeDefined();
    const route = parseRespondHash(new URL(must(link).url).hash);
    if (longestFullLink <= LINK_BUDGET) {
      expect(route?.kind).toBe('link');
      const read = await readLink((route as { encoded: string }).encoded);
      expect(read.payload).toStrictEqual(payload);
      expect(read.personal).toStrictEqual({ position: 0, token: survey.respondents[0]?.token });
    } else {
      expect(route?.kind).toBe('package');
      expect(must(link).url.length).toBeLessThan(120);
    }
    // Everything a respondent must never see is absent.
    expect(JSON.stringify(payload)).not.toContain('Finance');
  });

  it('reports the measured link lengths and applies the 2,000-character budget', () => {
    console.info(
      `Full link lengths (4 core layers, nomination): 40 members ${String(lengths[40])}, 100 members ${String(lengths[100])}, 250 members ${String(lengths[250])} characters`,
    );
    expect(lengths[40]).toBeLessThanOrEqual(LINK_BUDGET);
    expect(lengths[100]).toBeGreaterThan(LINK_BUDGET);
    expect(lengths[250]).toBeGreaterThan(LINK_BUDGET);
  });

  it('falls back to a package with short links, and refuses a package that does not match', async () => {
    const { project, survey } = await setup(namedProject(250));
    const { links, packages } = await buildLinks(survey, project, BASE);
    expect(links.every((l) => l.package)).toBe(true);
    const pkg = packages.get(1);
    expect(pkg?.fileName).toBe(`graticule-survey-${survey.id}-v1.graticule-survey`);
    const route = parseRespondHash(new URL(must(links[7]).url).hash);
    if (route?.kind !== 'package') throw new Error('expected a package link');
    expect(route.personal.position).toBe(7);
    const payload = await readPackage(must(pkg).text, route);
    expect(payload).toStrictEqual(payloadFor(survey, currentVersion(survey), project));
    // A package for another survey (another key) is refused.
    const other = await setup(namedProject(250));
    const otherPkg = (await buildLinks(other.survey, other.project, BASE)).packages.get(1);
    await expect(readPackage(must(otherPkg).text, route)).rejects.toBeInstanceOf(
      PackageMismatchError,
    );
    await expect(readPackage('not json', route)).rejects.toThrow();
  });

  it('uses a package under "Always use a survey package" even for a small survey', async () => {
    const { project, survey } = await setup(demoProject(), {
      settings: { burden_limit_minutes: 15, expected_nominations: 12, link_mode: 'package' },
    });
    const { links, packages } = await buildLinks(survey, project, BASE);
    expect(links.every((l) => l.package)).toBe(true);
    expect(packages.size).toBe(1);
  });

  it('refuses a damaged or truncated link', async () => {
    const { project, survey } = await setup();
    const { links } = await buildLinks(survey, project, BASE);
    const encoded = new URL(must(links[0]).url).hash.slice('#/respond/'.length);
    await expect(readLink(encoded.slice(0, -40))).rejects.toThrow();
    expect(parseRespondHash('#/respond/p/a.b.c')).toStrictEqual({ kind: 'invalid' });
    expect(parseRespondHash('#/map')).toBeNull();
  });

  it('writes a mail-merge CSV with names, recorded emails and links', async () => {
    const base = demoProject();
    base.attribute_definitions.push({
      key: 'email',
      label: 'Email',
      type: 'email',
      builtin: false,
    });
    const first = must(base.members[0]);
    first.attributes.email = 'ada@example.org';
    const { project, survey } = await setup(base);
    const { links } = await buildLinks(survey, project, BASE);
    const csv = linksCsv(project, links);
    expect(csv.startsWith('﻿name,email,link\r\n')).toBe(true);
    expect(csv).toContain(`Ada Meridian,ada@example.org,${must(links[0]).url}\r\n`);
    // Email never reaches a link.
    const read = await readLink(new URL(must(links[0]).url).hash.slice('#/respond/'.length));
    expect(JSON.stringify(read)).not.toContain('ada@example.org');
  });

  it('estimates completion time from roster size, layers and entry method', () => {
    expect(estimateSeconds(40, 4, 'full', 12)).toBe(60 + 39 * 4 * 5);
    expect(estimateSeconds(40, 4, 'nominate', 12)).toBe(60 + 39 * 2 + 12 * 4 * 5);
    expect(estimateMinutes(estimateSeconds(250, 4, 'full', 12))).toBe(84);
  });
});

describe('import', () => {
  it('turns responses into self-report ties with the survey’s wave and version, and updates coverage', async () => {
    const { project, survey, privateKey } = await setup(demoProject(), { entry: 'full', wave: 1 });
    // Start from a project with no ratings, so coverage comes from the survey.
    const empty = { ...project, ties: [] };
    const a = await envelopeText(
      survey,
      bodyFor(survey, 'FIN01', (layer, j) => (layer === 'valence' ? -1 : j % 6)),
    );
    const plan = await importTexts(empty, survey, privateKey, [a.text]);
    expect(plan.rejected).toStrictEqual([]);
    expect(plan.accepted.map((x) => x.memberId)).toStrictEqual(['FIN01']);
    expect(plan.report.skippedRows).toBe(0);
    const next = applyImport(empty, plan, NOW);
    const fin01 = next.ties.filter((t) => t.rater_id === 'FIN01');
    expect(fin01).toHaveLength(39 * 4);
    const t = fin01.find((x) => x.ratee_id === 'FIN03' && x.variable === 'connection_strength');
    expect(t).toStrictEqual({
      rater_id: 'FIN01',
      ratee_id: 'FIN03',
      variable: 'connection_strength',
      value: 2,
      wave: 1,
      source: 'self_report',
      survey: { id: survey.id, version: 1 },
    });
    expect(fin01.find((x) => x.variable === 'valence')?.value).toBe(-1);
    expect(computeCoverage(next).raters.find((r) => r.id === 'FIN01')?.rate).toBe(1);
    expect(surveyStatus(must(next.surveys[0])).responded).toBe(1);
    // The project with a survey and its log round-trips through the file.
    expect(parseProject(serialiseProject(next))).toStrictEqual(next);
  });

  it('stores colleagues not selected as 0 on unsigned layers and leaves signed layers unrated', async () => {
    const { project, survey, privateKey } = await setup(demoProject(), { entry: 'nominate' });
    const empty = { ...project, ties: [] };
    const v = currentVersion(survey);
    const nominated = [1, 2]; // FIN02, FIN03
    const body = bodyFor(
      survey,
      'FIN01',
      (l, j) => (nominated.includes(j) ? (l === 'valence' ? 2 : 4) : null),
      { nominated },
    );
    const plan = await importTexts(empty, survey, privateKey, [
      (await envelopeText(survey, body)).text,
    ]);
    const next = applyImport(empty, plan, NOW);
    const get = (ratee: string, layer: string) =>
      next.ties.find((t) => t.rater_id === 'FIN01' && t.ratee_id === ratee && t.variable === layer)
        ?.value;
    expect(get('FIN02', 'connection_strength')).toBe(4);
    expect(get(must(v.roster[10]), 'connection_strength')).toBe(0);
    expect(get(must(v.roster[10]), 'valence')).toBeUndefined();
    expect(get('FIN02', 'valence')).toBe(2);
    // Every rating is either a nomination answer or a stored 0.
    expect(next.ties.filter((t) => t.rater_id === 'FIN01')).toHaveLength(39 * 3 + 2); // three unsigned layers, valence for the two selected
  });

  it('rejects an unknown token, a token that does not match its roster position, and a tampered file', async () => {
    const { project, survey, privateKey } = await setup();
    const unknown = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', () => 1, { token: 'not-a-token' }),
    );
    const theirs = survey.respondents.find((r) => r.member_id === 'FIN03')?.token ?? '';
    const mismatch = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', () => 1, { token: theirs }),
    );
    const env = await encryptResponse(
      bodyFor(survey, 'FIN04', () => 1),
      survey.key.public_key,
      survey.key.fingerprint,
    );
    const ct = fromBase64Url(env.ct);
    ct[5] = (ct[5] ?? 0) ^ 0x10;
    const tampered = armour({ ...env, ct: toBase64Url(ct) });
    const plan = await importTexts(project, survey, privateKey, [
      unknown.text,
      mismatch.text,
      tampered,
    ]);
    expect(plan.rejected.map((r) => r.reason)).toStrictEqual([
      'unknown_token',
      'token_mismatch',
      'tampered',
    ]);
    expect(plan.accepted).toStrictEqual([]);
    expect(plan.ties).toStrictEqual([]);
  });

  it('rejects a file encrypted with another key and a response to another survey', async () => {
    const { project, survey, privateKey } = await setup();
    const other = await setup();
    const foreign = await envelopeText(
      other.survey,
      bodyFor(other.survey, 'FIN02', () => 1),
    );
    const otherId = { ...other.survey, id: 'OTHERsurvey' };
    const elsewhere = await envelopeText(
      otherId,
      bodyFor(otherId, 'FIN02', () => 1),
    );
    const plan = await importTexts(project, survey, privateKey, [foreign.text, elsewhere.text]);
    expect(plan.rejected.map((r) => r.reason)).toStrictEqual(['other_key', 'other_survey']);
    // With the wrong private key for the right fingerprint, authentication fails.
    const good = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', () => 1),
    );
    const wrongKey = await importTexts(project, survey, other.privateKey, [good.text]);
    expect(wrongKey.rejected.map((r) => r.reason)).toStrictEqual(['tampered']);
  });

  it('rejects a response to a version the survey does not have', async () => {
    const { project, survey, privateKey } = await setup();
    const body = { ...bodyFor(survey, 'FIN02', () => 1), version: 2 };
    const plan = await importTexts(project, survey, privateKey, [
      (await envelopeText(survey, body)).text,
    ]);
    expect(plan.rejected.map((r) => r.reason)).toStrictEqual(['unknown_version']);
  });

  it('keeps the latest of two submissions with one token, logs the duplicate, and ignores a replayed file', async () => {
    const { project, survey, privateKey } = await setup(demoProject(), { entry: 'full' });
    const empty = { ...project, ties: [] };
    const early = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', () => 1, { at: '2026-10-01T09:00:00Z' }),
    );
    const late = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', () => 5, { at: '2026-10-02T09:00:00Z' }),
    );
    // Both in one batch, the later one first.
    const plan = await importTexts(empty, survey, privateKey, [late.text, early.text]);
    expect(plan.accepted.map((a) => a.receipt)).toStrictEqual([late.receipt]);
    expect(plan.duplicates).toStrictEqual([
      { memberId: 'FIN02', kept: late.receipt, setAside: early.receipt },
    ]);
    let next = applyImport(empty, plan, NOW);
    expect(next.ties.find((t) => t.rater_id === 'FIN02')?.value).toBe(5);
    expect(surveyStatus(must(next.surveys[0])).duplicates).toBe(1);

    // The same file again changes nothing.
    const replay = await importTexts(next, must(next.surveys[0]), privateKey, [
      late.text,
      early.text,
    ]);
    expect(replay.alreadyImported.map((r) => r.receipt).sort()).toStrictEqual(
      [early.receipt, late.receipt].sort(),
    );
    expect(replay.accepted).toStrictEqual([]);

    // A later submission in a later import replaces the earlier one as a whole.
    const later = await envelopeText(
      survey,
      bodyFor(survey, 'FIN02', (_l, j) => (j === 0 ? 2 : null), { at: '2026-10-03T09:00:00Z' }),
    );
    const plan3 = await importTexts(next, must(next.surveys[0]), privateKey, [later.text]);
    expect(plan3.replaced).toStrictEqual([
      { receipt: late.receipt, by: later.receipt, memberId: 'FIN02' },
    ]);
    expect(plan3.report.skippedRows).toBe(0);
    next = applyImport(next, plan3, NOW);
    const fin02 = next.ties.filter((t) => t.rater_id === 'FIN02');
    expect(fin02.filter((t) => t.value !== null)).toHaveLength(4);
    expect(fin02.every((t) => t.value === 2 || t.value === null)).toBe(true);
    const log = must(next.surveys[0]).log;
    expect(log.find((e) => e.kind === 'accepted' && e.receipt === late.receipt)).toMatchObject({
      replaced_by: later.receipt,
    });
    expect(surveyStatus(must(next.surveys[0])).responded).toBe(1);
  });

  it('does not overwrite ratings from another source and reports the conflict', async () => {
    const { project, survey, privateKey } = await setup(demoProject(), { entry: 'full' });
    // The demo already has FIN01's ratings (source not recorded).
    const plan = await importTexts(project, survey, privateKey, [
      (
        await envelopeText(
          survey,
          bodyFor(survey, 'FIN01', () => 1),
        )
      ).text,
    ]);
    expect(plan.report.issues.some((i) => i.code === 'duplicate' && i.detail?.existing)).toBe(true);
    expect(plan.ties.length).toBeLessThan(39 * 4);
  });

  it('maps a response to an older version onto the current roster and layers, and reports the rest', async () => {
    const base = demoProject();
    const { key, privateKey } = await createSurveyKey(PASS, FAST);
    const v1 = createSurvey(draftFor(base, { entry: 'full' }), base, key, NOW, 'SURVEYid001');
    // Version 2: one member leaves, one joins, and valence is no longer asked.
    const leaver = must(must(v1.versions[0]).roster[5]);
    const changed: Project = {
      ...base,
      members: [
        ...base.members.filter((m) => m.id !== leaver),
        { id: 'NEW01', display_name: 'Nova Theodolite', attributes: { team: 'Finance' } },
      ],
      ties: [],
    };
    const draft2 = draftFor(changed, { entry: 'full' });
    draft2.layers = draft2.layers.filter((l) => l.key !== 'valence');
    const v2 = updateSurvey(v1, draft2, changed, NOW, 'new');
    expect(v2.versions.map((v) => v.version)).toStrictEqual([1, 2]);
    expect(v2.respondents.find((r) => r.member_id === 'NEW01')?.version).toBe(2);
    expect(v2.respondents.find((r) => r.member_id === 'FIN01')?.version).toBe(1);
    const project = { ...changed, surveys: [v2] };
    const old = await envelopeText(
      v2,
      bodyFor(v2, 'FIN01', () => 3, { version: 1 }),
    );
    const plan = await importTexts(project, v2, privateKey, [old.text]);
    expect(plan.rejected).toStrictEqual([]);
    expect(plan.mapping).toStrictEqual([
      {
        receipt: old.receipt,
        version: 1,
        droppedLayers: ['valence'],
        droppedColleagues: [leaver],
        notAsked: ['NEW01'],
      },
    ]);
    expect(plan.ties).toHaveLength(38 * 3);
    expect(plan.ties.every((t) => t.survey?.version === 1)).toBe(true);
  });

  it('keeps texts in place without a new version', async () => {
    const { project, survey } = await setup();
    const draft = draftFor(project, { texts: { ...survey.texts, introduction: 'Changed.' } });
    const next = updateSurvey(survey, draft, project, NOW);
    expect(next.versions).toHaveLength(1);
    expect(next.texts.introduction).toBe('Changed.');
  });

  it('rejects everything once the survey is closed', async () => {
    const { project, survey, privateKey } = await setup();
    const closed = { ...survey, status: 'closed' as const };
    const plan = await importTexts(project, closed, privateKey, [
      (
        await envelopeText(
          survey,
          bodyFor(survey, 'FIN02', () => 1),
        )
      ).text,
    ]);
    expect(plan.rejected.map((r) => r.reason)).toStrictEqual(['closed']);
  });

  it('reports a file with no readable response', async () => {
    const { project, survey, privateKey } = await setup();
    const plan = await importTexts(project, survey, privateKey, [
      'Just an email with no response.',
    ]);
    expect(plan.rejected).toStrictEqual([
      { source: 'file 1', receipt: null, reason: 'unreadable' },
    ]);
  });
});
