import { describe, expect, it } from 'vitest';
import type { SecurityConfig } from '../../src/config.js';
import { ALL_TOOLS, MGMT_TOOLS, REST_TOOLS, selectTools } from '../../src/tools/index.js';
import { evaluatePolicy, type Risk, type ToolApi } from '../../src/tools/policy.js';

const sec = (over: Partial<SecurityConfig> = {}): SecurityConfig => ({
  environment: 'pro',
  allowWrite: false,
  allowDestructive: false,
  allowMarkDownloaded: false,
  allowSigningLinks: false,
  allowCredentialReads: false,
  enableMgmt: false,
  ...over,
});
const tool = (risk: Risk, api: ToolApi = 'rest') => ({ name: 't', risk, api });

describe('evaluatePolicy: gate matrix', () => {
  it.each<[string, Risk, Partial<SecurityConfig>, boolean]>([
    ['read always', 'read', {}, true],
    ['write denied by default', 'write', {}, false],
    ['write with ALLOW_WRITE', 'write', { allowWrite: true }, true],
    ['destructive with nothing', 'destructive', {}, false],
    ['destructive with WRITE only', 'destructive', { allowWrite: true }, false],
    ['destructive with DESTRUCTIVE only', 'destructive', { allowDestructive: true }, false],
    ['destructive with both', 'destructive', { allowWrite: true, allowDestructive: true }, true],
    ['sensitive read denied by default', 'sensitive_read', {}, false],
    ['sensitive read with its flag', 'sensitive_read', { allowSigningLinks: true }, true],
    [
      'sensitive read is NOT enabled by WRITE or MARK_DOWNLOADED',
      'sensitive_read',
      { allowWrite: true, allowDestructive: true, allowMarkDownloaded: true },
      false,
    ],
    ['credential denied by default', 'credential_read', {}, false],
    ['credential with its flag', 'credential_read', { allowCredentialReads: true }, true],
    [
      'credential is NOT enabled by SIGNING_LINKS or WRITE',
      'credential_read',
      { allowSigningLinks: true, allowWrite: true, allowDestructive: true },
      false,
    ],
    [
      'the signing link is NOT enabled by CREDENTIAL_READS',
      'sensitive_read',
      { allowCredentialReads: true },
      false,
    ],
    ['mark-downloaded denied by default', 'mark_downloaded', {}, false],
    ['mark-downloaded with its flag', 'mark_downloaded', { allowMarkDownloaded: true }, true],
    [
      'mark-downloaded is NOT enabled by WRITE',
      'mark_downloaded',
      { allowWrite: true, allowDestructive: true },
      false,
    ],
  ])('%s', (_label, risk, over, expected) => {
    expect(evaluatePolicy(tool(risk), sec(over)).enabled).toBe(expected);
  });

  it('a management tool requires ENABLE_MGMT in addition to its own risk', () => {
    expect(evaluatePolicy(tool('read', 'mgmt'), sec()).enabled).toBe(false);
    expect(evaluatePolicy(tool('read', 'mgmt'), sec()).enableWith).toBe(
      'VIDSIGNER_ENABLE_MGMT=true',
    );
    expect(evaluatePolicy(tool('read', 'mgmt'), sec({ enableMgmt: true })).enabled).toBe(true);
    expect(evaluatePolicy(tool('write', 'mgmt'), sec({ enableMgmt: true })).enabled).toBe(false);
    expect(
      evaluatePolicy(tool('write', 'mgmt'), sec({ enableMgmt: true, allowWrite: true })).enabled,
    ).toBe(true);
  });

  it('reports which variable would enable each denied tool', () => {
    expect(evaluatePolicy(tool('write'), sec()).enableWith).toBe('VIDSIGNER_ALLOW_WRITE=true');
    expect(evaluatePolicy(tool('destructive'), sec({ allowWrite: true })).enableWith).toBe(
      'VIDSIGNER_ALLOW_DESTRUCTIVE=true',
    );
    expect(evaluatePolicy(tool('mark_downloaded'), sec()).enableWith).toBe(
      'VIDSIGNER_ALLOW_MARK_DOWNLOADED=true',
    );
    expect(evaluatePolicy(tool('sensitive_read'), sec()).enableWith).toBe(
      'VIDSIGNER_ALLOW_SIGNING_LINKS=true',
    );
    expect(evaluatePolicy(tool('credential_read'), sec()).enableWith).toBe(
      'VIDSIGNER_ALLOW_CREDENTIAL_READS=true',
    );
  });
});

