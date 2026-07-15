import assert from 'node:assert/strict';
import { listContacts } from '../modules/contact/contact.service.js';

type MockFn = ((...args: unknown[]) => unknown) & { calls: unknown[][] };

function mockFn(impl?: (...args: unknown[]) => unknown): MockFn {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args);
    return impl?.(...args);
  }) as MockFn;
  fn.calls = [];
  return fn;
}

async function testListContactsIncludesSafeChannelMetadata() {
  const contact = {
    id: 'contact-1',
    tenantId: 'tenant-1',
    displayName: 'Ada',
    channelIdentities: [
      {
        id: 'identity-1',
        channelType: 'LINE',
        uid: 'line-user-1',
        profileName: 'Ada LINE',
        channel: {
          id: 'channel-1',
          displayName: 'LINE 官方帳號 A',
          channelType: 'LINE',
        },
      },
    ],
    tags: [],
  };

  const prisma = {
    contact: {
      findMany: mockFn(() => [contact]),
      count: mockFn(() => 1),
    },
  };

  const result = await listContacts(
    prisma as never,
    'tenant-1',
    {},
    { page: 1, limit: 20 },
  );

  assert.deepEqual(result, { contacts: [contact], total: 1 });
  assert.deepEqual(prisma.contact.findMany.calls[0][0], {
    where: {
      tenantId: 'tenant-1',
      isArchived: false,
    },
    include: {
      channelIdentities: {
        select: {
          id: true,
          channelType: true,
          uid: true,
          profileName: true,
          channel: {
            select: {
              id: true,
              displayName: true,
              channelType: true,
            },
          },
        },
      },
      tags: {
        include: {
          tag: {
            select: {
              id: true,
              name: true,
              color: true,
              type: true,
              scope: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: 0,
    take: 20,
  });
  assert.deepEqual(prisma.contact.count.calls[0][0], {
    where: {
      tenantId: 'tenant-1',
      isArchived: false,
    },
  });
}

async function testListContactsCanExcludeChannelIdentitiesFromPayload() {
  const contact = {
    id: 'contact-1',
    tenantId: 'tenant-1',
    displayName: 'Ada',
    channelIdentities: [
      {
        id: 'identity-line',
        channelType: 'LINE',
        uid: 'line-user-1',
        profileName: 'Ada LINE',
        channel: {
          id: 'channel-line',
          displayName: 'LINE 官方帳號 A',
          channelType: 'LINE',
        },
      },
    ],
    tags: [],
  };

  const prisma = {
    contact: {
      findMany: mockFn(() => [contact]),
      count: mockFn(() => 1),
    },
  };

  const result = await listContacts(
    prisma as never,
    'tenant-1',
    { excludeChannelType: 'WEBCHAT' },
    { page: 1, limit: 20 },
  );

  assert.deepEqual(result, {
    contacts: [contact],
    total: 1,
  });
  assert.deepEqual(prisma.contact.findMany.calls[0][0], {
    where: {
      tenantId: 'tenant-1',
      isArchived: false,
      channelIdentities: {
        some: {
          AND: [
            { channelType: { notIn: ['WEBCHAT'] } },
            { channel: { is: { channelType: { notIn: ['WEBCHAT'] } } } },
          ],
        },
      },
    },
    include: {
      channelIdentities: {
        where: {
          AND: [
            { channelType: { notIn: ['WEBCHAT'] } },
            { channel: { is: { channelType: { notIn: ['WEBCHAT'] } } } },
          ],
        },
        select: {
          id: true,
          channelType: true,
          uid: true,
          profileName: true,
          channel: {
            select: {
              id: true,
              displayName: true,
              channelType: true,
            },
          },
        },
      },
      tags: {
        include: {
          tag: {
            select: {
              id: true,
              name: true,
              color: true,
              type: true,
              scope: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: 0,
    take: 20,
  });
  assert.deepEqual(prisma.contact.count.calls[0][0], {
    where: {
      tenantId: 'tenant-1',
      isArchived: false,
      channelIdentities: {
        some: {
          AND: [
            { channelType: { notIn: ['WEBCHAT'] } },
            { channel: { is: { channelType: { notIn: ['WEBCHAT'] } } } },
          ],
        },
      },
    },
  });
}

await testListContactsIncludesSafeChannelMetadata();
await testListContactsCanExcludeChannelIdentitiesFromPayload();

console.log('contact.service tests passed');
process.exit(0);
