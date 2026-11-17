import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RecipientPolicy } from '../../src/tools/recipient-policy.js';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';

const rules = (over: Partial<ConstructorParameters<typeof RecipientPolicy>[0]> = {}) =>
  new RecipientPolicy({
    emailDomains: ['example.com'],
    phonePrefixes: ['+34'],
    notificationHosts: ['hooks.example.com'],
    assetHosts: ['cdn.example.com'],
    ...over,
  });

const MGMT_ENV = {
  VIDSIGNER_ENABLE_MGMT: 'true',
  VIDSIGNER_ALLOW_DESTRUCTIVE: 'true',
  VIDSIGNER_CLIENT_ID: 'cid',
  VIDSIGNER_CLIENT_SECRET: 'csecret-xyz',
  VIDSIGNER_MGMT_PARTNER_USER: 'padmin',
  VIDSIGNER_MGMT_PARTNER_PASS: 'partner-pass-1',
};

describe('the required email does not accept empty or "null"', () => {
  const absent = ['', '   ', 'null', ' NULL ', 'Null', null, undefined];

  it.each(absent)('assertRequiredEmail rejects %j (with and without lists)', (v) => {
    expect(() => rules().assertRequiredEmail(v, 'email')).toThrow(/is required/);
    expect(() => new RecipientPolicy().assertRequiredEmail(v, 'email')).toThrow(/is required/);
  });

  it.each(['', 'null', ' NULL '])('assertOptionalEmail rejects the present value %j', (v) => {
    expect(() => new RecipientPolicy().assertOptionalEmail(v, 'CustomerEmail')).toThrow(
      /is required/,
    );
  });

  it('assertOptionalEmail accepts undefined and validates a present value', () => {
    const p = rules();
    expect(p.assertOptionalEmail(undefined, 'CustomerEmail')).toBeUndefined();
    expect(p.assertOptionalEmail(' a@example.com ', 'CustomerEmail')).toBe('a@example.com');
    expect(() => p.assertOptionalEmail('a@evil.com', 'CustomerEmail')).toThrow(/EMAIL_DOMAINS/);
  });

  it('the email of the SIGNER still accepts null, empty and "null" (manual 14.5)', () => {
    const p = rules();
    for (const email of [null, '', 'null', ' NULL ']) {
      expect(() =>
        p.assertBody({ SignersGroups: [{ Signers: [{ Email: email, eMail: email }] }] }),
      ).not.toThrow();
    }
    expect(() => p.assertBody({ SignersGroups: [{ Signers: [{ Email: 'a@evil.com' }] }] })).toThrow(
      /EMAIL_DOMAINS/,
    );
  });

  it.each([
    ['SignedDocumentRecipients', { SignedDocumentRecipients: [{ Email: 'null' }] }],
    ['SignedDocumentRecipients', { SignedDocumentRecipients: [{ eMail: '' }] }],
    ['RejectedDocumentRecipients', { RejectedDocumentRecipients: [{ Email: ' NULL ' }] }],
    ['RecipientEmailAddress', { RecipientEmailAddress: 'null' }],
    ['RecipientEmailAddress', { RecipientEmailAddress: '' }],
    ['NotificationEmails', { NotificationEmails: ['a@example.com', 'null'] }],
    ['EmailStatusNotification', { NotificationConfig: { EmailStatusNotification: [''] } }],
    ['CustomerEmail', { CustomerEmail: 'null' }],
  ])('assertBody rejects empty or "null" in %s', (field, body) => {
    expect(() => new RecipientPolicy().assertBody(body)).toThrow(new RegExp(field));
  });

  it('assertBody does not require the presence of optional fields', () => {
    expect(() =>
      rules().assertBody({ CustomerEmail: undefined, NotificationEmails: [] }),
    ).not.toThrow();
  });

  it('the destination of an email resend is required; for SMS it is validated as a phone', () => {
    const p = rules();
    expect(() => p.assertChannelDestination('email', 'null')).toThrow(/is required/);
    expect(() => p.assertChannelDestination('email', '')).toThrow(/is required/);
    expect(p.assertChannelDestination('email', undefined)).toBeUndefined();
    expect(p.assertChannelDestination('sms', '+34 600 111 222')).toBe('+34600111222');
  });

  it('MCP: update_vidmobile_user_email with "null" does not reach the API', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    for (const email of ['null', ' NULL ', '']) {
      const r = await h.call('vidsigner_mgmt_update_vidmobile_user_email', {
        legalId: '12345678Z',
        email,
      });
      expect(r.isError, email).toBe(true);
      expect(r.text).toMatch(/is required/);
    }
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });

  it('MCP: create_vidmobile_user with email "null" does not reach the API', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_create_vidmobile_user', {
      userid: 'u1',
      username: 'User',
      legalid: '12345678Z',
      email: 'null',
      password: 'Secret1234#',
      skipEnrollEmail: true,
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/is required/);
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });

  it('MCP: update_signer_data with an email of "null" or empty does not reach the API', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({
      env: { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'cs' },
      fetch: m.fetch,
    });
    for (const email of ['null', '']) {
      const r = await h.call('vidsigner_update_signer_data', { signerGuid: 's1', email });
      expect(r.isError, email).toBe(true);
    }
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });
});

