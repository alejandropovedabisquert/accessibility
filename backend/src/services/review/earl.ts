import type { Assertor, EarlMode, ManualFinding, SignOff, SignOffSnapshot } from '../../types/audit.types';

/**
 * Exportacion EARL 1.0 (https://www.w3.org/TR/EARL10-Schema/) en JSON-LD.
 *
 * Una aserción por cada hallazgo no rechazado y por cada violacion de axe que
 * cuenta. Los falsos positivos no salen como aserciones propias: ya quitaron
 * su violacion. El resultado agregado y la firma van en `a11y:`, un vocabulario
 * propio, porque EARL no tiene donde ponerlos.
 */

const CONTEXT = {
  earl: 'http://www.w3.org/ns/earl#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  ptr: 'http://www.w3.org/2009/pointers#',
  WCAG22: 'https://www.w3.org/TR/WCAG22/#',
  a11y: 'urn:accessibility-tool:',
};

const modeOf = (assertor: Assertor): EarlMode =>
  assertor.type === 'tool' ? 'automatic' : assertor.type === 'ai' ? 'semiAuto' : 'manual';

const assertorNode = (assertor: Assertor) =>
  assertor.type === 'human'
    ? { '@type': ['earl:Assertor', 'foaf:Person'], 'foaf:name': assertor.name, ...(assertor.assistiveTech ? { 'a11y:assistiveTech': assertor.assistiveTech } : {}) }
    : {
        '@type': ['earl:Assertor', 'earl:Software'],
        'foaf:name': assertor.name,
        ...(assertor.model ? { 'a11y:model': assertor.model } : {}),
      };

const pointers = (finding: ManualFinding) =>
  finding.targets.map((target) => ({ '@type': 'ptr:CSSSelectorPointer', 'ptr:expression': target.selector }));

export const buildEarl = (signOff: SignOff, snapshot: SignOffSnapshot, axeVersion: string) => {
  const subjects = new Map(
    snapshot.pages.map((page) => [
      page.id,
      {
        '@type': ['earl:TestSubject'],
        'dct:source': page.url,
        ...(page.include ? { 'a11y:include': page.include } : {}),
        ...(page.exclude ? { 'a11y:exclude': page.exclude } : {}),
        ...(page.viewport ? { 'a11y:viewport': `${page.viewport.width}x${page.viewport.height}` } : {}),
        ...(page.device ? { 'a11y:device': page.device } : {}),
        'dct:date': page.finishedAt,
      },
    ]),
  );
  const siteSubject = { '@type': ['earl:TestSubject'], 'dct:title': snapshot.site.name, 'a11y:hosts': snapshot.site.origins };

  const graph = snapshot.criteria.flatMap((criterion) => {
    const test = { '@id': `WCAG22:${criterion.checkId}`, '@type': 'earl:TestRequirement', 'dct:title': `${criterion.criterion} ${criterion.name}` };

    const fromFindings = criterion.findings
      .filter((finding) => finding.review.status !== 'rejected' && finding.source.kind !== 'axe-false-positive')
      .map((finding) => ({
        '@type': 'earl:Assertion',
        'earl:assertedBy': assertorNode(finding.assertedBy),
        'earl:subject': finding.subject.kind === 'page' ? subjects.get(finding.subject.pageId) : siteSubject,
        'earl:test': test,
        'earl:mode': { '@id': `earl:${modeOf(finding.assertedBy)}` },
        'earl:result': {
          '@type': 'earl:TestResult',
          'earl:outcome': { '@id': `earl:${finding.outcome}` },
          'dct:description': finding.description,
          'dct:date': finding.createdAt,
          ...(finding.targets.length > 0 ? { 'earl:pointer': pointers(finding) } : {}),
        },
        'a11y:review': {
          status: finding.review.status,
          by: finding.review.by,
          at: finding.review.at,
          ...(finding.review.note ? { note: finding.review.note } : {}),
        },
      }));

    const fromAxe = Object.entries(criterion.axeViolations).map(([pageId, rules]) => ({
      '@type': 'earl:Assertion',
      'earl:assertedBy': assertorNode({ type: 'tool', name: `axe-core ${axeVersion}`.trim(), model: null, assistiveTech: null }),
      'earl:subject': subjects.get(pageId),
      'earl:test': test,
      'earl:mode': { '@id': 'earl:automatic' },
      'earl:result': {
        '@type': 'earl:TestResult',
        'earl:outcome': { '@id': 'earl:failed' },
        'dct:description': `Reglas de axe incumplidas: ${rules.join(', ')}`,
      },
    }));

    return [...fromAxe, ...fromFindings];
  });

  return {
    '@context': CONTEXT,
    '@id': `a11y:sign-off/${signOff.id}`,
    'dct:title': `Evaluación de accesibilidad de ${snapshot.site.name}`,
    'dct:date': signOff.signedAt,
    'a11y:signOff': {
      signer: signOff.signer,
      credential: signOff.credential,
      signedAt: signOff.signedAt,
      statement: signOff.statement,
      findingsHash: signOff.findingsHash,
      catalog: snapshot.catalog,
      conformance: snapshot.conformance,
      wcag22: snapshot.wcag22,
      ...(snapshot.aaa ? { aaa: snapshot.aaa } : {}),
      criteria: snapshot.criteria.map((criterion) => ({
        test: `WCAG22:${criterion.checkId}`,
        criterion: criterion.criterion,
        level: criterion.level,
        legal: criterion.legal,
        outcome: `earl:${criterion.outcome}`,
      })),
    },
    '@graph': graph,
  };
};
