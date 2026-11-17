import { describe, expect, it } from 'vitest';
import { RecipientPolicy } from '../../src/tools/recipient-policy.js';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';

const rules = (over: Partial<ConstructorParameters<typeof RecipientPolicy>[0]> = {}) =>
  new RecipientPolicy({
    emailDomains: ['example.com', '*.example.com'],
    phonePrefixes: ['+34'],
    notificationHosts: ['hooks.example.com'],
    assetHosts: [],
    ...over,
  });

describe('RecipientPolicy', () => {
  it('without lists it restricts nothing', () => {
    const p = new RecipientPolicy();
    expect(p.restricted).toBe(false);
    expect(() =>
      p.assertBody({
        SignedDocumentRecipients: [{ Email: 'x@evil.com' }],
        NotificationURL: 'https://evil.com/h',
      }),
    ).not.toThrow();
  });

  it('accepts exact domains and wildcard subdomains; rejects the rest', () => {
    const p = rules();
    expect(() => p.assertEmail('a@example.com', 'Email')).not.toThrow();
    expect(() => p.assertEmail('A@EXAMPLE.COM', 'Email')).not.toThrow();
    expect(() => p.assertEmail('a@hr.example.com', 'Email')).not.toThrow();
    expect(() => p.assertEmail('a@evil.com', 'Email')).toThrow(/VIDSIGNER_ALLOWED_EMAIL_DOMAINS/);
    expect(() => p.assertEmail('a@example.com.evil.com', 'Email')).toThrow();
    expect(() => p.assertEmail('a@notexample.com', 'Email')).toThrow();
    expect(() => p.assertEmail('no-at-sign', 'Email')).toThrow();
  });

  it('phones by prefix', () => {
    const p = rules();
    expect(() => p.assertPhone('+34 600 000 000', 'PhoneNumber')).not.toThrow();
    expect(() => p.assertPhone('+34600000000', 'PhoneNumber')).not.toThrow();
    expect(() => p.assertPhone('+44700000000', 'PhoneNumber')).toThrow(
      /VIDSIGNER_ALLOWED_PHONE_PREFIXES/,
    );
    expect(() => p.assertPhone('600000000', 'PhoneNumber')).toThrow();
  });

  it('NotificationURL hosts, with trailing dot and uppercase', () => {
    const p = rules();
    expect(() => p.assertUrl('https://hooks.example.com/hooks', 'NotificationURL')).not.toThrow();
    expect(() => p.assertUrl('https://HOOKS.example.com./hooks', 'NotificationURL')).not.toThrow();
    expect(() => p.assertUrl('https://evil.com/hooks', 'NotificationURL')).toThrow(
      /VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS/,
    );
    expect(() => p.assertUrl('https://hooks.example.com.evil.com/', 'NotificationURL')).toThrow();
    expect(() => p.assertUrl('not-a-url', 'NotificationURL')).toThrow(/URL/);
  });

  it('assertBody checks nested recipients, signers, phones and URLs', () => {
    const p = rules();
    const ok = {
      NotificationURL: 'https://hooks.example.com/h',
      SignedDocumentRecipients: [{ Email: 'a@example.com' }],
      RejectedDocumentRecipients: [{ eMail: 'b@example.com' }],
      SignersGroups: [{ Signers: [{ Email: 'c@example.com', PhoneNumber: '+34600000000' }] }],
    };
    expect(() => p.assertBody(ok)).not.toThrow();
    const bad = (mutate: (b: typeof ok) => void) => {
      const b = structuredClone(ok);
      mutate(b);
      return () => p.assertBody(b);
    };
    expect(bad((b) => (b.SignedDocumentRecipients[0]!.Email = 'x@evil.com'))).toThrow(
      /SignedDocumentRecipients\[0\]\.Email/,
    );
    expect(bad((b) => (b.RejectedDocumentRecipients[0] = { eMail: 'x@evil.com' }))).toThrow(
      /RejectedDocumentRecipients\[0\]\.eMail/,
    );
    expect(bad((b) => (b.SignersGroups[0]!.Signers[0]!.Email = 'x@evil.com'))).toThrow(
      /SignersGroups\[0\]\.Signers\[0\]\.Email/,
    );
    expect(bad((b) => (b.SignersGroups[0]!.Signers[0]!.PhoneNumber = '+1555'))).toThrow(
      /PhoneNumber/,
    );
    expect(bad((b) => (b.NotificationURL = 'https://evil.com/h'))).toThrow(/NotificationURL/);
  });

  it('checks NotificationEmails and RecipientEmailAddress (e-delivery)', () => {
    const p = rules();
    expect(() =>
      p.assertBody({
        RecipientEmailAddress: 'a@example.com',
        NotificationEmails: ['b@example.com'],
      }),
    ).not.toThrow();
    expect(() =>
      p.assertBody({ RecipientEmailAddress: 'a@example.com', NotificationEmails: ['x@evil.com'] }),
    ).toThrow(/NotificationEmails\[0\]/);
  });
});

