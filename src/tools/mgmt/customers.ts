import { z } from 'zod';
import { defineTool, type AnyToolDefinition, type ToolContext } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';
import { paginationShape } from './partners.js';

const customerFields = {
  CustomerName: z.string().describe('Name of the customer.'),
  CustomerLegalId: z.string().describe('Legal id (CIF/NIF) of the customer.'),
  Address: z.string().describe('Street address of the customer.'),
  City: z.string().describe('City.'),
  State: z.string().describe('State or province.'),
  PostalCode: z.string().describe('Postal code.'),
  Country: z.string().length(2).describe('ISO-3166 alpha-2 country code, e.g. ES.'),
  CustomerEmail: z.string().optional().describe('Contact email of the customer.'),
  CustomerPhoneNumber: z.string().optional().describe('Contact phone of the customer.'),
  Sector: z.string().nullable().optional().describe('Business sector of the customer.'),
  SubSector: z.string().nullable().optional().describe('Business sub-sector of the customer.'),
  Software: z
    .string()
    .nullable()
    .optional()
    .describe('Software or integration the customer uses VIDsigner from.'),
  UseCase: z.string().nullable().optional().describe('Use case of the signatures.'),
  Referal: z
    .string()
    .nullable()
    .optional()
    .describe('How the customer was referred (as spelled by the API).'),
  Comments: z.string().nullable().optional().describe('Free comments.'),
  CustomerURL: z
    .string()
    .describe('Contact URL starting with http/https, or "n/a" if the customer has none.'),
};

/**
 * Runs the customer's contact email and URL through the recipient policy: the email through
 * `VIDSIGNER_ALLOWED_EMAIL_DOMAINS` (and always its format) and the URL through
 * `VIDSIGNER_ALLOWED_ASSET_HOSTS`.
 */
function cleanCustomerContact<
  T extends { CustomerEmail?: string | undefined; CustomerURL?: string | undefined },
>(customer: T, ctx: { policy: ToolContext['policy'] }): T {
  const email = ctx.policy.assertOptionalEmail(customer.CustomerEmail, 'CustomerEmail');
  ctx.policy.assertAssetUrl(customer.CustomerURL, 'CustomerURL');
  return email === undefined ? customer : { ...customer, CustomerEmail: email };
}

const partnerGuid = id('Partner GUID.');
const customerGuid = id('Customer GUID.');

const listCustomers = defineTool({
  name: 'vidsigner_mgmt_list_customers',
  title: 'List customers of a partner',
  domain: 'customers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /partners/{partnerguid}/customers',
  whenToUse: 'you need the customers of a partner, for example to find a CustomerGUID.',
  docSummary: 'Lists the customers of a partner, paginated.',
  notes: [
    'orderBy: CustomerGUID, CustomerName or CustomerLegalId.',
    'An empty list (404) is returned as an empty list.',
  ],
  description:
    'Lists the customers of a partner (MGMT API, GET /partners/{partnerguid}/customers). orderBy: CustomerGUID, CustomerName or CustomerLegalId. An empty list (404) is returned as an empty array.',
  inputSchema: { partnerGuid, ...paginationShape },
  handler: async ({ partnerGuid, ...opts }, ctx) =>
    requireMgmt(ctx).listCustomers(partnerGuid, opts),
});

const createCustomer = defineTool({
  name: 'vidsigner_mgmt_create_customer',
  title: 'Create customer',
  domain: 'customers',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /partners/{partnerguid}/customers',
  whenToUse: 'a new customer must be registered under a partner before creating its subscriptions.',
  docSummary: 'Creates a customer under a partner and returns its CustomerGUID.',
  notes: [
    '409 if it already exists.',
    'CustomerEmail (when provided) and CustomerURL go through the recipient policy; CustomerURL accepts "n/a".',
    'Sector, SubSector, Software, UseCase, Referal and Comments accept null.',
  ],
  example: {
    partnerGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    CustomerName: 'Acme Test Ltd',
    CustomerLegalId: 'B12345678',
    Address: 'Main Street 1',
    City: 'Madrid',
    State: 'Madrid',
    PostalCode: '28001',
    Country: 'ES',
    CustomerEmail: 'contact@example.test',
    CustomerURL: 'https://www.example.test',
  },
  description:
    'Creates a customer under a partner and returns its CustomerGUID (MGMT API, POST /partners/{partnerguid}/customers). 409 if it already exists.',
  inputSchema: { partnerGuid, ...customerFields },
  handler: async ({ partnerGuid, ...customer }, ctx) => {
    return requireMgmt(ctx).createCustomer(partnerGuid, cleanCustomerContact(customer, ctx));
  },
});

const getCustomer = defineTool({
  name: 'vidsigner_mgmt_get_customer',
  title: 'Get customer',
  domain: 'customers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /customers/{customerguid}',
  whenToUse: 'you need the registered data of one customer.',
  docSummary: 'Returns the data of a customer.',
  description: 'Returns the data of a customer (MGMT API, GET /customers/{customerguid}).',
  inputSchema: { customerGuid },
  handler: async ({ customerGuid }, ctx) => requireMgmt(ctx).getCustomer(customerGuid),
});

const updateCustomer = defineTool({
  name: 'vidsigner_mgmt_update_customer',
  title: 'Update customer',
  domain: 'customers',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /customers/{customerguid}',
  whenToUse: 'the data of an existing customer must be replaced (send every mandatory field).',
  docSummary: 'Replaces the data of a customer; every mandatory field must be sent.',
  notes: [
    'Rejected if the contract was already sent or signed.',
    'CustomerEmail (when provided) and CustomerURL go through the recipient policy.',
  ],
  example: {
    customerGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    CustomerName: 'Acme Test Ltd',
    CustomerLegalId: 'B12345678',
    Address: 'Main Street 1',
    City: 'Madrid',
    State: 'Madrid',
    PostalCode: '28001',
    Country: 'ES',
    CustomerURL: 'n/a',
  },
  description:
    'Replaces the data of a customer (MGMT API, PUT /customers/{customerguid}); send ALL the mandatory fields. It is rejected if the contract was already sent or signed.',
  inputSchema: { customerGuid, ...customerFields },
  handler: async ({ customerGuid, ...customer }, ctx) => {
    await requireMgmt(ctx).updateCustomer(customerGuid, cleanCustomerContact(customer, ctx));
    return { updated: true, customerGuid };
  },
});

const deleteCustomer = defineTool({
  name: 'vidsigner_mgmt_delete_customer',
  title: 'Delete customer',
  domain: 'customers',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /customers/{customerguid}',
  whenToUse: 'a customer must be removed together with its registration.',
  docSummary: 'Deletes a customer.',
  notes: ['It is irreversible.'],
  example: { customerGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: 'Deletes a customer (MGMT API, DELETE /customers/{customerguid}). Irreversible.',
  inputSchema: { customerGuid },
  handler: async ({ customerGuid }, ctx) => {
    await requireMgmt(ctx).deleteCustomer(customerGuid);
    return { deleted: true, customerGuid };
  },
});

export const customerTools: AnyToolDefinition[] = [
  listCustomers,
  createCustomer,
  getCustomer,
  updateCustomer,
  deleteCustomer,
];