describe('S-a: URLs require https, with no username and no backslash', () => {
  const bad = [
    'http://hooks.example.com/h',
    'ftp://hooks.example.com/h',
    'https://user:pass@hooks.example.com/h',
    'https://user@hooks.example.com/h',
    'https://hooks.example.com\\@evil.com/h',
    'https://evil.com\\.hooks.example.com/h',
    'javascript:alert(1)',
  ];

  it.each(bad)('assertUrl with a list rejects %j', (v) => {
    expect(() => rules().assertUrl(v, 'NotificationURL')).toThrow(/NotificationURL/);
  });

  it.each(bad)(
    'assertUrl WITHOUT a list also rejects %j (NotificationURL is always validated)',
    (v) => {
      expect(() => new RecipientPolicy().assertUrl(v, 'NotificationURL')).toThrow(
        /NotificationURL/,
      );
    },
  );

  it('without a list it accepts any https host and rejects the rest', () => {
    const p = new RecipientPolicy();
    expect(() => p.assertUrl('https://anyhost.example/hook', 'NotificationURL')).not.toThrow();
    expect(() => p.assertUrl('not-a-url', 'NotificationURL')).toThrow(/URL/);
    expect(() => p.assertUrl(undefined, 'NotificationURL')).not.toThrow();
  });

  it.each(bad)('assertAssetUrl with a list rejects %j', (v) => {
    expect(() => rules().assertAssetUrl(v.replace('hooks', 'cdn'), 'Logo')).toThrow(/Logo/);
  });

  it('assertAssetUrl without a list does not restrict (logos may be http in tests)', () => {
    expect(() => new RecipientPolicy().assertAssetUrl('http://x.test/l.png', 'Logo')).not.toThrow();
  });

  it('http://localhost only with allowLocalHosts (VIDSIGNER_ALLOW_LOCAL_HOSTS=true in pre)', () => {
    const local = 'http://localhost:3000/hook';
    expect(() => rules().assertUrl(local, 'NotificationURL')).toThrow(/https/);
    expect(() => new RecipientPolicy().assertUrl(local, 'NotificationURL')).toThrow(/https/);
    const allowed = rules({ allowLocalHosts: true });
    expect(() => allowed.assertUrl(local, 'NotificationURL')).not.toThrow();
    expect(() => allowed.assertUrl('http://127.0.0.1:8080/h', 'NotificationURL')).not.toThrow();
    // It does not open other hosts over http nor localhost with credentials.
    expect(() => allowed.assertUrl('http://evil.com/h', 'NotificationURL')).toThrow(/https/);
    expect(() => allowed.assertUrl('http://u:p@localhost/h', 'NotificationURL')).toThrow(
      /username/,
    );
  });

  it('MCP: create_subscription rejects an http NotificationURL even when there are no lists', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_update_subscription', {
      subscriptionGuid: 's1',
      SubscriptionName: 'Subscription-1',
      NotificationURL: 'http://hook.example/h',
      Active: true,
      SignatureChannels: {
        BIO: { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0, DevicesLimit: 0 },
        Remote: { Enabled: true, SignaturesLimit: 10, SignaturesLimitPeriod: 12 },
        ViDMobile: {
          Enabled: false,
          Domain: '',
          SignaturesLimit: 0,
          SignaturesLimitPeriod: 0,
          UsersLimit: 0,
        },
        Stamper: {
          Enabled: false,
          SignaturesLimit: 0,
          SignaturesLimitPeriod: 0,
          CertificatesLimit: 0,
        },
      },
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/https/);
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });
});