describe('MCP: the recipient policy is applied before calling the API', () => {
  const jwt = { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'cs' };
  const mk = () =>
    mockFetch((c) =>
      c.url.endsWith('/oauth/token') ? token('T') : json(200, { DocGUI: 'd1', GUID: 'e1' }),
    );

  it('create_document rejects a recipient outside the list and sends nothing', async () => {
    const m = mk();
    const h = await startHarness({
      env: { ...jwt, VIDSIGNER_ALLOWED_EMAIL_DOMAINS: 'example.com' },
      fetch: m.fetch,
    });
    const path = `${h.inputDir}/a.pdf`;
    (await import('node:fs')).writeFileSync(path, '%PDF-1.4 x');
    const r = await h.call('vidsigner_create_document', {
      filePath: path,
      IssuerName: 'Acme',
      SignersGroups: [{ Signers: [{ SignatureType: 'bio', DeviceName: 'tab' }] }],
      SignedDocumentRecipients: [{ Email: 'attacker@evil.com' }],
    });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'validation' });
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });

  it('create_document rejects a logo outside VIDSIGNER_ALLOWED_ASSET_HOSTS', async () => {
    const m = mk();
    const h = await startHarness({
      env: { ...jwt, VIDSIGNER_ALLOWED_ASSET_HOSTS: 'cdn.example.com' },
      fetch: m.fetch,
    });
    const path = `${h.inputDir}/a.pdf`;
    (await import('node:fs')).writeFileSync(path, '%PDF-1.4 x');
    const call = (logo: string, corporate: string) =>
      h.call('vidsigner_create_document', {
        filePath: path,
        IssuerName: 'Acme',
        SignersGroups: [{ Signers: [{ SignatureType: 'bio', DeviceName: 'tab' }] }],
        Appearance: { APP: { Logo: logo }, EmailNotification: { CorporateLogo: corporate } },
      });
    const badLogo = await call('https://evil.com/l.png', 'https://cdn.example.com/l.png');
    expect(badLogo.isError).toBe(true);
    expect(badLogo.text).toMatch(/VIDSIGNER_ALLOWED_ASSET_HOSTS/);
    const badCorp = await call('https://cdn.example.com/l.png', 'https://evil.com/l.png');
    expect(badCorp.isError).toBe(true);
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
    const ok = await call('https://cdn.example.com/l.png', 'https://cdn.example.com/c.png');
    expect(ok.isError).toBe(false);
  });

  it('create_customer and update_customer validate CustomerEmail and CustomerURL', async () => {
    const m = mk();
    const h = await startHarness({
      env: {
        ...jwt,
        VIDSIGNER_ENABLE_MGMT: 'true',
        VIDSIGNER_MGMT_PARTNER_USER: 'p',
        VIDSIGNER_MGMT_PARTNER_PASS: 'pp',
        VIDSIGNER_ALLOWED_EMAIL_DOMAINS: 'example.com',
        VIDSIGNER_ALLOWED_ASSET_HOSTS: 'www.example.com',
      },
      fetch: m.fetch,
    });
    const customer = {
      CustomerName: 'Acme',
      CustomerLegalId: 'B12345678',
      Address: '1 Main Street',
      City: 'Springfield',
      State: 'Springfield',
      PostalCode: '12345',
      Country: 'US',
      CustomerURL: 'https://www.example.com',
    };
    for (const [tool, extra] of [
      ['vidsigner_mgmt_create_customer', { partnerGuid: 'p1' }],
      ['vidsigner_mgmt_update_customer', { customerGuid: 'c1' }],
    ] as const) {
      const badMail = await h.call(tool, { ...extra, ...customer, CustomerEmail: 'a@evil.com' });
      expect(badMail.isError, tool).toBe(true);
      expect(badMail.text).toMatch(/CustomerEmail/);
      const multi = await h.call(tool, {
        ...extra,
        ...customer,
        CustomerEmail: 'a@example.com,b@evil.com',
      });
      expect(multi.isError, tool).toBe(true);
      const badUrl = await h.call(tool, {
        ...extra,
        ...customer,
        CustomerEmail: 'a@example.com',
        CustomerURL: 'https://evil.com',
      });
      expect(badUrl.isError, tool).toBe(true);
      expect(badUrl.text).toMatch(/CustomerURL/);
      const ok = await h.call(tool, { ...extra, ...customer, CustomerEmail: 'a@example.com' });
      expect(ok.isError, tool).toBe(false);
    }
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(2);
  });

  it('send_signature_url and reminder resends validate the destination', async () => {
    const m = mk();
    const h = await startHarness({
      env: { ...jwt, VIDSIGNER_ALLOWED_EMAIL_DOMAINS: 'example.com' },
      fetch: m.fetch,
    });
    const bad = await h.call('vidsigner_send_signature_url', {
      signerGuid: 's1',
      Channel: 'email',
      Destination: 'x@evil.com',
    });
    expect(bad.isError).toBe(true);
    const ok = await h.call('vidsigner_send_signature_url', {
      signerGuid: 's1',
      Channel: 'email',
      Destination: 'x@example.com',
    });
    expect(ok.isError).toBe(false);
  });
});

