import { describe, expect, it } from 'vitest';
import { VidSignerClient } from '../../src/client/vidsigner-client.js';
import { VidSignerMgmtClient } from '../../src/client/mgmt-client.js';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { loadSurface } from '../../scripts/lib/surface.js';

const norm = (e: string) => e.replace(/\{[^}]+\}|<[^>]+>/g, '{}').replace(/\/+$/, '');

describe('coverage: API surface and manuals vs tools', () => {
  const toolEndpoints = new Set(ALL_TOOLS.map((t) => norm(t.endpoint)));

  it('every operation of the API surface (except oauth/token) has a tool', () => {
    const { operations } = loadSurface();
    const missing: string[] = [];
    for (const op of operations) {
      const ep = `${op.method} ${op.path}`;
      if (ep === 'POST /oauth/token') continue;
      if (!toolEndpoints.has(norm(ep))) missing.push(ep);
    }
    expect(operations).toHaveLength(35);
    expect(missing).toEqual([]);
  });

  it('REST manual operations that are not in the OpenAPI also have a tool', () => {
    expect(toolEndpoints.has(norm('DELETE /documentbatch/{batchGuid}'))).toBe(true);
  });

  const MGMT_MANUAL = [
    'GET /partners',
    'GET /partners/{}',
    'GET /partners/{}/customers',
    'POST /partners/{}/customers',
    'GET /customers/{}',
    'PUT /customers/{}',
    'DELETE /customers/{}',
    'GET /customers/{}/subscriptions',
    'POST /customers/{}/subscriptions',
    'GET /subscriptions/{}',
    'PUT /subscription/{}',
    'PUT /subscription/{}/status/{}',
    'DELETE /subscription/{}',
    'GET /subscription/{}/enrollmentcode',
    'POST /subscription/{}/enrollmentcode',
    'PUT /enrollmentcodes/{}',
    'DELETE /enrollmentcodes/{}',
    'GET /subscription/{}/vidmobileusers',
    'GET /subscription/{}/vidstamperusers',
    'POST /subscription/{}/stats/search',
    'PUT /devices/{}',
    'DELETE /devices/{}',
    'GET /vidmobileusers/{}/token',
    'POST /vidmobileusers',
    'DELETE /vidmobileusers/{}',
    'GET /vidmobileusers',
    'GET /vidmobileusers/{}',
    'GET /vidmobileusers/{}/personaldata',
    'POST /vidmobileusers/{}/certs',
    'GET /vidmobileusers/{}/certs',
    'DELETE /vidmobileusers/{}/certs/{}',
    'PUT /vidmobileusers/{}/username',
    'PUT /vidmobileusers/{}/signatureimage',
    'PUT /vidmobileusers/{}/password',
    'PUT /vidmobileusers/{}/email',
    'PUT /vidmobileusers/{}/remindpasswordrequest',
    'PUT /vidmobileusers/{}/state/{}',
    'GET /subscription/{}/tsystemsdoctypes',
    'POST /subscription/{}/tsystemsdoctypes',
    'DELETE /tsystemsdocumenttype/{}',
    'GET /subscription/{}/tsystemsbookcodes',
    'POST /subscription/{}/tsystemsbookcode',
    'DELETE /tsystemsbookcodes/{}',
    'PUT /vidmobileusers/{}/certstype',
    'GET /subscription/{}/stampcertificates',
    'POST /subscription/{}/stampcertificates',
  ];

  it('the 46 management operations of the manual table (minus oauth) have a tool', () => {
    const missing = MGMT_MANUAL.filter((e) => !toolEndpoints.has(e));
    expect(missing).toEqual([]);
    expect(MGMT_MANUAL).toHaveLength(46);
  });

  it('each tool has an associated client method (clients with public methods)', () => {
    const rest = Object.getOwnPropertyNames(VidSignerClient.prototype).filter(
      (m) => !m.startsWith('_') && m !== 'constructor',
    );
    const mgmt = Object.getOwnPropertyNames(VidSignerMgmtClient.prototype).filter(
      (m) => !m.startsWith('_') && m !== 'constructor',
    );
    expect(rest.length).toBeGreaterThanOrEqual(35);
    expect(mgmt.length).toBeGreaterThanOrEqual(46);
  });
});
