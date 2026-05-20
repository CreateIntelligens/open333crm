-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "materialId" UUID,
ALTER COLUMN "templateId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
