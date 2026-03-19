import { prisma } from '@open333crm/database';

export { prisma };
export * from '@prisma/client';

export const connectPostgres = async () => {
  await prisma.$connect();
};

export const disconnectPostgres = async () => {
  await prisma.$disconnect();
};
