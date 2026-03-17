import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const seedUsers = [
  { email: 'alice@example.com', name: 'Alice Chen' },
  { email: 'bob@example.com', name: 'Bob Lin' },
  { email: 'carol@example.com', name: 'Carol Wang' },
];

const main = async () => {
  for (const user of seedUsers) {
    await prisma.migrationExampleUser.upsert({
      where: { email: user.email },
      update: { name: user.name },
      create: {
        email: user.email,
        name: user.name,
      },
    });
  }
};

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(`Seeded ${seedUsers.length} MigrationExampleUser records`);
  })
  .catch(async (error) => {
    await prisma.$disconnect();
    throw error;
  });
