import { PrismaClient, AgentRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const agents = [
  {
    email: 'admin@open333crm.dev',
    name: 'Admin',
    role: AgentRole.ADMIN,
    password: 'Admin1234!',
  },
  {
    email: 'supervisor@open333crm.dev',
    name: 'Supervisor',
    role: AgentRole.SUPERVISOR,
    password: 'Super1234!',
  },
  {
    email: 'agent@open333crm.dev',
    name: 'Agent',
    role: AgentRole.AGENT,
    password: 'Agent1234!',
  },
];

async function main() {
  for (const { password, ...data } of agents) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.agent.upsert({
      where: { email: data.email },
      update: {},
      create: { ...data, passwordHash },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    await prisma.$disconnect();
    throw e;
  });