describe('RecipientPolicy: format of a single address or number', () => {
  const withList = rules();
  const noList = new RecipientPolicy();

  const multiEmail = [
    'a@evil.com;b@example.com',
    'b@example.com;a@evil.com',
    'a@evil.com,b@example.com',
    'a@evil.com b@example.com',
    'a@evil.com\nb@example.com',
    'a@evil.com\tb@example.com',
    '"a@evil.com"@example.com',
    'Evil <a@evil.com>@example.com',
    'a@evil.com<b@example.com>',
    'a@example.com@evil.com',
    'a@@example.com',
    '@example.com',
    'a@',
    'a@example.com\u0000.evil.com',
  ];

  it.each(multiEmail)('rejects multiple addresses or ambiguous forms with a list: %j', (v) => {
    expect(() => withList.assertEmail(v, 'Email')).toThrow(/single email address/);
  });

  it.each(multiEmail)('rejects multiple addresses or ambiguous forms WITHOUT a list: %j', (v) => {
    expect(() => noList.assertEmail(v, 'Email')).toThrow(/single email address/);
  });

  it('without a list it accepts a normal address and rejects what is not an address', () => {
    expect(() => noList.assertEmail('someone@anything.example.com', 'Email')).not.toThrow();
    expect(() => noList.assertEmail('no-at-sign', 'Email')).toThrow();
    expect(() => noList.assertEmail(123, 'Email')).toThrow();
  });

  const multiPhone = [
    '+34600111222,+1555000111',
    '+34600111222;+1555000111',
    '+1555000111;+34600111222',
    '+34600111222 +1555000111',
    '+34600111222\n+1555000111',
    '+346001112221+15551234',
    '+34600111222+1555000111',
    '+34-600-111-222,+1555000111',
    '+34600111222abc',
    '+3460011122233333333',
    '+34 12',
    '+',
    '++34600111222',
  ];

  it.each(multiPhone)('rejects multiple numbers or ambiguous forms with a list: %j', (v) => {
    expect(() => withList.assertPhone(v, 'PhoneNumber')).toThrow(/single phone number/);
  });

  it.each(multiPhone)('rejects multiple numbers or ambiguous forms WITHOUT a list: %j', (v) => {
    expect(() => noList.assertPhone(v, 'PhoneNumber')).toThrow(/single phone number/);
  });

  it('accepts a single number with visual separators (space, hyphen, dot, parentheses)', () => {
    for (const ok of [
      '+34600111222',
      '+34 600 111 222',
      '+34-600-111-222',
      '+34.600.111.222',
      '+34 (600) 111 222',
      '600111222',
    ]) {
      expect(() => noList.assertPhone(ok, 'PhoneNumber'), ok).not.toThrow();
    }
    expect(() => withList.assertPhone('+34 (600) 111 222', 'PhoneNumber')).not.toThrow();
    expect(() => withList.assertPhone('600111222', 'PhoneNumber')).toThrow(/PHONE_PREFIXES/);
  });

  it('assertBody validates the format even without lists', () => {
    expect(() =>
      noList.assertBody({
        SignersGroups: [{ Signers: [{ Email: 'a@example.org;b@example.net' }] }],
      }),
    ).toThrow(/single email address/);
    expect(() =>
      noList.assertBody({ SignersGroups: [{ Signers: [{ PhoneNumber: '+34600111222,+1555' }] }] }),
    ).toThrow(/single phone number/);
    expect(() =>
      noList.assertBody({ NotificationEmails: ['a@example.org', 'b@example.net,c@example.edu'] }),
    ).toThrow(/single email address/);
  });
});