describe('S-b: the trimmed, validated value is sent', () => {
  it('normalizeBody trims emails and strips phone separators, without touching the original', () => {
    const body = {
      SignersGroups: [
        { Signers: [{ Email: '  a@example.com ', PhoneNumber: '+34 (600) 111-222' }] },
      ],
      SignedDocumentRecipients: [{ Email: ' b@example.com\t' }],
      NotificationEmails: [' c@example.com '],
    };
    const snapshot = structuredClone(body);
    const clean = rules().normalizeBody(body);
    expect(clean).toEqual({
      SignersGroups: [{ Signers: [{ Email: 'a@example.com', PhoneNumber: '+34600111222' }] }],
      SignedDocumentRecipients: [{ Email: 'b@example.com' }],
      NotificationEmails: ['c@example.com'],
    });
    expect(body).toEqual(snapshot);
  });

  it('an absent nullable email is kept as-is', () => {
    const clean = rules().normalizeBody({ SignersGroups: [{ Signers: [{ Email: 'null' }] }] });
    expect(clean).toEqual({ SignersGroups: [{ Signers: [{ Email: 'null' }] }] });
  });

  it('MCP: create_document sends the trimmed email and phone', async () => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token') ? token('T') : json(200, { DocGUI: 'd1' }),
    );
    const h = await startHarness({
      env: { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'cs' },
      fetch: m.fetch,
    });
    const path = `${h.inputDir}/a.pdf`;
    writeFileSync(path, '%PDF-1.4 x');
    const r = await h.call('vidsigner_create_document', {
      filePath: path,
      IssuerName: 'Acme',
      SignersGroups: [
        {
          Signers: [
            {
              SignatureType: 'emailandsms',
              Email: '  signer@example.test  ',
              PhoneNumber: '+34 600 111 222',
            },
          ],
        },
      ],
      SignedDocumentRecipients: [{ Email: ' recipient@example.test ' }],
    });
    expect(r.isError, r.text).toBe(false);
    const sent = m.calls.find((c) => c.url.endsWith('/documents'));
    const body = JSON.parse(sent?.body ?? '{}') as {
      SignersGroups: Array<{ Signers: Array<{ Email: string; PhoneNumber: string }> }>;
      SignedDocumentRecipients: Array<{ Email: string }>;
    };
    expect(body.SignersGroups[0]?.Signers[0]).toMatchObject({
      Email: 'signer@example.test',
      PhoneNumber: '+34600111222',
    });
    expect(body.SignedDocumentRecipients[0]?.Email).toBe('recipient@example.test');
  });

  it('MCP: update_vidmobile_user_email sends the trimmed email', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_update_vidmobile_user_email', {
      legalId: '12345678Z',
      email: '  new@example.test ',
    });
    expect(r.isError, r.text).toBe(false);
    const put = m.calls.find((c) => c.method === 'PUT');
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ Email: 'new@example.test' });
  });
});

