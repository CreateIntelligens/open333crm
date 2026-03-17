import { prisma } from '../lib/prisma.js';

export type MigrationExampleUserCreateInput = {
  email: string;
  name?: string;
};

export type MigrationExampleUserUpdateInput = {
  email?: string;
  name?: string | null;
};

export const migrationExampleUserModel = {
  list() {
    return prisma.migrationExampleUser.findMany({
      orderBy: { createdAt: 'desc' },
    });
  },

  getById(id: string) {
    return prisma.migrationExampleUser.findUnique({
      where: { id },
    });
  },

  create(input: MigrationExampleUserCreateInput) {
    return prisma.migrationExampleUser.create({
      data: {
        email: input.email,
        name: input.name,
      },
    });
  },

  updateById(id: string, input: MigrationExampleUserUpdateInput) {
    return prisma.migrationExampleUser.update({
      where: { id },
      data: {
        email: input.email,
        name: input.name,
      },
    });
  },

  deleteById(id: string) {
    return prisma.migrationExampleUser.delete({
      where: { id },
    });
  },
};
