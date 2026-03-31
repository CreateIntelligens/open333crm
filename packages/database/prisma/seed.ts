import { PrismaClient, AgentRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

const agents = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    email: 'admin@open333crm.dev',
    name: 'Admin',
    role: AgentRole.ADMIN,
    password: 'Admin1234!',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    email: 'supervisor@open333crm.dev',
    name: 'Supervisor',
    role: AgentRole.SUPERVISOR,
    password: 'Super1234!',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    email: 'agent@open333crm.dev',
    name: 'Agent',
    role: AgentRole.AGENT,
    password: 'Agent1234!',
  },
];

async function main() {
  // Tenant must exist before agents (FK constraint)
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: 'Demo Tenant', isActive: true },
    create: { id: TENANT_ID, name: 'Demo Tenant', isActive: true },
  });

  for (const { id, password, ...data } of agents) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.agent.upsert({
      where: { tenantId_email: { tenantId: TENANT_ID, email: data.email } },
      update: { name: data.name, role: data.role, passwordHash, isActive: true },
      create: { id, tenantId: TENANT_ID, ...data, passwordHash, isActive: true },
    });
  }

  console.log('Seed complete: 1 tenant, 3 agents');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed failed:', e.message);
    await prisma.$disconnect();
    process.exit(1);
  });

