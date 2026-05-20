-- DropForeignKey
ALTER TABLE "materials" DROP CONSTRAINT "materials_templateId_fkey";

-- AlterTable
ALTER TABLE "materials" ALTER COLUMN "templateId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