describe('RecipientPolicy: empty values count as absent', () => {
  const p = rules();
  it("'' and whitespace are not validated: the manual allows an empty phone with AllowEmptyPhoneNumber", () => {
    expect(() => p.assertPhone('', 'PhoneNumber')).not.toThrow();
    expect(() => p.assertPhone('   ', 'PhoneNumber')).not.toThrow();
    expect(() => p.assertEmail('', 'Email')).not.toThrow();
    expect(() => p.assertEmail('  ', 'Email')).not.toThrow();
    expect(() =>
      p.assertBody({ SignersGroups: [{ Signers: [{ Email: '', PhoneNumber: '' }] }] }),
    ).not.toThrow();
  });

  it('null and undefined too', () => {
    expect(() => p.assertEmail(null, 'Email')).not.toThrow();
    expect(() => p.assertPhone(undefined, 'PhoneNumber')).not.toThrow();
  });
});

describe('RecipientPolicy: resource URLs and customer data', () => {
  const p = rules({ assetHosts: ['cdn.example.com', '*.static.example.com'] });

  it('Logo (App and APP) and CorporateLogo go through VIDSIGNER_ALLOWED_ASSET_HOSTS', () => {
    const ok = 'https://cdn.example.com/logo.png';
    const bad = 'https://evil.com/logo.png';
    for (const key of ['APP', 'App']) {
      expect(() => p.assertBody({ Appearance: { [key]: { Logo: ok } } })).not.toThrow();
      expect(() => p.assertBody({ Appearance: { [key]: { Logo: bad } } })).toThrow(
        /VIDSIGNER_ALLOWED_ASSET_HOSTS/,
      );
    }
    expect(() =>
      p.assertBody({ Appearance: { EmailNotification: { CorporateLogo: ok } } }),
    ).not.toThrow();
    expect(() =>
      p.assertBody({ Appearance: { EmailNotification: { CorporateLogo: bad } } }),
    ).toThrow(/VIDSIGNER_ALLOWED_ASSET_HOSTS/);
  });

  it('accepts wildcard subdomains and rejects look-alike hosts', () => {
    expect(() => p.assertAssetUrl('https://a.static.example.com/x.png', 'Logo')).not.toThrow();
    expect(() => p.assertAssetUrl('https://cdn.example.com.evil.com/x.png', 'Logo')).toThrow();
    expect(() => p.assertAssetUrl('https://cdn.example.com@evil.com/x.png', 'Logo')).toThrow();
    expect(() => p.assertAssetUrl('not-a-url', 'Logo')).toThrow(/URL/);
  });

  it('is a separate list from the notification one', () => {
    // hooks.example.com is in the notification list, not in the assets list.
    expect(() => p.assertUrl('https://hooks.example.com/h', 'NotificationURL')).not.toThrow();
    expect(() => p.assertAssetUrl('https://hooks.example.com/logo.png', 'Logo')).toThrow();
    expect(() => p.assertUrl('https://cdn.example.com/h', 'NotificationURL')).toThrow();
  });

  it('without an assets list it restricts nothing; n/a and empty count as absent', () => {
    const none = rules();
    expect(() =>
      none.assertBody({ Appearance: { APP: { Logo: 'https://evil.com/l.png' } } }),
    ).not.toThrow();
    expect(() => p.assertAssetUrl('n/a', 'CustomerURL')).not.toThrow();
    expect(() => p.assertAssetUrl('', 'CustomerURL')).not.toThrow();
    expect(() => p.assertBody({ Appearance: { APP: { Logo: null } } })).not.toThrow();
  });

  it('assertBody checks CustomerEmail and CustomerURL', () => {
    const q = rules({ assetHosts: ['www.example.com'] });
    expect(() =>
      q.assertBody({ CustomerEmail: 'a@example.com', CustomerURL: 'https://www.example.com' }),
    ).not.toThrow();
    expect(() => q.assertBody({ CustomerEmail: 'a@evil.com' })).toThrow(/EMAIL_DOMAINS/);
    expect(() => q.assertBody({ CustomerURL: 'https://evil.com' })).toThrow(/ASSET_HOSTS/);
    expect(() => q.assertBody({ CustomerEmail: 'a@example.com,b@evil.com' })).toThrow(
      /single email address/,
    );
  });
});