describe('selectTools over the real catalog', () => {
  const names = (s: SecurityConfig) => selectTools(s).enabled.map((t) => t.name);

  it('catalog: 35 REST tools + 46 management tools, no duplicate names', () => {
    expect(REST_TOOLS).toHaveLength(35);
    expect(MGMT_TOOLS).toHaveLength(46);
    expect(new Set(ALL_TOOLS.map((t) => t.name)).size).toBe(ALL_TOOLS.length);
    expect(
      REST_TOOLS.every(
        (t) => t.name.startsWith('vidsigner_') && !t.name.startsWith('vidsigner_mgmt_'),
      ),
    ).toBe(true);
    expect(MGMT_TOOLS.every((t) => t.name.startsWith('vidsigner_mgmt_'))).toBe(true);
  });

  it('pro by default: ONLY REST reads (GET and POST searches), nothing else', () => {
    const enabled = selectTools(sec()).enabled;
    expect(enabled.every((t) => t.risk === 'read' && t.api === 'rest')).toBe(true);
    const n = names(sec());
    expect(n).toContain('vidsigner_search');
    expect(n).toContain('vidsigner_search_edeliveries');
    // GET /documents/{id} marks a SIGNED document as downloaded (verified in pre): not a pure read.
    expect(n).not.toContain('vidsigner_get_document');
    expect(n).toContain('vidsigner_list_documents');
    expect(n).not.toContain('vidsigner_create_document');
    expect(n).not.toContain('vidsigner_download_signed_document');
    expect(n).not.toContain('vidsigner_delete_document');
    expect(n.some((x) => x.startsWith('vidsigner_mgmt_'))).toBe(false);
  });

  it('pro + WRITE: writes appear but NO destructive tool and not the one that marks as downloaded', () => {
    const enabled = selectTools(sec({ allowWrite: true })).enabled;
    expect(enabled.some((t) => t.risk === 'write')).toBe(true);
    expect(enabled.some((t) => t.risk === 'destructive')).toBe(false);
    expect(enabled.some((t) => t.risk === 'mark_downloaded')).toBe(false);
  });

  it('pro + WRITE + DESTRUCTIVE: DELETE and expire tools appear', () => {
    const n = names(sec({ allowWrite: true, allowDestructive: true }));
    for (const x of [
      'vidsigner_delete_document',
      'vidsigner_delete_signed_document',
      'vidsigner_expire_document',
      'vidsigner_delete_edelivery',
      'vidsigner_delete_batch',
    ]) {
      expect(n).toContain(x);
    }
    expect(n).not.toContain('vidsigner_download_signed_document');
  });

  it('download_signed_document only with ALLOW_MARK_DOWNLOADED in pro', () => {
    expect(names(sec())).not.toContain('vidsigner_download_signed_document');
    expect(names(sec({ allowMarkDownloaded: true }))).toContain(
      'vidsigner_download_signed_document',
    );
  });

  it('management tools only with ENABLE_MGMT; their DELETEs additionally need DESTRUCTIVE', () => {
    expect(
      names(sec({ enableMgmt: true }))
        .filter((x) => x.startsWith('vidsigner_mgmt_'))
        .every((x) => /list|get|search/.test(x)),
    ).toBe(true);
    const full = names(
      sec({
        enableMgmt: true,
        allowWrite: true,
        allowDestructive: true,
        allowSigningLinks: true,
        allowCredentialReads: true,
      }),
    );
    expect(full.filter((x) => x.startsWith('vidsigner_mgmt_'))).toHaveLength(46);
    expect(full).toContain('vidsigner_mgmt_delete_customer');
  });

  it('pre by default: reads + writes + mark-downloaded, no destructive or management tools', () => {
    const pre = sec({ environment: 'pre', allowWrite: true, allowMarkDownloaded: true });
    const n = names(pre);
    expect(n).toContain('vidsigner_create_document');
    expect(n).toContain('vidsigner_download_signed_document');
    expect(n).not.toContain('vidsigner_delete_document');
    expect(n.some((x) => x.startsWith('vidsigner_mgmt_'))).toBe(false);
  });

  it('all read tools are query-only POST/GET: none has delete/update/create in its name', () => {
    for (const t of ALL_TOOLS.filter((x) => x.risk === 'read')) {
      expect(t.name, t.name).not.toMatch(
        /_(create|delete|update|send|add|set|expire|close|sign_xml)/,
      );
    }
  });

  it('every DELETE and expire is marked as destructive', () => {
    for (const t of ALL_TOOLS) {
      if (/^DELETE /.test(t.endpoint) || /\/expire$/.test(t.endpoint))
        expect(t.risk, t.name).toBe('destructive');
    }
  });

  it('the signing link is a sensitive read and the token and enrollment codes are credential reads', () => {
    const links = ALL_TOOLS.filter((t) => t.risk === 'sensitive_read');
    expect(links.map((t) => t.name)).toEqual(['vidsigner_get_signature_url']);
    const creds = ALL_TOOLS.filter((t) => t.risk === 'credential_read');
    expect(creds.map((t) => t.name).sort()).toEqual([
      'vidsigner_mgmt_get_vidmobile_user_token',
      'vidsigner_mgmt_list_enrollment_codes',
    ]);
    // Off in pro; each one only with its own flag.
    expect(names(sec({ enableMgmt: true }))).not.toContain(
      'vidsigner_mgmt_get_vidmobile_user_token',
    );
    expect(names(sec({ enableMgmt: true }))).not.toContain('vidsigner_mgmt_list_enrollment_codes');
    expect(names(sec({ enableMgmt: true, allowSigningLinks: true }))).not.toContain(
      'vidsigner_mgmt_get_vidmobile_user_token',
    );
    expect(names(sec({ enableMgmt: true, allowCredentialReads: true }))).toEqual(
      expect.arrayContaining([
        'vidsigner_mgmt_get_vidmobile_user_token',
        'vidsigner_mgmt_list_enrollment_codes',
      ]),
    );
    expect(names(sec())).not.toContain('vidsigner_get_signature_url');
    expect(names(sec({ allowCredentialReads: true }))).not.toContain('vidsigner_get_signature_url');
    expect(names(sec({ allowSigningLinks: true }))).toContain('vidsigner_get_signature_url');
    expect(names(sec({ environment: 'pre', allowWrite: true }))).not.toContain(
      'vidsigner_get_signature_url',
    );
  });

  it('GET /signeddocuments/{id} and GET /documents/{id} are the mark_downloaded tools (the second marks signed documents, verified in pre)', () => {
    const marks = ALL_TOOLS.filter((t) => t.risk === 'mark_downloaded');
    expect(marks.map((t) => t.endpoint).sort()).toEqual([
      'GET /documents/{id}',
      'GET /signeddocuments/{id}',
    ]);
    for (const m of marks) expect(m.description).toMatch(/MARKS? (THE DOCUMENT )?AS DOWNLOADED/i);
  });
});