describe('S-c: free texts cannot contain URLs outside the lists', () => {
  const p = rules();

  it.each([
    'Sign here: https://evil.com/login',
    'Visit www.evil.com to sign',
    '<a href="https://evil.com/x">sign</a>',
    '<img src="http://evil.com/pixel.png">',
    'ok https://hooks.example.com/a and bad https://evil.com/b',
    'https://hooks.example.com.evil.com/a',
    'HTTPS://EVIL.COM/x',
  ])('rechaza %j', (text) => {
    expect(() => p.assertFreeText(text, 'eMailBody')).toThrow(/eMailBody.*host/);
  });

  it.each([
    'Hello, sign your contract.',
    'See https://hooks.example.com/help.',
    '<a href="https://cdn.example.com/x.pdf">PDF</a>',
    'Write to us at sign@example.com',
  ])('acepta %j', (text) => {
    expect(() => p.assertFreeText(text, 'eMailBody')).not.toThrow();
  });

  it('a www.* URL is evaluated by its full host', () => {
    expect(() => p.assertFreeText('www.hooks.example.com', 'Body')).toThrow(/host/);
    const www = new RecipientPolicy({ notificationHosts: ['www.example.com'] });
    expect(() => www.assertFreeText('go to www.example.com.', 'Body')).not.toThrow();
  });

  it('with no list at all nothing changes', () => {
    expect(() =>
      new RecipientPolicy().assertFreeText('https://evil.com www.evil.com', 'eMailBody'),
    ).not.toThrow();
  });

  it('a single defined list is enough to enforce it (the union of notification and assets)', () => {
    const onlyAssets = new RecipientPolicy({ assetHosts: ['cdn.example.com'] });
    expect(() => onlyAssets.assertFreeText('https://cdn.example.com/x', 'Body')).not.toThrow();
    expect(() => onlyAssets.assertFreeText('https://evil.com/x', 'Body')).toThrow();
  });

  it('assertBody applies it to eMailBody, eMailSubject, Description, Body, Subject and SignatureReason', () => {
    const evil = 'see https://evil.com/x';
    for (const body of [
      { SignersGroups: [{ Signers: [{ NotificationEmailMessage: { eMailBody: evil } }] }] },
      { SignersGroups: [{ Signers: [{ NotificationEmailMessage: { eMailSubject: evil } }] }] },
      { Description: evil },
      { EDeliveryEmailMessage: { Body: evil } },
      { EDeliveryEmailMessage: { Subject: evil } },
      { SignatureReason: evil },
      { Reminder: { EmailNotification: { Body: evil } } },
    ]) {
      expect(() => p.assertBody(body), JSON.stringify(body)).toThrow(/host/);
    }
  });

  it('MCP: send_signature_url and the e-delivery reminder check the text', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({
      env: {
        VIDSIGNER_CLIENT_ID: 'cid',
        VIDSIGNER_CLIENT_SECRET: 'cs',
        VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS: 'hooks.example.com',
      },
      fetch: m.fetch,
    });
    const link = await h.call('vidsigner_send_signature_url', {
      signerGuid: 's1',
      Channel: 'email',
      EmailNotification: { eMailBody: 'Go to https://evil.com/x' },
    });
    expect(link.isError).toBe(true);
    const rem = await h.call('vidsigner_send_edelivery_reminder', {
      edeliveryGuid: 'e1',
      Channel: 'email',
      EmailNotification: { Subject: 'www.evil.com' },
    });
    expect(rem.isError).toBe(true);
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
    const ok = await h.call('vidsigner_send_signature_url', {
      signerGuid: 's1',
      Channel: 'email',
      EmailNotification: { eMailBody: 'Go to https://hooks.example.com/x' },
    });
    expect(ok.isError, ok.text).toBe(false);
  });
});

describe('S-e and S-f: constructor and email lists', () => {
  it('S-e: a key with an undefined value neither breaks nor overrides the default', () => {
    const p = new RecipientPolicy({ emailDomains: undefined, assetHosts: undefined });
    expect(p.restricted).toBe(false);
    expect(() => p.assertRequiredEmail('a@example.org', 'Email')).not.toThrow();
    expect(
      new RecipientPolicy({ emailDomains: undefined, phonePrefixes: ['+34'] }).restricted,
    ).toBe(true);
  });

  it('S-f: NotificationEmails and EmailStatusNotification are also validated as a string', () => {
    const p = rules();
    expect(() => p.assertBody({ NotificationEmails: 'a@example.com' })).not.toThrow();
    expect(() => p.assertBody({ NotificationEmails: 'a@evil.com' })).toThrow(/NotificationEmails/);
    expect(() => p.assertBody({ NotificationEmails: 'a@example.com,b@evil.com' })).toThrow(
      /NotificationEmails/,
    );
    expect(() =>
      p.assertBody({ NotificationConfig: { EmailStatusNotification: ['x@evil.com'] } }),
    ).toThrow(/EmailStatusNotification\[0\]/);
    expect(() =>
      p.assertBody({ NotificationConfig: { EmailStatusNotification: 'x@evil.com' } }),
    ).toThrow(/EmailStatusNotification/);
  });
});
